/**
 * Validates research/<date>.json against research/<date>.candidates.json
 * before the research task pushes it. Exits non-zero with the problems.
 *
 * Usage: node scripts/check-research.mjs [YYYY-MM-DD]
 */

import { readFile } from 'node:fs/promises';
import { BOOKS, CHECKS, CONFIDENCE, LEG_KEYS, MAX_SHIFT, candidatesPath, researchPath } from './lib/research.mjs';
import { localDate } from './lib/time.mjs';

const date = process.argv[2] || localDate();
const candidates = JSON.parse(await readFile(candidatesPath(date), 'utf8')).games;
const research = JSON.parse(await readFile(researchPath(date), 'utf8'));

const problems = [];
if (research.date !== date) problems.push(`date is ${research.date}, expected ${date}`);
if (!research.summary) problems.push('summary is empty');
if (!Array.isArray(research.games)) problems.push('games must be an array');

const byId = new Map(candidates.map((g) => [g.id, g]));
const seen = new Set();
for (const v of research.games || []) {
  const where = `game ${v?.id}`;
  const g = byId.get(String(v?.id));
  if (!g) {
    problems.push(`${where}: not a candidate id`);
    continue;
  }
  if (seen.has(g.id)) problems.push(`${where}: duplicate`);
  seen.add(g.id);
  if (typeof v.exclude !== 'boolean') problems.push(`${where}: exclude must be true/false`);
  if (!v.reason || v.reason.length < 40) problems.push(`${where}: reason must say what was found (40+ characters)`);
  if (!v.main_risk) problems.push(`${where}: main_risk is empty`);
  const hosts = new Set((v.sources || []).map((s) => { try { return new URL(s).hostname.replace(/^www\./, ''); } catch { return null; } }).filter(Boolean));
  for (const p of v.prices || []) {
    if (!BOOKS.includes(p.book)) problems.push(`${where}: book "${p.book}" is not one of ${BOOKS.join(', ')}`);
    if (!LEG_KEYS.includes(p.market)) problems.push(`${where}: price market "${p.market}" is not one of ${LEG_KEYS.join(', ')}`);
    if (!(Number(p.odds) >= 1.01)) problems.push(`${where}: bad odds ${p.odds}`);
  }
  if (v.exclude) {
    if (hosts.size < 1) problems.push(`${where}: needs at least one source for the exclusion`);
    continue;
  }
  // A kept game needs the full deep-research record.
  if (!CONFIDENCE.includes(v.confidence)) problems.push(`${where}: confidence must be one of ${CONFIDENCE.join(', ')}`);
  for (const k of Object.keys(CHECKS)) {
    if (!v.checks || String(v.checks[k] || '').trim().length < 20) problems.push(`${where}: checks.${k} is missing or too thin`);
  }
  if (hosts.size < 4) problems.push(`${where}: needs sources from at least 4 different sites, has ${hosts.size}`);
  const p = v.p || {};
  const sum = Number(p.home) + Number(p.draw) + Number(p.away);
  if (!(Math.abs(sum - 1) <= 0.011)) problems.push(`${where}: p.home + p.draw + p.away must be 1, is ${sum}`);
  for (const k of ['home', 'draw', 'away']) {
    const d = Number(p[k]) - g.p_market[k];
    if (!Number.isFinite(d)) problems.push(`${where}: p.${k} must be a number`);
    else if (Math.abs(d) > MAX_SHIFT + 0.0001) problems.push(`${where}: p.${k} moves ${(d * 100).toFixed(1)} points from the market; the limit is ±${MAX_SHIFT * 100}`);
  }
}
for (const g of candidates) if (!seen.has(g.id)) problems.push(`missing verdict for game ${g.id} (${g.event})`);

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
const kept = research.games.filter((v) => !v.exclude).length;
console.log(`OK: ${research.games.length} games, ${kept} kept, ${research.games.length - kept} excluded.`);
