/**
 * Morning step for the research task: writes today's candidate legs to
 * research/<date>.candidates.json so they can be researched.
 *
 * Usage: node scripts/candidates.mjs
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { gatherLegs, researchPool } from './lib/gather.mjs';
import { bettingWindow, localDate } from './lib/time.mjs';

const date = localDate();
const window = bettingWindow();
const legs = researchPool(await gatherLegs(window));

const out = {
  date,
  window: { start: window.start.toISOString(), end: window.end.toISOString() },
  candidates: legs.map((l) => ({
    id: l.id,
    sport: l.sport,
    league: l.league,
    lane: l.lane,
    event: l.event,
    start: l.start,
    market: l.label,
    selection: l.selection,
    p_market: l.p_market,
    fair_odds: l.odds,
  })),
};

const dir = new URL('../research/', import.meta.url);
await mkdir(dir, { recursive: true });
const file = new URL(`${date}.candidates.json`, dir);
await writeFile(file, `${JSON.stringify(out, null, 2)}\n`);
console.log(`${out.candidates.length} candidates written to research/${date}.candidates.json`);
