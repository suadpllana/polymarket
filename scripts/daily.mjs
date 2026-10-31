/**
 * Daily job, run by GitHub Actions before each Pages deploy:
 *   1. load the published history.json from the live site
 *   2. settle open slips from resolved Polymarket markets
 *   3. once the morning research is in, build today's 2-leg football slip
 *      from live Polymarket prices plus the research
 *   4. write public/history.json for the site to ship
 *
 * Usage: node scripts/daily.mjs          (CI; needs SITE_URL)
 *        node scripts/daily.mjs --dry    (print today's slip, write nothing)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { SLIP, gatherGames, round } from './lib/football.mjs';
import { fetchMarket, parseArray } from './lib/polymarket.mjs';
import { bestSlip, describe, eligibleLegs } from './lib/pick.mjs';
import { loadResearch } from './lib/research.mjs';
import { TIMEZONE, bettingWindow, localDate } from './lib/time.mjs';

const OUT = new URL('../public/history.json', import.meta.url);
const DRY = process.argv.includes('--dry');

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
  // Slips from the old multi-sport model are not carried over.
  return { entries: (Array.isArray(data.entries) ? data.entries : []).filter((e) => e.model === 'football-2leg') };
}

function settleLeg(leg, resolved) {
  const yes = (id) => {
    const prices = resolved.get(id);
    if (!prices) return null;
    if (prices[0] >= 0.98) return true;
    if (prices[0] <= 0.02) return false;
    return null;
  };
  const any = (ids) => ids.some((id) => yes(id) === true);
  if (any(leg.settle.won)) return 'won';
  if (any(leg.settle.void)) return 'void';
  if (any(leg.settle.lost)) return 'lost';
  return null;
}

async function settleOpen(entries) {
  const open = entries.filter((e) => e.legs?.length && !e.result);
  const ids = new Set(open.flatMap((e) => e.legs.filter((l) => !l.result).flatMap((l) => [...l.settle.won, ...l.settle.void, ...l.settle.lost])));
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
    for (const leg of e.legs) if (!leg.result) leg.result = settleLeg(leg, resolved);
    const rs = e.legs.map((l) => l.result);
    if (rs.includes('lost')) e.result = 'lost';
    else if (rs.some((r) => !r)) e.result = null;
    else if (rs.every((r) => r === 'void')) e.result = 'void';
    else e.result = 'won';
    if (e.result) {
      e.settled_odds = e.result === 'lost' ? 0 : round(e.legs.reduce((o, l) => o * (l.result === 'won' ? l.odds : 1), 1), 2);
      console.log(`Settled ${e.date}: ${e.result}`);
    }
  }
}

function noBet(date, reason, extra = {}) {
  return { model: 'football-2leg', date, generated_at: new Date().toISOString(), no_bet: true, reason, legs: [], result: null, ...extra };
}

async function buildToday(date) {
  const research = await loadResearch(date);
  // No research: wait. Every leg must be researched, so there is no market-only fallback.
  if (!research) throw new Error(`no research for ${date} yet`);
  const window = bettingWindow();
  const games = await gatherGames(window);
  const { legs, skipped } = eligibleLegs(games, research);
  skipped.forEach((s) => console.log(`Skipped: ${s}`));
  const kept = [...research.games.values()].filter((v) => !v.exclude).length;
  const slip = bestSlip(legs);
  const base = { summary: research.summary, researched_at: research.researched_at, researched_games: research.games.size, kept_games: kept, skipped };
  if (!slip) return noBet(date, `No two researched legs from different games combine to ${SLIP.min}–${SLIP.max}.`, base);

  console.log(describe(slip));
  const legsOut = slip.legs
    .sort((a, b) => a.game.start.localeCompare(b.game.start))
    .map((l) => ({
      game_id: l.game.id,
      league: l.game.league,
      event: l.game.event,
      home: l.game.home,
      away: l.game.away,
      start: l.game.start,
      key: l.key,
      label: l.label,
      selection: l.selection,
      p_market: l.game.p_market,
      p: { home: round(l.p.home, 4), draw: round(l.p.draw, 4), away: round(l.p.away, 4) },
      p_win: round(l.p_win, 4),
      p_void: round(l.p_void, 4),
      fair_odds: l.fair_odds,
      odds: l.odds,
      book: l.book,
      confidence: l.verdict.confidence,
      reason: l.verdict.reason,
      main_risk: l.verdict.main_risk,
      checks: l.verdict.checks,
      sources: l.verdict.sources,
      settle: {
        won: l.won.map((k) => l.game.refs[k]),
        void: l.void.map((k) => l.game.refs[k]),
        lost: l.lost.map((k) => l.game.refs[k]),
      },
      result: null,
    }));
  const earliest = new Date(legsOut[0].start);
  return {
    model: 'football-2leg',
    date,
    generated_at: new Date().toISOString(),
    ...base,
    target_odds: SLIP.target,
    odds: round(legsOut.reduce((o, l) => o * l.odds, 1), 2),
    p_hit: round(slip.p_hit, 4),
    ev: round(slip.ev, 4),
    place_before: new Date(earliest.getTime() - 15 * 60 * 1000).toISOString(),
    legs: legsOut,
    result: null,
    settled_odds: null,
  };
}

async function main() {
  const today = localDate();
  if (DRY) {
    const entry = await buildToday(today);
    if (entry.no_bet) console.log(`No bet: ${entry.reason}`);
    return;
  }
  const history = await loadHistory(process.env.SITE_URL);
  await settleOpen(history.entries);

  if (!history.entries.some((e) => e.date === today)) {
    try {
      history.entries.push(await buildToday(today));
    } catch (e) {
      console.warn(`No slip this run: ${e.message}`);
    }
  } else console.log(`Slip for ${today} already exists.`);

  history.entries.sort((a, b) => b.date.localeCompare(a.date));
  const out = { updated_at: new Date().toISOString(), timezone: TIMEZONE, entries: history.entries.slice(0, 400) };
  await mkdir(new URL('.', OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Wrote ${out.entries.length} entries.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
