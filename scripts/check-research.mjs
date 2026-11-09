/**
 * Validates research/<date>.json against research/<date>.candidates.json
 * before the research task pushes it. Exits non-zero with the problems.
 *
 * Usage: node scripts/check-research.mjs [YYYY-MM-DD]
 */

import { readFile } from 'node:fs/promises';
import { BOOKS, CHECKS, CONFIDENCE, LEG_KEYS, MAX_SHIFT, candidatesPath, isLegKey, researchPath } from './lib/research.mjs';
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
  // A game the task did not get to because enough games were already kept
  // needs nothing more than its id: { "id": "...", "exclude": true, "skipped": true }.
  if (v.skipped === true) {
    if (v.exclude !== true) problems.push(`${where}: a skipped game must have exclude: true`);
    continue;
  }
  if (!v.reason || v.reason.length < 40) problems.push(`${where}: reason must say what was found (40+ characters)`);
  if (!v.main_risk) problems.push(`${where}: main_risk is empty`);
  const hosts = new Set((v.sources || []).map((s) => { try { return new URL(s).hostname.replace(/^www\./, ''); } catch { return null; } }).filter(Boolean));
  for (const p of v.prices || []) {
    if (!BOOKS.includes(p.book)) problems.push(`${where}: book "${p.book}" is not one of ${BOOKS.join(', ')}`);
    if (!isLegKey(p.market)) problems.push(`${where}: price market "${p.market}" is not a leg key (see legs_in_range)`);
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
  // Low confidence means facts stayed unknown after real attempts, so fewer sites are accepted.
  const minHosts = v.confidence === 'low' ? 2 : 4;
  if (hosts.size < minHosts) problems.push(`${where}: needs sources from at least ${minHosts} different sites, has ${hosts.size}`);
  const p = v.p || {};
  const sum = Number(p.home) + Number(p.draw) + Number(p.away);
  if (!(Math.abs(sum - 1) <= 0.011)) problems.push(`${where}: p.home + p.draw + p.away must be 1, is ${sum}`);
  const legs = new Map((g.legs_in_range || []).map((l) => [l.key, l]));
  for (const [k, val] of Object.entries(v.views || {})) {
    const leg = legs.get(k);
    if (!leg || LEG_KEYS.includes(k)) problems.push(`${where}: views.${k} is not a goals/BTTS/handicap leg in legs_in_range`);
    else if (!(Math.abs(Number(val) - leg.p_market) <= MAX_SHIFT + 0.0001)) problems.push(`${where}: views.${k} must be within ±${MAX_SHIFT * 100} points of ${leg.p_market}`);
  }
  if (g.p_market.draw === 0 && Number(p.draw) !== 0) problems.push(`${where}: a two-way game (no draw) must have p.draw = 0`);
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
