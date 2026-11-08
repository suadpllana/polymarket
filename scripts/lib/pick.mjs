/**
 * Picks the day's slip: exactly two legs from two different games, combined
 * odds near 2.0, the highest expected return among the pairs that qualify.
 *
 * There is always a slip when at least two games are on. The pick works down
 * a ladder and records which rung it used:
 *   1. researched   — kept games, medium/high confidence, odds 1.85–2.25
 *   2. wider        — kept games of any confidence, odds 1.70–2.50
 *   3. market       — adds games the research skipped or never reached,
 *                     priced from the market alone, odds 1.70–2.50
 *   4. any          — every game not hard-excluded, legs landing ≥ 50%,
 *                     odds 1.50–3.00
 * Games the research excluded for a hard reason are never used.
 */

import { MAX_DRAW_FOR_WIN, MIN_LEG_P, SLIP, extraLeg, inRange, legsFor, round } from './football.mjs';
import { applyShift } from './research.mjs';

/** Moving this much (relative) since the morning research makes the game unsafe to bet. */
export const MAX_DRIFT = 0.05;

export const TIERS = [
  { name: 'researched', confidence: ['high', 'medium'], unresearched: false, range: { min: SLIP.min, max: SLIP.max }, minLegP: MIN_LEG_P, legOdds: true },
  { name: 'wider', confidence: ['high', 'medium', 'low'], unresearched: false, range: { min: 1.7, max: 2.5 }, minLegP: MIN_LEG_P, legOdds: true },
  { name: 'market', confidence: ['high', 'medium', 'low'], unresearched: true, range: { min: 1.7, max: 2.5 }, minLegP: MIN_LEG_P, legOdds: true },
  { name: 'any', confidence: ['high', 'medium', 'low'], unresearched: true, range: { min: 1.5, max: 3.0 }, minLegP: 0.5, legOdds: false },
];

export const TIER_NOTE = {
  researched: '',
  wider: 'Few games passed the research cleanly today, so this slip uses a wider odds range or lower-confidence legs.',
  market: 'Not enough researched games today: at least one leg is priced from the market alone, without a research verdict.',
  any: 'A thin day: this slip uses the most likely legs available, outside the usual odds range. Treat it as lower confidence.',
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

const MARKET_VERDICT = {
  confidence: 'market',
  reason: 'No research verdict for this game: the leg is priced from the Polymarket market alone.',
  main_risk: 'Not researched, so team news, rotation and motivation were not checked.',
  checks: {},
  sources: [],
  prices: [],
};

/**
 * Every leg that may go on the slip in this tier, with final probabilities.
 * `games` are live games (with extras); `research` comes from loadResearch
 * and may be null when no research arrived.
 */
export function eligibleLegs(games, research, tier = TIERS[0]) {
  const out = [];
  const skipped = [];
  for (const g of games) {
    const v = research?.games.get(g.id);
    let verdict;
    let p = g.p_market;
    let viewShift = {};
    if (v && !v.skipped) {
      if (v.exclude || !tier.confidence.includes(v.confidence)) continue;
      const fav = v.morning.home >= v.morning.away ? 'home' : 'away';
      const drift = Math.abs(g.p_market[fav] - v.morning[fav]) / v.morning[fav];
      if (drift > MAX_DRIFT) {
        skipped.push(`${g.event}: price moved ${Math.round(drift * 100)}% since the research`);
        continue;
      }
      p = applyShift(g.p_market, v.shift);
      viewShift = v.view_shift || {};
      verdict = v;
    } else {
      if (!tier.unresearched) continue;
      verdict = MARKET_VERDICT;
    }
    const legs = [
      ...legsFor(g, p),
      ...(g.extras || []).map((x) => extraLeg(x, Math.min(0.97, Math.max(0.03, x.p_market + (viewShift[x.key] || 0))))),
    ];
    for (const leg of legs) {
      if (tier.legOdds && !inRange(leg)) continue;
      if (leg.p_win + leg.p_void < tier.minLegP) continue;
      if ((leg.key === 'home' || leg.key === 'away') && p.draw > MAX_DRAW_FOR_WIN) continue;
      const book = bookPrice(verdict.prices, leg);
      out.push({
        game: g,
        verdict,
        p,
        ...leg,
        odds: book ? book.odds : leg.est_odds,
        book: book ? book.book : null,
      });
    }
  }
  return { legs: out, skipped };
}

export function bestSlip(legs, range = SLIP) {
  let best = null;
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i];
      const b = legs[j];
      if (a.game.id === b.game.id) continue;
      const odds = a.odds * b.odds;
      if (odds < range.min || odds > range.max) continue;
      const ev = (a.p_win * a.odds + a.p_void) * (b.p_win * b.odds + b.p_void) - 1;
      const p_hit = (a.p_win + a.p_void) * (b.p_win + b.p_void);
      // Prefer researched legs: on a near-tie the slip with more research wins.
      const researched = Number(a.verdict.confidence !== 'market') + Number(b.verdict.confidence !== 'market');
      const cand = { legs: [a, b], odds, ev, p_hit, researched };
      if (
        !best ||
        cand.ev > best.ev + 0.005 ||
        (Math.abs(cand.ev - best.ev) <= 0.005 && (cand.researched > best.researched || (cand.researched === best.researched && cand.p_hit > best.p_hit)))
      )
        best = cand;
    }
  }
  return best;
}

/** Walks the tiers and returns the first slip found, with the tier used. */
export function pickSlip(games, research) {
  const skipped = new Set();
  for (const tier of TIERS) {
    const { legs, skipped: s } = eligibleLegs(games, research, tier);
    s.forEach((x) => skipped.add(x));
    const slip = bestSlip(legs, tier.range);
    if (slip) return { slip, tier: tier.name, skipped: [...skipped] };
  }
  return { slip: null, tier: null, skipped: [...skipped] };
}

export function describe(slip) {
  return slip.legs
    .map((l) => `${l.selection} (${l.label}) @ ${l.odds.toFixed(2)}${l.book ? ` ${l.book}` : ' est.'} — ${l.game.event} [${l.verdict.confidence}]`)
    .concat(`Combined ${round(slip.odds, 2)}, chance ${Math.round(slip.p_hit * 100)}%, EV ${round(slip.ev * 100, 1)}%`)
    .join('\n');
}
