/**
 * Picks the day's slip: one to three legs from different games, combined odds
 * near 2.0, the highest expected return among the slips that qualify.
 *
 * Only researched legs with medium or high confidence are ever used: no
 * low-confidence legs and no legs priced from the market alone. The pick
 * tries two odds ranges and records which one it used:
 *   1. researched — combined odds 1.85–2.25
 *   2. wider      — combined odds 1.70–2.50
 * If neither has a slip, the day is "No bet".
 * Games the research excluded for a hard reason are never used.
 */

import { MAX_DRAW_FOR_WIN, MIN_LEG_P, SLIP, extraLeg, inRange, legsFor, round } from './football.mjs';
import { applyShift } from './research.mjs';

const MIN_PAYING_ODDS = 1.05;

/** Moving this much (relative) since the morning research makes the game unsafe to bet. */
export const MAX_DRIFT = 0.05;

/** The only confidence levels that may go on a slip. */
export const BETTABLE = ['high', 'medium'];

export const TIERS = [
  { name: 'researched', range: { min: SLIP.min, max: SLIP.max } },
  { name: 'wider', range: { min: 1.7, max: 2.5 } },
];

export const TIER_NOTE = {
  researched: '',
  wider: 'Few medium or high confidence legs fit today, so this slip uses a slightly wider odds range (1.70–2.50).',
};

function bookPrice(prices, leg) {
  let best = null;
  for (const p of prices) {
    if (p.market !== leg.key) continue;
    const odds = Number(p.odds);
    // Far from fair almost always means a different market or line.
    if (odds > leg.fair_odds_exact * 1.15 || odds < leg.fair_odds_exact * 0.8) continue;
    if (!best || odds > best.odds) best = { book: p.book, odds };
  }
  return best;
}

/**
 * Every leg that may go on the slip, with final probabilities: researched
 * games only, medium or high confidence. `games` are live games (with
 * extras); `research` comes from loadResearch and may be null.
 */
export function eligibleLegs(games, research) {
  const out = [];
  const skipped = [];
  for (const g of games) {
    const v = research?.games.get(g.id);
    if (!v || v.skipped || v.exclude || !BETTABLE.includes(v.confidence)) continue;
    const fav = v.morning.home >= v.morning.away ? 'home' : 'away';
    const drift = Math.abs(g.p_market[fav] - v.morning[fav]) / v.morning[fav];
    if (drift > MAX_DRIFT) {
      skipped.push(`${g.event}: price moved ${Math.round(drift * 100)}% since the research`);
      continue;
    }
    const p = applyShift(g.p_market, v.shift);
    const viewShift = v.view_shift || {};
    const legs = [
      ...legsFor(g, p),
      ...(g.extras || []).map((x) => extraLeg(x, Math.min(0.97, Math.max(0.03, x.p_market + (viewShift[x.key] || 0))))),
    ];
    for (const leg of legs) {
      if (!inRange(leg)) continue;
      // A leg has to pay something: very short prices round to nothing at a bookmaker.
      if (leg.est_odds < MIN_PAYING_ODDS) continue;
      if (leg.p_win + leg.p_void < MIN_LEG_P) continue;
      if ((leg.key === 'home' || leg.key === 'away') && p.draw > MAX_DRAW_FOR_WIN) continue;
      const book = bookPrice(v.prices, leg);
      out.push({
        game: g,
        verdict: v,
        p,
        ...leg,
        odds: book ? book.odds : leg.est_odds,
        book: book ? book.book : null,
      });
    }
  }
  return { legs: out, skipped };
}

/** Every slip of 1 to `maxLegs` legs, each leg from a different game. */
function* combos(legs, maxLegs, start = 0, chosen = []) {
  if (chosen.length) yield chosen;
  if (chosen.length === maxLegs) return;
  for (let i = start; i < legs.length; i++) {
    if (chosen.some((c) => c.game.id === legs[i].game.id)) continue;
    yield* combos(legs, maxLegs, i + 1, [...chosen, legs[i]]);
  }
}

export function bestSlip(legs, range = SLIP) {
  let best = null;
  for (const set of combos(legs, SLIP.maxLegs)) {
    const odds = set.reduce((o, l) => o * l.odds, 1);
    if (odds < range.min || odds > range.max) continue;
    const ev = set.reduce((x, l) => x * (l.p_win * l.odds + l.p_void), 1) - 1;
    const p_hit = set.reduce((x, l) => x * (l.p_win + l.p_void), 1);
    const highs = set.filter((l) => l.verdict.confidence === 'high').length;
    const cand = { legs: [...set], odds, ev, p_hit, highs };
    // Highest expected return; on a near-tie the more likely slip, then the
    // one with more high-confidence legs.
    if (
      !best ||
      cand.ev > best.ev + 0.005 ||
      (Math.abs(cand.ev - best.ev) <= 0.005 && (cand.p_hit > best.p_hit + 0.005 || (Math.abs(cand.p_hit - best.p_hit) <= 0.005 && cand.highs > best.highs)))
    )
      best = cand;
  }
  return best;
}

/** Tries the odds ranges in order and returns the first slip found, with the tier used. */
export function pickSlip(games, research) {
  const { legs, skipped } = eligibleLegs(games, research);
  for (const tier of TIERS) {
    const slip = bestSlip(legs, tier.range);
    if (slip) return { slip, tier: tier.name, skipped };
  }
  return { slip: null, tier: null, skipped, eligible: legs.length };
}

export function describe(slip) {
  return slip.legs
    .map((l) => `${l.selection} (${l.label}) @ ${l.odds.toFixed(2)}${l.book ? ` ${l.book}` : ' est.'} — ${l.game.event} [${l.verdict.confidence}]`)
    .concat(`${slip.legs.length} leg${slip.legs.length > 1 ? 's' : ''}, combined ${round(slip.odds, 2)}, chance ${Math.round(slip.p_hit * 100)}%, EV ${round(slip.ev * 100, 1)}%`)
    .join('\n');
}
