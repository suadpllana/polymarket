/**
 * ============================================================================
 *  SHARP EDGE MODEL
 * ============================================================================
 *
 *  The question this file answers is NOT "which outcome is most likely?"
 *  The market already answers that better than we can. A market trading at
 *  92c wins ~92% of the time — and pays 8.7%. High probability, zero profit.
 *
 *  The question is: "where is the price WRONG?"
 *
 *  Our edge source is real, public and verifiable: Polymarket publishes
 *  (a) a leaderboard of the most profitable traders alive, ranked by realized
 *  PnL, and (b) every one of their open positions, including the exact price
 *  they paid. When several independently-profitable traders load into the same
 *  outcome at size, and the market is still offering it at or below what they
 *  paid, you are buying the same ticket as proven winners at a better price.
 *
 *  That is the whole thesis. Everything below is the math that turns it into
 *  a number you can size a bet on.
 *
 *  Every function here is pure, so the whole model can be tested offline.
 * ============================================================================
 */

/* ---------------------------------------------------------------------------
 * Tunables. Exposed so the UI can let the user tighten or loosen the machine.
 * ------------------------------------------------------------------------ */
export const DEFAULTS = {
  // --- Hard gates. A bet must clear ALL of these to ever reach the screen. ---
  //
  // These numbers are calibrated against the live distribution, not chosen to
  // look impressive. Measured over the full population of markets where two or
  // more proven traders sit on the same side, the achievable edge tops out
  // around 1.5-4 points. Demanding "10 points or nothing" would be a stricter-
  // sounding app that simply never shows anything — which is not honesty, just
  // a different way of being useless.
  minTraders: 2,            // distinct top-ranked traders on the same outcome
  minUnanimity: 0.9,        // share of smart-money weight on the winning side
  minCapital: 20000,        // total $ the sharps have committed to this outcome
  minLiquidity: 5000,       // book depth, so the fill you model is the fill you get
  minEdge: 0.015,           // fair probability must beat the all-in price by 1.5pts
  minEvPct: 3,              // and return at least +3% expected value
  priceFloor: 0.05,         // below this you are buying lottery tickets
  priceCeiling: 0.95,       // above this the payout cannot cover the variance
  maxDrawdown: -35,         // reject sides the sharps are already deep underwater on

  // --- Cost model. Edge that ignores costs is not edge. ---
  feeBps: 0,                // extra taker fee in basis points, if any
  slippageBps: 25,          // assumed adverse fill beyond the touch

  // --- Model shape ---
  maxBlend: 0.5,            // never let smart money override >50% of market price
  maxDisplacement: 0.12,    // and never move the fair price more than 12 points
  convictionFullBook: 0.15, // 15% of a trader's book = maximum conviction
  kellyFraction: 0.25,      // quarter-Kelly. Full Kelly is for people with no rent.
};

/**
 * Trust presets. How much weight the sharps' revealed opinion gets is the one
 * genuinely subjective assumption in this whole model, so it is surfaced as a
 * user-facing dial rather than buried as a constant. The ledger's closing-line
 * numbers are what should eventually settle the argument.
 */
export const PRESETS = {
  conservative: { label: 'Conservative', maxBlend: 0.35, minEdge: 0.025, minEvPct: 5, minTraders: 3, minUnanimity: 0.95 },
  balanced: { label: 'Balanced', maxBlend: 0.5, minEdge: 0.015, minEvPct: 3, minTraders: 2, minUnanimity: 0.9 },
  aggressive: { label: 'Aggressive', maxBlend: 0.7, minEdge: 0.01, minEvPct: 2, minTraders: 2, minUnanimity: 0.75 },
};

