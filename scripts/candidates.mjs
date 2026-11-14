/**
 * Morning step for the research task: lists today's games worth researching
 * in research/<date>.candidates.json.
 *
 * Usage: node scripts/candidates.mjs           (the first 16 games)
 *        node scripts/candidates.mjs --more    (adds every other game still in
 *                                               the window, keeping the ones
 *                                               already listed)
 *        node scripts/candidates.mjs --live 123,456
 *                                              (re-check: refreshes p_market
 *                                               and legs_in_range of those ids
 *                                               to live prices; like --more it
 *                                               keeps every game listed)
 *        add --tomorrow to any of them to list tomorrow's games (09:00–23:00
 *        Belgrade) into tomorrow's file, for research done the evening before
 *
 * Every game keeps `p_first`, the market when it was first listed, and
 * `legs_first`, each leg's market chance when that leg was first listed. They
 * are never overwritten: the pick measures a slide in price from them.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { coverage, gatherGames, inRange, marketLegs, researchPool, round } from './lib/football.mjs';
import { gameData } from './lib/enrich.mjs';
import { candidatesPath } from './lib/research.mjs';
import { bettingWindow, localDate, tomorrowWindow } from './lib/time.mjs';

const liveAt = process.argv.indexOf('--live');
const LIVE = new Set(liveAt > -1 ? String(process.argv[liveAt + 1] || '').split(',').map((x) => x.trim()).filter(Boolean) : []);
if (liveAt > -1 && !LIVE.size) throw new Error('--live needs game ids: --live 123,456');
const MORE = process.argv.includes('--more') || LIVE.size > 0;
const TOMORROW = process.argv.includes('--tomorrow');
const window = TOMORROW ? tomorrowWindow() : bettingWindow();
const date = TOMORROW ? localDate(window.start) : localDate();
const all = await gatherGames(window);

const entry = (g) => ({
  id: g.id,
  league: g.league,
  sport: g.sport,
  event: g.event,
  home: g.home,
  away: g.away,
  start: g.start,
  // 1 = best covered by previews, injury reports, odds and models; research these first.
  coverage: coverage(g),
  p_market: g.p_market,
  // The market at first listing; kept for good (see the header).
  p_first: g.p_market,
  // Result legs plus goals, both-teams-to-score, handicap and team-goals
  // legs, each with its market probability, so the research can give a
  // view on any of them.
  legs_in_range: marketLegs(g)
    .filter(inRange)
    .map((l) => ({ key: l.key, label: l.label, selection: l.selection, p_market: round(l.p_win + l.p_void, 4), fair_odds: l.fair_odds })),
});

// The file already written for this date, if any: --more and --live build on
// it, and a plain run still carries each game's first price over.
let onDisk = null;
try {
  onDisk = JSON.parse(await readFile(candidatesPath(date), 'utf8'));
} catch {
  onDisk = null;
}
if (onDisk && onDisk.date !== date) onDisk = null;
const previous = MORE ? onDisk : null;
const firstPrice = new Map((onDisk?.games || []).map((g) => [g.id, g.p_first || g.p_market]));
const firstLegs = new Map((onDisk?.games || []).map((g) => [g.id, g.legs_first || {}]));
// Keys already recorded keep their first value; legs that came into range later are added.
const withFirstLegs = (c) => ({ ...Object.fromEntries((c.legs_in_range || []).map((l) => [l.key, l.p_market])), ...(firstLegs.get(c.id) || {}), ...(c.legs_first || {}) });
const known = new Set((previous?.games || []).map((g) => g.id));
const pool = MORE ? researchPool(all, Infinity).filter((g) => !known.has(g.id)) : researchPool(all);

const games = [...(previous?.games || []), ...pool.map(entry)];
for (const c of games) {
  c.p_first = firstPrice.get(c.id) || c.p_first || c.p_market;
  c.legs_first = withFirstLegs(c);
}

// Odds, the 24h price move and a rating model for each game, so the research
// does not depend on pages that block automated visitors.
const live = new Map(all.map((g) => [g.id, g]));

// --live: the listed games get the live market for a re-check. p_first stays.
for (const id of LIVE) {
  const c = games.find((x) => x.id === id);
  const g = live.get(id);
  if (!c || !g) {
    console.log(`--live ${id}: ${c ? 'no longer open (started or closed), prices left as they were' : 'not a candidate id'}`);
    continue;
  }
  const fresh = entry(g);
  c.p_market = fresh.p_market;
  c.legs_in_range = fresh.legs_in_range;
  c.legs_first = withFirstLegs(c);
  c.p_live_at = new Date().toISOString();
  const fav = c.p_first.home >= c.p_first.away ? 'home' : 'away';
  const move = (c.p_market[fav] - c.p_first[fav]) / c.p_first[fav];
  console.log(`--live ${id} ${c.event}: ${JSON.stringify(c.p_market)}; favourite ${move >= 0 ? '+' : ''}${(move * 100).toFixed(1)}% since first listed (${c.p_first[fav]})`);
}

const todo = games.filter((c) => live.has(c.id));
for (let i = 0; i < todo.length; i += 4) {
  await Promise.all(
    todo.slice(i, i + 4).map(async (c) => {
      const data = await gameData(live.get(c.id)).catch(() => null);
      if (data && Object.keys(data).length) c.data = { ...data, fetched_at: new Date().toISOString() };
    })
  );
}

const out = {
  date,
  window: previous?.window || { start: window.start.toISOString(), end: window.end.toISOString() },
  games_in_window: Math.max(all.length, previous?.games_in_window || 0),
  games,
};

await mkdir(new URL('.', candidatesPath(date)), { recursive: true });
await writeFile(candidatesPath(date), `${JSON.stringify(out, null, 2)}\n`);
console.log(
  MORE
    ? `${pool.length} more games added (${out.games.length} in all) to research/${date}.candidates.json`
    : `${out.games.length} games (of ${all.length} in the window) written to research/${date}.candidates.json`
);
const withData = games.filter((g) => g.data);
console.log(
  `Data: odds for ${withData.filter((g) => g.data.odds).length}, 24h move for ${withData.filter((g) => g.data.move_24h).length}, rating for ${withData.filter((g) => g.data.rating).length} of ${games.length} games.`
);
