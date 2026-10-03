/**
 * Daily job, run by GitHub Actions before each Pages deploy:
 *   1. load the published history.json from the live site
 *   2. settle any open parlays from resolved Polymarket markets
 *   3. once per day, build today's parlay from fresh Polymarket prices plus
 *      the morning research verdicts in research/<date>.json
 *   4. write public/history.json for the site to ship
 *
 * Env: SITE_URL (published site base), FORCE_GENERATE=1 (skip the time gates,
 * for testing).
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { gatherLegs } from './lib/gather.mjs';
import { fetchMarket, parseArray } from './lib/polymarket.mjs';
import { TARGET, bestParlay, grade, round, settleLeg, settleParlay } from './lib/parlay.mjs';
import { loadResearch } from './lib/research.mjs';
import { TIMEZONE, bettingWindow, localDate, zonedParts } from './lib/time.mjs';

const GENERATE_FROM_HOUR = 8;
// Until this hour the build waits for the morning research; after it, the
// day gets a market-only slip rather than none.
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

function noBet(date, reason, extra = {}) {
  return { date, generated_at: new Date().toISOString(), grade: 'NO_BET', no_bet_reason: reason, legs: [], parlay_result: null, ...extra };
}

async function buildToday(date, force) {
  const window = bettingWindow();
  console.log(`Window: ${window.start.toISOString()} → ${window.end.toISOString()}`);

  // A data failure throws, so main() skips this run and the next one retries
  // instead of locking in a "no bet" for the whole day.
  const legs = await gatherLegs(window);
  if (legs.length < 2) return noBet(date, 'Fewer than 2 qualifying legs in today’s window.');

  const research = await loadResearch(date, legs);
  if (!research && !force && zonedParts(new Date()).hour < RESEARCH_DEADLINE_HOUR) {
    throw new Error('Waiting for this morning’s research');
  }

  let pool;
  if (research) {
    pool = legs
      .filter((l) => research.verdicts.has(l.id) && !research.verdicts.get(l.id).exclude)
      .map((l) => {
        const v = research.verdicts.get(l.id);
        const p = Math.min(0.97, Math.max(0.02, l.p_market + v.adjustment_pp / 100));
        return {
          ...l,
          p_final: round(p, 4),
          // A verified bookmaker price is what the bet actually pays.
          odds_exact: v.price ? v.price.odds : l.odds_exact,
          book: v.price ? v.price.book : null,
          reason: v.reason,
          main_risk: v.main_risk,
          sources: v.sources,
        };
      });
  } else {
    pool = legs.map((l) => ({ ...l, p_final: l.p_market, book: null, reason: '', main_risk: '', sources: [] }));
  }
  for (const l of pool) l.edge = round(l.p_final * l.odds_exact - 1, 4);

  const mode = research ? 'research' : 'market';
  const summary = research?.summary || '';
  const best = bestParlay(pool);
  if (!best) return noBet(date, 'No combination of qualifying legs lands between 4.5 and 5.5.', { mode, summary });

  const legsOut = best.legs
    .sort((a, b) => a.start.localeCompare(b.start))
    .map(({ key, p, odds_exact, odds, ...l }) => ({
      ...l,
      fair_odds: odds,
      odds: round(odds_exact, 2),
      result: null,
    }));
  const earliest = new Date(legsOut[0].start);

  return {
    date,
    generated_at: new Date().toISOString(),
    mode,
    summary,
    researched_at: research?.researched_at || null,
    // Without research there is no evidence of an edge over the market, so
    // never call it VALUE; the bookmaker's margin still applies.
    ...(research || best.ev < -0.15 ? grade(best.ev) : { grade: 'STANDARD', stake_units: 0.5 }),
    target_odds: TARGET.target,
    // What the slip shows: the product of the displayed leg odds.
    combined_odds: round(legsOut.reduce((o, l) => o * l.odds, 1), 2),
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
      const entry = await buildToday(today, force);
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
