/**
 * Morning step for the research task: lists today's games worth researching
 * in research/<date>.candidates.json.
 *
 * Usage: node scripts/candidates.mjs           (the first 16 games)
 *        node scripts/candidates.mjs --more    (adds every other game still in
 *                                               the window, keeping the ones
 *                                               already listed)
 *        add --tomorrow to either to list tomorrow's games (09:00–23:00
 *        Belgrade) into tomorrow's file, for research done the evening before
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { gatherGames, inRange, marketLegs, researchPool, round } from './lib/football.mjs';
import { candidatesPath } from './lib/research.mjs';
import { bettingWindow, localDate, tomorrowWindow } from './lib/time.mjs';

const MORE = process.argv.includes('--more');
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
  p_market: g.p_market,
  // Result legs plus goals, both-teams-to-score, handicap and team-goals
  // legs, each with its market probability, so the research can give a
  // view on any of them.
  legs_in_range: marketLegs(g)
    .filter(inRange)
    .map((l) => ({ key: l.key, label: l.label, selection: l.selection, p_market: round(l.p_win + l.p_void, 4), fair_odds: l.fair_odds })),
});

let previous = null;
if (MORE) {
  try {
    previous = JSON.parse(await readFile(candidatesPath(date), 'utf8'));
  } catch {
    previous = null;
  }
}
const known = new Set((previous?.games || []).map((g) => g.id));
const pool = MORE ? researchPool(all, Infinity).filter((g) => !known.has(g.id)) : researchPool(all);

const out = {
  date,
  window: previous?.window || { start: window.start.toISOString(), end: window.end.toISOString() },
  games_in_window: Math.max(all.length, previous?.games_in_window || 0),
  games: [...(previous?.games || []), ...pool.map(entry)],
};

await mkdir(new URL('.', candidatesPath(date)), { recursive: true });
await writeFile(candidatesPath(date), `${JSON.stringify(out, null, 2)}\n`);
console.log(
  MORE
    ? `${pool.length} more games added (${out.games.length} in all) to research/${date}.candidates.json`
    : `${out.games.length} games (of ${all.length} in the window) written to research/${date}.candidates.json`
);
