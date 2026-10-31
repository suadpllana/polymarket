/**
 * Morning step for the research task: lists today's football games worth
 * researching in research/<date>.candidates.json.
 *
 * Usage: node scripts/candidates.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { gatherGames, inRange, legsFor, researchPool } from './lib/football.mjs';
import { candidatesPath } from './lib/research.mjs';
import { bettingWindow, localDate } from './lib/time.mjs';

const date = localDate();
const window = bettingWindow();
const all = await gatherGames(window);
const pool = researchPool(all);

const out = {
  date,
  window: { start: window.start.toISOString(), end: window.end.toISOString() },
  games_in_window: all.length,
  games: pool.map((g) => ({
    id: g.id,
    league: g.league,
    event: g.event,
    home: g.home,
    away: g.away,
    start: g.start,
    p_market: g.p_market,
    legs_in_range: legsFor(g, g.p_market)
      .filter(inRange)
      .map((l) => ({ key: l.key, label: l.label, selection: l.selection, fair_odds: l.fair_odds })),
  })),
};

await mkdir(new URL('.', candidatesPath(date)), { recursive: true });
await writeFile(candidatesPath(date), `${JSON.stringify(out, null, 2)}\n`);
console.log(`${out.games.length} games (of ${all.length} in the window) written to research/${date}.candidates.json`);
