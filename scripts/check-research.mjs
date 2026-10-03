/**
 * Validates research/<date>.json against research/<date>.candidates.json
 * before the research task pushes it. Exits non-zero with the problems.
 *
 * Usage: node scripts/check-research.mjs [YYYY-MM-DD]
 */

import { readFile } from 'node:fs/promises';
import { BOOKS } from './lib/research.mjs';
import { localDate } from './lib/time.mjs';

const date = process.argv[2] || localDate();
const dir = new URL('../research/', import.meta.url);
const candidates = JSON.parse(await readFile(new URL(`${date}.candidates.json`, dir), 'utf8')).candidates;
const research = JSON.parse(await readFile(new URL(`${date}.json`, dir), 'utf8'));

const problems = [];
if (research.date !== date) problems.push(`date is ${research.date}, expected ${date}`);
if (!research.summary) problems.push('summary is empty');
if (!Array.isArray(research.verdicts)) problems.push('verdicts must be an array');

const ids = new Set(candidates.map((c) => c.id));
const seen = new Set();
for (const v of research.verdicts || []) {
  const where = `verdict ${v?.id}`;
  if (!ids.has(v?.id)) problems.push(`${where}: not a candidate id`);
  if (seen.has(v?.id)) problems.push(`${where}: duplicate`);
  seen.add(v?.id);
  if (typeof v.exclude !== 'boolean') problems.push(`${where}: exclude must be true/false`);
  if (typeof v.adjustment_pp !== 'number') problems.push(`${where}: adjustment_pp must be a number`);
  if (!v.reason) problems.push(`${where}: reason is empty`);
  if (!v.main_risk) problems.push(`${where}: main_risk is empty`);
  if (!Array.isArray(v.sources) || !v.sources.length) problems.push(`${where}: needs at least one source URL`);
  for (const p of v.prices || []) {
    if (!BOOKS.includes(p.book)) problems.push(`${where}: book "${p.book}" is not one of ${BOOKS.join(', ')}`);
    if (!(Number(p.odds) >= 1.01)) problems.push(`${where}: bad odds ${p.odds}`);
  }
}
for (const id of ids) if (!seen.has(id)) problems.push(`missing verdict for ${id}`);

if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
const kept = research.verdicts.filter((v) => !v.exclude).length;
console.log(`OK: ${research.verdicts.length} verdicts, ${kept} kept, ${research.verdicts.length - kept} excluded.`);
