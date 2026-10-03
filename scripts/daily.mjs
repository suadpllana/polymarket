/**
 * Daily job, run by GitHub Actions before each Pages deploy:
 *   1. load the published history.json from the live site
 *   2. settle any open parlays from resolved Polymarket markets
 *   3. once per day (from 08:00 Belgrade), build today's parlay
 *   4. write public/history.json for the site to ship
 *
 * Env: SITE_URL (published site base), ANTHROPIC_API_KEY (optional; enables
 * the research pass), FORCE_GENERATE=1 (ignore the 08:00 gate, for testing).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { fetchMarket, fetchSeriesEvents, fetchSports, parseArray } from './lib/polymarket.mjs';
import {
  SPORTS,
  TARGET,
  bestParlay,
  candidateLegs,
  grade,
  round,
  settleLeg,
  settleParlay,
} from './lib/parlay.mjs';
import { researchLegs } from './lib/research.mjs';
import { TIMEZONE, bettingWindow, localDate, zonedParts } from './lib/time.mjs';

const GENERATE_FROM_HOUR = 8;
const RESEARCH_POOL = 24;
// After this hour a failed research pass falls back to market prices rather
// than leaving the day without a slip.
const RESEARCH_DEADLINE_HOUR = 12;
const OUT = new URL('../public/history.json', import.meta.url);

async function loadHistory(siteUrl) {
  if (!siteUrl) return { entries: [] };
  const url = new URL('history.json', siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`);
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) {
    console.log(`No published history at ${url}; starting fresh.`);
    return { entries: [] };
  }
  // Anything else unexpected must stop the run: overwriting history with an
  // empty list would erase the track record.
  if (!res.ok) throw new Error(`Could not load ${url}: HTTP ${res.status}`);
  const data = await res.json();
  return { entries: Array.isArray(data.entries) ? data.entries : [] };
}

async function settleOpen(entries) {
  const open = entries.filter((e) => e.legs?.length && !e.parlay_result);
  if (!open.length) return;

  const ids = new Set();
  for (const e of open) {
    for (const leg of e.legs) {
      if (leg.result) continue;
      for (const r of [...leg.settle.won, ...leg.settle.lost]) ids.add(r.marketId);
    }
  }

  const resolved = new Map();
  for (const id of ids) {
    try {
      const m = await fetchMarket(id);
      if (m?.closed === true) resolved.set(id, parseArray(m.outcomePrices).map(Number));
    } catch (e) {
      console.warn(`Market ${id} lookup failed: ${e.message}`);
    }
  }

  for (const e of open) {
    for (const leg of e.legs) {
      if (!leg.result) leg.result = settleLeg(leg, resolved);
    }
    e.parlay_result = settleParlay(e);
    if (e.parlay_result) {
      const paid = e.legs.filter((l) => l.result === 'won').reduce((o, l) => o * l.odds, 1);
      e.settled_odds = e.parlay_result === 'won' ? round(paid, 2) : null;
      console.log(`Settled ${e.date}: ${e.parlay_result}`);
    }
  }
}

async function gatherLegs(window) {
  const sports = await fetchSports();
  if (!sports.length) throw new Error('Polymarket returned no sports list');
  console.log('Polymarket sports:', sports.map((s) => s.sport).join(', '));

  const legs = [];
  for (const s of sports) {
    if (!SPORTS[s.sport] || !s.series) continue;
    try {
      const events = await fetchSeriesEvents(s.series, window.start);
      const found = candidateLegs(events, s.sport, window);
      console.log(`${s.sport}: ${events.length} open events, ${found.length} eligible legs`);
      legs.push(...found);
    } catch (e) {
      console.warn(`${s.sport}: ${e.message}`);
    }
  }
  return legs;
}

function noBet(date, reason, extra = {}) {
  return { date, generated_at: new Date().toISOString(), grade: 'NO_BET', no_bet_reason: reason, legs: [], parlay_result: null, ...extra };
}

async function buildToday(date) {
  const window = bettingWindow();
  console.log(`Window: ${window.start.toISOString()} → ${window.end.toISOString()}`);

  // A data failure throws, so main() skips this run and the next one retries
  // instead of locking in a "no bet" for the whole day.
  const legs = await gatherLegs(window);
  if (legs.length < 2) return noBet(date, 'Fewer than 2 qualifying legs in today’s window.');

  // Research the strongest candidates, at most two markets per event so the
  // pool spans enough different games to build a parlay from.
  const perEvent = new Map();
  const pool = [...legs]
    .sort((a, b) => b.p_market - a.p_market)
    .filter((l) => {
      const n = perEvent.get(l.eventId) || 0;
      perEvent.set(l.eventId, n + 1);
      return n < 2;
    })
    .slice(0, RESEARCH_POOL);
  let mode = 'market';
  let summary = '';
  let researched = pool.map((l) => ({ ...l, p_final: l.p_market, reason: '', main_risk: '' }));

  let research = null;
  try {
    research = await researchLegs(pool, { today: date });
  } catch (e) {
    console.warn(`Research failed: ${e.message}`);
  }
  if (!research && process.env.ANTHROPIC_API_KEY && zonedParts(new Date()).hour < RESEARCH_DEADLINE_HOUR) {
    throw new Error('Research unavailable; retrying on the next run');
  }
  if (research) {
    mode = 'research';
    summary = research.summary;
    researched = pool
      .filter((l) => research.verdicts.has(l.id) && !research.verdicts.get(l.id).exclude)
      .map((l) => {
        const v = research.verdicts.get(l.id);
        const p = Math.min(0.97, Math.max(0.02, l.p_market + v.adjustment_pp / 100));
        return { ...l, p_final: round(p, 4), reason: v.reason, main_risk: v.main_risk };
      });
  }

  for (const l of researched) l.edge = round(l.p_final * l.odds - 1, 4);

  const best = bestParlay(researched);
  if (!best) return noBet(date, 'No combination of qualifying legs lands between 4.5 and 5.5.', { mode, summary });

  const legsOut = best.legs
    .sort((a, b) => a.start.localeCompare(b.start))
    .map(({ key, p, ...l }) => ({ ...l, result: null }));
  const earliest = new Date(legsOut[0].start);

  return {
    date,
    generated_at: new Date().toISOString(),
    mode,
    summary,
    // Without research there is no evidence of an edge over the market, so
    // never call it VALUE; the bookmaker's margin still applies.
    ...(mode === 'research' || best.ev < -0.15 ? grade(best.ev) : { grade: 'STANDARD', stake_units: 0.5 }),
    target_odds: TARGET.target,
    combined_odds: round(best.odds, 2),
    est_hit_prob: round(best.p, 4),
    ev: round(best.ev, 4),
    place_before: new Date(earliest.getTime() - 15 * 60 * 1000).toISOString(),
    legs: legsOut,
    parlay_result: null,
    settled_odds: null,
  };
}

async function main() {
  const history = await loadHistory(process.env.SITE_URL);
  await settleOpen(history.entries);

  const now = new Date();
  const today = localDate(now);
  const hour = zonedParts(now).hour;
  const force = process.env.FORCE_GENERATE === '1';
  const existing = history.entries.find((e) => e.date === today);

  if (!existing && (hour >= GENERATE_FROM_HOUR || force)) {
    try {
      const entry = await buildToday(today);
      console.log(JSON.stringify(entry, null, 2));
      history.entries.push(entry);
    } catch (e) {
      console.warn(`No slip this run: ${e.message}`);
    }
  } else {
    console.log(existing ? `Parlay for ${today} already exists.` : `Before ${GENERATE_FROM_HOUR}:00 ${TIMEZONE}; not generating yet.`);
  }

  history.entries.sort((a, b) => b.date.localeCompare(a.date));
  const out = {
    updated_at: now.toISOString(),
    timezone: TIMEZONE,
    entries: history.entries.slice(0, 400),
  };
  await mkdir(new URL('.', OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Wrote ${out.entries.length} entries.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