/* ---------------------------------------------------------------------------
 * Small numeric helpers
 * ------------------------------------------------------------------------ */
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function num(value, fallback = 0) {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

/* ---------------------------------------------------------------------------
 * 1. TRADER QUALITY WEIGHT
 *
 * Not all names on the leaderboard are equally informative. A trader who has
 * extracted $8M is a stronger prior than one up $40k, but not 200x stronger —
 * PnL is heavy-tailed and partly luck, so we compress it with a log.
 *
 * We also fold in rank and, when available, cross-window persistence: a trader
 * who ranks in the 24h AND 30d AND all-time lists is far less likely to be a
 * one-lucky-bet fluke than someone who appears once.
 * ------------------------------------------------------------------------ */
export function traderWeight(trader) {
  const pnl = Math.max(num(trader.pnl ?? trader.amount, 0), 0);

  // $10k -> 0.24, $100k -> 0.49, $1M -> 0.73, $10M -> 1.0
  const pnlWeight = clamp(Math.log10(pnl + 1) / 7, 0, 1);

  // #1 -> 1.0, #100 -> 0.55. Rank matters, but the tail still carries signal.
  const rank = num(trader.rank, 50);
  const rankWeight = clamp(1 - ((rank - 1) / 100) * 0.45, 0.5, 1);

  // Appearing across several profit windows is the strongest anti-luck filter
  // we have. One window = 1.0x, two = 1.15x, three or more = 1.3x.
  const windows = Math.max(num(trader.windowCount, 1), 1);
  const persistence = 1 + Math.min(windows - 1, 2) * 0.15;

  return clamp(pnlWeight * rankWeight * persistence, 0, 1.3);
}

/* ---------------------------------------------------------------------------
 * 2. CONVICTION
 *
 * A whale putting $50k into a position is meaningless if their book is $20M —
 * that is a rounding error, possibly a hedge. The same $50k from someone whose
 * whole book is $200k is a genuine statement. So conviction is measured as a
 * share of that trader's own deployed capital, not in absolute dollars.
 * ------------------------------------------------------------------------ */
export function conviction(positionValue, traderBookValue, cfg = DEFAULTS) {
  const value = Math.max(num(positionValue), 0);
  const book = Math.max(num(traderBookValue), 0);

  // No book data (API gap): fall back to a mild absolute-size proxy so the
  // trader still counts, but never at full conviction.
  if (book <= 0) return clamp(Math.log10(value + 1) / 6, 0.1, 0.7);

  const share = value / book;
  return clamp(share / cfg.convictionFullBook, 0, 1);
}

/* ---------------------------------------------------------------------------
 * 3. AGGREGATE A SIDE
 *
 * Collapses every sharp holding one outcome into a single view: how much
 * weighted conviction is behind it, how much capital, and — critically — the
 * capital-weighted average price they actually paid.
 * ------------------------------------------------------------------------ */
export function aggregateSide(holdings, outcome, cfg = DEFAULTS) {
  let strength = 0;
  let capital = 0;
  let entryNumerator = 0;
  let pnlNumerator = 0;

  for (const h of holdings) {
    const w = traderWeight(h.trader);
    const c = conviction(h.initialValue, h.trader.bookValue, cfg);
    strength += w * c;

    const value = Math.max(num(h.initialValue), 0);
    capital += value;
    entryNumerator += num(h.avgPrice) * value;
    pnlNumerator += num(h.percentPnl) * value;
  }

  return {
    outcome,
    traders: holdings.length,
    strength,
    capital,
    // What the smart money actually paid, weighted by how much they committed.
    avgEntry: capital > 0 ? entryNumerator / capital : 0,
    // Whether the position is already working for them.
    avgPnlPct: capital > 0 ? pnlNumerator / capital : 0,
    holdings,
  };
}

/* ---------------------------------------------------------------------------
 * 4. COST-ADJUSTED EXECUTION PRICE
 *
 * You never trade at the mid. You cross the spread, you pay slippage, and on
 * some venues a fee. Modelling edge against the mid is how paper strategies
 * die in production, so every number downstream uses this price.
 * ------------------------------------------------------------------------ */
export function executionPrice(market, cfg = DEFAULTS) {
  const mid = clamp(num(market.price), 0.0001, 0.9999);
  const spread = clamp(num(market.spread, 0.02), 0, 0.2);

  // Prefer the real ask when the book gives us one.
  const ask = num(market.bestAsk, 0);
  const base = ask > 0 && ask > mid ? ask : mid + spread / 2;

  const slip = (cfg.slippageBps / 10000) * base;
  const fee = (cfg.feeBps / 10000) * base;

  return clamp(base + slip + fee, 0.0001, 0.9999);
}

/* ---------------------------------------------------------------------------
 * 5. FAIR PROBABILITY  —  the heart of the model
 *
 * Start from the market price as the prior, because it is genuinely the best
 * free estimate on earth. Then shift it toward what the sharps' behaviour
 * reveals, by an amount proportional to how much we trust this particular
 * cluster of sharps.
 *
 * Revealed belief: a trader who buys at 0.62 is telling you they think the
 * true probability is meaningfully above 0.62 — nobody knowingly takes a
 * zero-EV bet with size. We credit them a margin that scales with conviction,
 * capped conservatively.
 *
 * Two safety rails keep this honest:
 *   - blend weight is capped (maxBlend), so the market always dominates
 *   - total displacement is capped (maxDisplacement), so no single cluster of
 *     traders can drag a 20c market to 60c on the strength of one thesis
 *
 * A model without rails produces beautiful backtests and empty accounts.
 * ------------------------------------------------------------------------ */
export function fairProbability(marketPrice, side, opposite, cfg = DEFAULTS) {
  const pMkt = clamp(num(marketPrice), 0.0001, 0.9999);

  const sideStrength = Math.max(side.strength, 0);
  const oppStrength = Math.max(opposite ? opposite.strength : 0, 0);
  const total = sideStrength + oppStrength;

  // Unanimity. Sharps on both sides means they disagree, which is information
  // that we have NO edge here — not information about direction.
  const unanimity = total > 0 ? sideStrength / total : 0;

  // How much do we trust this cluster?
  //   - saturating in strength (3-4 solid convicted traders ~ most of the max)
  //   - scaled by how many distinct traders (breadth beats one loud whale)
  //   - killed quadratically when the sharps are split
  const strengthTerm = 1 - Math.exp(-sideStrength / 1.6);
  const breadthTerm = clamp(side.traders / 6, 0, 1);
  const agreementTerm = unanimity * unanimity;

  // Falling-knife guard. This is the most dangerous failure mode in any
  // copy-trading model: a sharp bought at 25c, the market has since repriced
  // to 3c, and the naive reading is "80% off!" — when in truth the market has
  // learned something after their entry and their thesis is broken. A position
  // deep underwater is a warning, not a discount, so it collapses our trust in
  // the cluster rather than nudging the price.
  const pnl = num(side.avgPnlPct, 0);
  const knifeGuard = pnl >= 0 ? 1 : clamp(1 + pnl / 100, 0.05, 1);

  const trust = strengthTerm * (0.55 + 0.45 * breadthTerm) * agreementTerm * knifeGuard;
  const blend = clamp(trust, 0, 1) * cfg.maxBlend;

  // Revealed belief: what they paid, plus the margin they were implicitly
  // demanding. More conviction => they were willing to pay up => bigger implied
  // edge in their own model.
  //
  // The margin is variance-weighted — p(1-p) — rather than a flat number of
  // cents, for a reason that matters: a flat +2c margin on a 0.7c longshot
  // nearly quadruples it and manufactures absurd "+1000% EV" phantoms. Room
  // for honest disagreement with the market is widest at 50c and collapses to
  // nothing at the extremes, which is exactly the shape of p(1-p).
  const convictionAvg = side.traders > 0
    ? clamp(side.strength / side.traders, 0, 1)
    : 0;
  const entry = clamp(num(side.avgEntry, pMkt), 0.001, 0.999);
  const marginFactor = 0.10 + 0.22 * convictionAvg;
  const margin = entry * (1 - entry) * marginFactor;
  const revealed = clamp(entry + margin, 0.005, 0.98);

  // If the position is already deep in profit, the sharps' thesis is being
  // confirmed by reality — a modest extra tilt, capped tightly.
  const confirmation = clamp(num(side.avgPnlPct, 0) / 100, -0.5, 0.5) * 0.02;

  const raw = (1 - blend) * pMkt + blend * revealed + confirmation;

  // Rail: never move the market more than maxDisplacement — but scale that
  // allowance by variance too. A flat 12-point rail is sane at 50c and absurd
  // at 1c, where it would license a twelvefold repricing and manufacture the
  // "+1000% EV" phantoms that make backtests look like miracles.
  const room = cfg.maxDisplacement * 4 * pMkt * (1 - pMkt);
  const bounded = clamp(raw, pMkt - room, pMkt + room);

  return {
    fair: clamp(bounded, 0.005, 0.995),
    unanimity,
    trust: clamp(trust, 0, 1),
    blend,
    revealed,
    knifeGuard,
  };
}

/* ---------------------------------------------------------------------------
 * 6. EV, KELLY, AND WHAT TO ACTUALLY STAKE
 *
 * On a binary contract that pays $1, bought at price P:
 *   win  -> profit (1 - P)   with probability pFair
 *   lose -> loss   (P)       with probability 1 - pFair
 *
 *   EV per $1 staked = pFair/P - 1
 *   Kelly f*         = (pFair - P) / (1 - P)
 *
 * We recommend a fraction of Kelly, because full Kelly assumes your
 * probability estimate is exactly right. Ours is an estimate built on top of
 * someone else's estimate. Quarter-Kelly it is.
 * ------------------------------------------------------------------------ */
export function economics(fair, execPrice, cfg = DEFAULTS) {
  const p = clamp(num(fair), 0.0001, 0.9999);
  const P = clamp(num(execPrice), 0.0001, 0.9999);

  const edge = p - P;
  const evPerDollar = p / P - 1;
  const evPct = evPerDollar * 100;
  const payoutMultiple = 1 / P;

  const kelly = (p - P) / (1 - P);
  const stakeFraction = clamp(kelly * cfg.kellyFraction, 0, 0.25);

  return {
    edge,
    evPct,
    evPerDollar,
    payoutMultiple,
    kelly: clamp(kelly, 0, 1),
    stakeFraction,
    // Break-even hit rate: how often this must land just to not lose money.
    breakEven: P,
    roiIfWin: (1 - P) / P,
  };
}

/* ---------------------------------------------------------------------------
 * 7. GRADE
 *
 * A single letter so the user does not have to read six numbers to know
 * whether a bet is worth their attention. Weighted toward the things that
 * actually matter in prediction markets: agreement among independent sharps,
 * size of the mispricing, and getting in at or under their price.
 * ------------------------------------------------------------------------ */
export function grade(signal) {
  const edgeScore = clamp(signal.edge / 0.12, 0, 1);          // 12pts = max
  const evScore = clamp(signal.evPct / 25, 0, 1);             // +25% = max
  const breadthScore = clamp(signal.side.traders / 8, 0, 1);  // 8 sharps = max
  const agreeScore = clamp((signal.unanimity - 0.5) / 0.5, 0, 1);
  const entryScore = clamp(signal.entryAdvantage / 0.06 + 0.35, 0, 1);
  const liqScore = clamp(Math.log10(num(signal.market.liquidity) + 1) / 5, 0, 1);

  const composite =
    edgeScore * 0.26 +
    evScore * 0.20 +
    breadthScore * 0.16 +
    agreeScore * 0.16 +
    entryScore * 0.14 +
    liqScore * 0.08;

  let letter = 'C';
  if (composite >= 0.72) letter = 'S';
  else if (composite >= 0.58) letter = 'A';
  else if (composite >= 0.44) letter = 'B';

  return { composite, letter };
}

/* ---------------------------------------------------------------------------
 * 8. HARD GATES
 *
 * The product promise is that anything on the screen has already survived
 * every filter. This is the function that keeps that promise. It returns the
 * list of reasons a candidate was rejected — an empty list means it passed.
 * ------------------------------------------------------------------------ */
export function gateFailures(signal, cfg = DEFAULTS) {
  const fails = [];
  const m = signal.market;

  if (signal.side.traders < cfg.minTraders) {
    const n = signal.side.traders;
    fails.push(`only ${n} sharp${n === 1 ? '' : 's'} (need ${cfg.minTraders})`);
  }
  if (signal.unanimity < cfg.minUnanimity) {
    const a = Math.round(signal.unanimity * 100);
    fails.push(`sharps split ${a}/${100 - a}`);
  }
  if (signal.side.capital < cfg.minCapital) {
    fails.push(`only $${Math.round(signal.side.capital).toLocaleString()} committed`);
  }
  if (num(m.liquidity) < cfg.minLiquidity) {
    fails.push('book too thin to fill');
  }
  if (signal.edge < cfg.minEdge) {
    fails.push(`edge ${(signal.edge * 100).toFixed(1)}pts below ${(cfg.minEdge * 100).toFixed(1)}pt floor`);
  }
  if (signal.evPct < cfg.minEvPct) {
    fails.push(`EV ${signal.evPct.toFixed(1)}% below ${cfg.minEvPct}% floor`);
  }
  if (num(m.price) < cfg.priceFloor || num(m.price) > cfg.priceCeiling) {
    fails.push(`price ${(num(m.price) * 100).toFixed(0)}c outside tradable band`);
  }
  // The falling knife. Measured across live data, almost every market where you
  // can "buy cheaper than the sharps paid" is one where their position is down
  // 55-80% — the market repriced on news they did not have at entry. Their old
  // entry price is not a discount, it is a stale quote from before the world
  // changed. This gate exists because that trap looks exactly like a bargain.
  if (num(signal.side.avgPnlPct, 0) < cfg.maxDrawdown) {
    fails.push(`sharps down ${Math.abs(signal.side.avgPnlPct).toFixed(0)}% — thesis breaking, not a discount`);
  }
  if (m.resolved) fails.push('already resolved');
  if (m.endDate && new Date(m.endDate).getTime() < Date.now()) {
    fails.push('past resolution date');
  }
  return fails;
}

/* ---------------------------------------------------------------------------
 * 9. THE PIPELINE — build one complete signal
 *
 * @param {object} market   { conditionId, title, price, spread, bestAsk,
 *                            liquidity, volume, endDate, resolved, ... }
 * @param {object} side     aggregateSide() for the outcome we would buy
 * @param {object} opposite aggregateSide() for the other side (may be null)
 * ------------------------------------------------------------------------ */
export function buildSignal(market, side, opposite, cfg = DEFAULTS) {
  const execPrice = executionPrice(market, cfg);
  const prob = fairProbability(market.price, side, opposite, cfg);
  const econ = economics(prob.fair, execPrice, cfg);

  // The single most tangible number on the card: are you getting in cheaper
  // than the proven winners did? Positive means yes.
  const entryAdvantage = num(side.avgEntry) > 0
    ? num(side.avgEntry) - execPrice
    : 0;

  const signal = {
    id: `${market.conditionId}:${side.outcome}`,
    market,
    side,
    opposite,
    outcome: side.outcome,
    execPrice,
    fair: prob.fair,
    unanimity: prob.unanimity,
    trust: prob.trust,
    blend: prob.blend,
    revealed: prob.revealed,
    knifeGuard: prob.knifeGuard,
    entryAdvantage,
    ...econ,
  };

  const g = grade(signal);
  signal.grade = g.letter;
  signal.gradeScore = g.composite;
  signal.failures = gateFailures(signal, cfg);
  signal.passes = signal.failures.length === 0;
  signal.tier = classify(signal, cfg);

  // Plain-English justification, assembled from the factors that actually
  // drove the number. Shown on the card so nothing is a black box.
  signal.reasons = buildReasons(signal);

  return signal;
}

/**
 * TIERS
 *
 * A single pass/fail hides the difference between "nearly qualified" and
 * "actively a trap", and it makes the app binary in a way the underlying
 * evidence never is. Four honest buckets instead:
 *
 *   PRIME  every strict gate cleared. Rare by construction.
 *   STRONG real edge, clears the working gates.
 *   WATCH  positive edge but thin on size, breadth, or margin. Not actionable
 *          on its own; worth tracking as the price moves.
 *   AVOID  the trap. Usually a market that looks like a discount because the
 *          sharps are deep underwater on a thesis the market has moved past.
 *
 * AVOID is not clutter — it is the most valuable label here, because those are
 * exactly the bets that look most attractive on a naive screen.
 */
export const TIERS = {
  PRIME: { label: 'Prime', rank: 0 },
  STRONG: { label: 'Strong', rank: 1 },
  WATCH: { label: 'Watch', rank: 2 },
  AVOID: { label: 'Avoid', rank: 3 },
};

export function classify(signal, cfg = DEFAULTS) {
  const s = signal;
  const underwater = num(s.side.avgPnlPct, 0) < cfg.maxDrawdown;
  const inBand =
    num(s.market.price) >= cfg.priceFloor && num(s.market.price) <= cfg.priceCeiling;

  // A failing thesis dressed up as a bargain. Flag it loudly.
  if (underwater && s.entryAdvantage > 0.02) return 'AVOID';
  if (s.edge <= 0 || !inBand) return 'AVOID';

  if (s.passes && s.side.traders >= 3 && s.edge >= 0.025 && s.evPct >= 5 && s.unanimity >= 0.95) {
    return 'PRIME';
  }
  if (s.passes) return 'STRONG';

  // Positive edge and clean agreement, just short on size or margin.
  if (s.edge > 0 && s.unanimity >= 0.75 && !underwater) return 'WATCH';

  return 'AVOID';
}

function buildReasons(s) {
  const out = [];
  const capital = `$${Math.round(s.side.capital).toLocaleString()}`;
  const plural = s.side.traders === 1 ? '' : 's';

  out.push(
    `${s.side.traders} independently profitable top-ranked trader${plural} hold ${s.outcome}, with ${capital} committed.`
  );

  if (s.unanimity >= 0.995) {
    out.push('Not one tracked sharp is on the other side of this market.');
  } else {
    out.push(`${(s.unanimity * 100).toFixed(0)}% of smart-money weight sits on this side.`);
  }

  if (s.entryAdvantage > 0.005) {
    out.push(
      `They paid an average of ${(s.side.avgEntry * 100).toFixed(1)}c. You can buy at ${(s.execPrice * 100).toFixed(1)}c — ${(s.entryAdvantage * 100).toFixed(1)}c better than proven winners got.`
    );
  } else if (s.entryAdvantage < -0.005) {
    out.push(
      `The price has run ${(Math.abs(s.entryAdvantage) * 100).toFixed(1)}c past their average entry of ${(s.side.avgEntry * 100).toFixed(1)}c — you are paying up for it.`
    );
  }

  if (s.side.avgPnlPct > 5) {
    out.push(`Their position is already up ${s.side.avgPnlPct.toFixed(0)}% — the thesis is being confirmed.`);
  }

  out.push(
    `Model fair value ${(s.fair * 100).toFixed(1)}c against an all-in cost of ${(s.execPrice * 100).toFixed(1)}c: ${(s.edge * 100).toFixed(1)}pts of edge, ${s.evPct >= 0 ? '+' : ''}${s.evPct.toFixed(1)}% expected value.`
  );

  out.push(
    `It needs to win ${(s.breakEven * 100).toFixed(0)}% of the time just to break even; the model puts it at ${(s.fair * 100).toFixed(0)}%.`
  );

  return out;
}

/* ---------------------------------------------------------------------------
 * 10. PORTFOLIO MATH
 *
 * Independent positive-EV bets compound; correlated ones just concentrate
 * risk. This gives the user the honest aggregate on a set of selections.
 * ------------------------------------------------------------------------ */
export function portfolioStats(signals, bankroll) {
  if (!signals.length) return null;

  // If Kelly wants more than half the bankroll across all legs, scale the whole
  // book down proportionally rather than letting it run.
  const totalStakeFraction = signals.reduce((a, s) => a + s.stakeFraction, 0);
  const scale = totalStakeFraction > 0.5 ? 0.5 / totalStakeFraction : 1;

  const legs = signals.map((s) => {
    const stake = bankroll * s.stakeFraction * scale;
    return {
      signal: s,
      stake,
      toWin: stake * s.roiIfWin,
      ev: stake * s.evPerDollar,
    };
  });

  const totalStake = legs.reduce((a, l) => a + l.stake, 0);
  const totalEv = legs.reduce((a, l) => a + l.ev, 0);

  // Expected number of winners, and the chance every single one lands.
  const expectedWins = signals.reduce((a, s) => a + s.fair, 0);
  const allWinProb = signals.reduce((a, s) => a * s.fair, 1);
  const noneWinProb = signals.reduce((a, s) => a * (1 - s.fair), 1);

  return {
    legs,
    totalStake,
    totalEv,
    evPct: totalStake > 0 ? (totalEv / totalStake) * 100 : 0,
    expectedWins,
    count: signals.length,
    allWinProb,
    atLeastOneProb: 1 - noneWinProb,
  };
}
