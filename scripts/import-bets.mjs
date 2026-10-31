/**
 * Adds bets copied from Stake's "My Bets → Settled" page to
 * data/stake-bets.json. Bets already in the file are skipped.
 *
 * Usage: node scripts/import-bets.mjs pasted.txt [--year 2026]
 */

import { readFile, writeFile } from 'node:fs/promises';
import { enrichBets } from '../src/lib/bets.js';
import { parseStakeText } from '../src/lib/stake-parse.js';

const FILE = new URL('../data/stake-bets.json', import.meta.url);
const [input] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const yearArg = process.argv.indexOf('--year');
const year = yearArg > 0 ? Number(process.argv[yearArg + 1]) : undefined;
if (!input) {
  console.error('Usage: node scripts/import-bets.mjs pasted.txt [--year 2026]');
  process.exit(1);
}

let data = { bets: [] };
try {
  data = JSON.parse(await readFile(FILE, 'utf8'));
} catch (e) {
  if (e.code !== 'ENOENT') throw e;
}

const { bets, errors } = parseStakeText(await readFile(input, 'utf8'), { year });
errors.forEach((e) => console.error(`Skipped: ${e}`));
const known = new Set(data.bets.map((b) => b.id));
const fresh = bets.filter((b) => !known.has(b.id));
enrichBets([...data.bets, ...fresh]);

// Keep what came from Stake plus each leg's result; everything else is recomputed by the site.
const keep = (b) => ({
  id: b.id,
  type: b.type,
  status: b.status,
  date: b.date,
  time: b.time,
  odds: b.odds,
  stake: b.stake,
  payout: b.payout,
  legs: b.legs.map((l) => ({
    selection: l.selection,
    market: l.market,
    odds: l.odds,
    date: l.date,
    time: l.time,
    home: l.home,
    away: l.away,
    score: l.score,
    sport: l.sport,
    result: l.result,
    result_from: l.result_from,
    ...(l.note ? { note: l.note } : {}),
    ...(l.level_after_90 ? { level_after_90: true } : {}),
  })),
});

const all = [...data.bets, ...fresh].map(keep).sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));
await writeFile(FILE, `${JSON.stringify({ updated_at: new Date().toISOString(), bets: all }, null, 1)}\n`);
console.log(`Added ${fresh.length} bets (${bets.length - fresh.length} already known). ${all.length} in total.`);
