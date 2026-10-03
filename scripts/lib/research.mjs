/**
 * Research verdicts written each morning by the Claude Code research task
 * (see research/INSTRUCTIONS.md) to research/<date>.json.
 *
 * Probabilities stay anchored to Polymarket; a verdict can only nudge them
 * within the analyst bounds or drop the leg. Bookmaker prices found by the
 * research become the odds on the slip.
 */

import { readFile } from 'node:fs/promises';

export const BOOKS = ['Stake', 'Rainbet'];

// Bounds from the analyst rules, in probability points.
const BOUNDS = {
  core: { up: 5, down: 5 },
  high_confidence: { up: 3, down: 10 },
};

export function researchPath(date) {
  return new URL(`../../research/${date}.json`, import.meta.url);
}

/** Best price at an allowed book, if it is plausibly the same market. */
function bestPrice(prices, fairOdds) {
  let best = null;
  for (const p of Array.isArray(prices) ? prices : []) {
    const book = BOOKS.find((b) => b.toLowerCase() === String(p?.book || '').trim().toLowerCase());
    const odds = Number(p?.odds);
    if (!book || !(odds >= 1.01)) continue;
    // A price far from the fair one is almost always a different market or line.
    if (odds > fairOdds * 1.15 || odds < fairOdds * 0.8) continue;
    if (!best || odds > best.odds) best = { book, odds };
  }
  return best;
}

/**
 * Returns { summary, researched_at, verdicts: Map<id, verdict> } or null if
 * there is no research file for the date. Unknown ids are ignored; a leg
 * with no verdict was not researched and must not be used.
 */
export async function loadResearch(date, legs) {
  let raw;
  try {
    raw = JSON.parse(await readFile(researchPath(date), 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`research/${date}.json is unreadable: ${e.message}`);
  }
  if (raw.date !== date || !Array.isArray(raw.verdicts)) {
    throw new Error(`research/${date}.json has the wrong date or no verdicts`);
  }

  const byId = new Map(legs.map((l) => [l.id, l]));
  const verdicts = new Map();
  for (const v of raw.verdicts) {
    const leg = byId.get(v?.id);
    if (!leg || typeof v.exclude !== 'boolean') continue;
    const bound = BOUNDS[leg.lane];
    verdicts.set(leg.id, {
      exclude: v.exclude,
      adjustment_pp: Math.max(-bound.down, Math.min(bound.up, Number(v.adjustment_pp) || 0)),
      reason: String(v.reason || '').slice(0, 300),
      main_risk: String(v.main_risk || '').slice(0, 300),
      sources: (Array.isArray(v.sources) ? v.sources : []).filter((s) => /^https?:\/\//.test(s)).slice(0, 10),
      price: bestPrice(v.prices, leg.odds_exact),
    });
  }
  return {
    summary: String(raw.summary || '').slice(0, 600),
    researched_at: raw.researched_at || null,
    verdicts,
  };
}
