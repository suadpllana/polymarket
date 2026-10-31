/**
 * Picks the day's slip: exactly two legs from two different games, combined
 * odds near 2.0, the highest expected return among the pairs that qualify.
 */

import { MAX_DRAW_FOR_WIN, MIN_LEG_P, SLIP, inRange, legsFor, round } from './football.mjs';
import { applyShift } from './research.mjs';

/** Moving this much (relative) since the morning research makes the game unsafe to bet. */
export const MAX_DRIFT = 0.05;

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
 * Every leg that may go on the slip, with final probabilities.
 * `games` are live games; `research` comes from loadResearch.
 */
export function eligibleLegs(games, research) {
  const out = [];
  const skipped = [];
  for (const g of games) {
    const v = research.games.get(g.id);
    if (!v) continue;
    if (v.exclude) continue;
    const fav = v.morning.home >= v.morning.away ? 'home' : 'away';
    const drift = Math.abs(g.p_market[fav] - v.morning[fav]) / v.morning[fav];
    if (drift > MAX_DRIFT) {
      skipped.push(`${g.event}: price moved ${Math.round(drift * 100)}% since the research`);
      continue;
    }
    const p = applyShift(g.p_market, v.shift);
    for (const leg of legsFor(g, p)) {
      if (!inRange(leg)) continue;
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

export function bestSlip(legs) {
  let best = null;
  for (let i = 0; i < legs.length; i++) {
    for (let j = i + 1; j < legs.length; j++) {
      const a = legs[i];
      const b = legs[j];
      if (a.game.id === b.game.id) continue;
      const odds = a.odds * b.odds;
      if (odds < SLIP.min || odds > SLIP.max) continue;
      const ev = (a.p_win * a.odds + a.p_void) * (b.p_win * b.odds + b.p_void) - 1;
      const p_hit = (a.p_win + a.p_void) * (b.p_win + b.p_void);
      const cand = { legs: [a, b], odds, ev, p_hit };
      if (!best || cand.ev > best.ev + 0.005 || (Math.abs(cand.ev - best.ev) <= 0.005 && cand.p_hit > best.p_hit)) best = cand;
    }
  }
  return best;
}

export function describe(slip) {
  return slip.legs
    .map((l) => `${l.selection} (${l.label}) @ ${l.odds.toFixed(2)}${l.book ? ` ${l.book}` : ' est.'} — ${l.game.event}`)
    .concat(`Combined ${round(slip.odds, 2)}, chance ${Math.round(slip.p_hit * 100)}%, EV ${round(slip.ev * 100, 1)}%`)
    .join('\n');
}
