/**
 * Collects every eligible leg in the betting window from Polymarket.
 * Shared by the daily build and the morning research task.
 */

import { fetchSeriesEvents, fetchSports } from './polymarket.mjs';
import { SPORTS, candidateLegs } from './parlay.mjs';

export async function gatherLegs(window) {
  const sports = await fetchSports();
  if (!sports.length) throw new Error('Polymarket returned no sports list');

  const legs = [];
  for (const s of sports) {
    if (!SPORTS[s.sport] || !s.series) continue;
    try {
      const events = await fetchSeriesEvents(s.series, window.start);
      const found = candidateLegs(events, s.sport, window);
      console.error(`${s.sport}: ${events.length} open events, ${found.length} eligible legs`);
      legs.push(...found);
    } catch (e) {
      console.error(`${s.sport}: ${e.message}`);
    }
  }
  return legs;
}

/**
 * The legs worth researching: the most likely ones first, at most two
 * markets per event so the pool spans enough games to build a slip.
 */
export function researchPool(legs, size = 36) {
  const perEvent = new Map();
  return [...legs]
    .sort((a, b) => b.p_market - a.p_market)
    .filter((l) => {
      const n = perEvent.get(l.eventId) || 0;
      perEvent.set(l.eventId, n + 1);
      return n < 2;
    })
    .slice(0, size);
}
