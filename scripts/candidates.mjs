/**
 * Morning step for the research task: lists today's football games worth
 * researching in research/<date>.candidates.json.
 *
 * Usage: node scripts/candidates.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { gatherGames, inRange, marketLegs, researchPool, round } from './lib/football.mjs';
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
  })),
};

await mkdir(new URL('.', candidatesPath(date)), { recursive: true });
await writeFile(candidatesPath(date), `${JSON.stringify(out, null, 2)}\n`);
console.log(`${out.games.length} games (of ${all.length} in the window) written to research/${date}.candidates.json`);
