/**
 * Picks the day's slip: one to three legs from different games, combined odds
 * near 2.0. Confidence comes first: the slip with the fewest medium legs
 * wins; between slips of equal confidence, the one most likely to land.
 *
 * The market is the starting point and research is a filter. Odds and the
 * 60% bar come from the market's own price; research may lower a leg's
 * chance or rule a game out, but never lifts a leg above the market.
 *
 * Only researched legs with medium or high confidence are ever used: no
 * low-confidence legs and no legs priced from the market alone. The pick
 * tries two odds ranges and records which one it used:
 *   1. researched — combined odds 1.85–2.25
 *   2. wider      — combined odds 1.70–2.50
 * If neither has a slip, the day is "No bet".
 * Games the research excluded for a hard reason are never used.
 */

import { MAX_DRAW_FOR_WIN, MIN_LEG_P, SLIP, extraLeg, inRange, legsFor, marketLegs, round } from './football.mjs';
import { applyShift } from './research.mjs';

const MIN_PAYING_ODDS = 1.05;

/** Moving this much (relative, either way) since the latest research makes the game unsafe to bet. */
export const MAX_DRIFT = 0.05;

/**
 * A favourite whose market chance has fallen this much (relative) since the
 * game was FIRST listed is dropped, whatever later re-checks say. An
 * unexplained move against the favourite means the market knows something
 * the research does not. Refreshing prices for a re-check never resets this
 * baseline (candidates keep it as `p_first`).
 */
export const MAX_FADE = 0.04;

/**
 * The same idea for a single leg: a leg whose own market chance has fallen
 * this much (relative) since it was first listed is dropped. Goals and
 * handicap markets are thinner and noisier than the result market, hence the
 * wider limit.
 */
export const MAX_LEG_FADE = 0.05;

const pLose = (l) => Math.max(0, 1 - l.p_win - l.p_void);

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

/** Why a researched game may not be bet at the live price, or null when it may. */
export function driftProblem(g, v) {
  const fav = v.morning.home >= v.morning.away ? 'home' : 'away';
  const drift = Math.abs(g.p_market[fav] - v.morning[fav]) / v.morning[fav];
  if (drift > MAX_DRIFT) return `price moved ${Math.round(drift * 100)}% since the research`;
  const first = v.baseline || v.morning;
  const firstFav = first.home >= first.away ? 'home' : 'away';
  const fade = (first[firstFav] - g.p_market[firstFav]) / first[firstFav];
  if (fade > MAX_FADE) return `the favourite's price fell ${(fade * 100).toFixed(1)}% since the first research`;
  return null;
}

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
  const faded = [];
  for (const g of games) {
    const v = research?.games.get(g.id);
    if (!v || v.skipped || v.exclude || !BETTABLE.includes(v.confidence)) continue;
    const problem = driftProblem(g, v);
    if (problem) {
      skipped.push(`${g.event}: ${problem}`);
      continue;
    }
    const p = applyShift(g.p_market, v.shift);
    const viewShift = v.view_shift || {};
    const researched = new Map(
      [...legsFor(g, p), ...(g.extras || []).map((x) => extraLeg(x, Math.min(0.97, Math.max(0.03, x.p_market + (viewShift[x.key] || 0)))))].map((l) => [l.key, l])
    );
    // Odds and the odds range come from the market's own price: that is what
    // a bookmaker pays on, whatever the research thinks.
    for (const m of marketLegs(g)) {
      if (!inRange(m)) continue;
      // A leg has to pay something: very short prices round to nothing at a bookmaker.
      if (m.est_odds < MIN_PAYING_ODDS) continue;
      const r = researched.get(m.key) || m;
      // Research may lower a leg's chance, never raise it above the market's.
      const p_win = Math.min(m.p_win, r.p_win);
      const p_void = m.p_void === 0 && r.p_void === 0 ? 0 : Math.max(0, 1 - p_win - Math.max(pLose(m), pLose(r)));
      if (p_win + p_void < MIN_LEG_P) continue;
      if ((m.key === 'home' || m.key === 'away') && Math.max(p.draw, g.p_market.draw) > MAX_DRAW_FOR_WIN) continue;
      const first = Number(v.legs_first?.[m.key]);
      const now = m.p_win + m.p_void;
      if (first > 0 && (first - now) / first > MAX_LEG_FADE) {
        faded.push(`${g.event}: ${m.selection} (${m.label}) fell ${(((first - now) / first) * 100).toFixed(1)}% since it was first listed`);
        continue;
      }
      const leg = { ...m, p_win, p_void };
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
  return { legs: out, skipped, faded };
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
    const mediums = set.length - highs;
    const cand = { legs: [...set], odds, ev, p_hit, highs, mediums };
    // Confidence first: fewer medium legs always wins. Between slips of equal
    // confidence, the one most likely to land (or refund); on a near-tie the
    // higher expected return.
    if (
      !best ||
      cand.mediums < best.mediums ||
      (cand.mediums === best.mediums && (cand.p_hit > best.p_hit + 0.005 || (Math.abs(cand.p_hit - best.p_hit) <= 0.005 && cand.ev > best.ev + 0.001)))
    )
      best = cand;
  }
  return best;
}

/** Tries the odds ranges in order and returns the first slip found, with the tier used. */
export function pickSlip(games, research) {
  const { legs, skipped, faded } = eligibleLegs(games, research);
  for (const tier of TIERS) {
    const slip = bestSlip(legs, tier.range);
    if (slip) return { slip, tier: tier.name, skipped, faded };
  }
  return { slip: null, tier: null, skipped, faded, eligible: legs.length };
}

export function describe(slip) {
  return slip.legs
    .map((l) => `${l.selection} (${l.label}) @ ${l.odds.toFixed(2)}${l.book ? ` ${l.book}` : ' est.'} — ${l.game.event} [${l.verdict.confidence}]`)
    .concat(`${slip.legs.length} leg${slip.legs.length > 1 ? 's' : ''}, combined ${round(slip.odds, 2)}, chance ${Math.round(slip.p_hit * 100)}%, EV ${round(slip.ev * 100, 1)}%`)
    .join('\n');
}
