/**
 * ============================================================================
 *  COHERENCE ARBITRAGE
 * ============================================================================
 *
 *  Everything in model.js rests on a judgement call: how much to trust a
 *  cluster of proven traders. Reasonable people can argue about the number.
 *
 *  This file needs no such argument.
 *
 *  In a mutually-exclusive event — one nominee, one winner, one champion —
 *  exactly one outcome resolves YES. So if you buy every outcome, you are
 *  guaranteed to be paid exactly $1. If the asks add up to $0.95, you have
 *  bought a certain dollar for ninety-five cents. That is arithmetic. It does
 *  not care whether anyone's thesis is right.
 *
 *  What it DOES care about, and what this file is scrupulous about reporting:
 *
 *   - TIME. A 5% return that resolves in three weeks is superb. The same 5%
 *     locked up until a 2028 election is roughly 2% a year, which is worse
 *     than a savings account. Every opportunity is annualized, and that number
 *     is the one worth ranking on.
 *   - DEPTH. bestAsk is the top of the book, not the whole book. Fifty legs
 *     that each quote 0.4c mean nothing if only $12 sits at that price.
 *   - COMPLETENESS. Miss one leg and the guarantee evaporates entirely — you
 *     are left holding a directional bet you never wanted.
 * ============================================================================
 */

import { num, clamp } from './model.js';

function parseArr(v) {
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Pulls the YES price and ask for a single market inside a grouped event.
 */
function readLeg(market) {
  const outcomes = parseArr(market.outcomes);
  const prices = parseArr(market.outcomePrices).map(Number);
  if (!outcomes.length || prices.length !== outcomes.length) return null;

  let idx = outcomes.findIndex((o) => String(o).toLowerCase() === 'yes');
  if (idx < 0) idx = 0;

  const mid = prices[idx];
  if (!Number.isFinite(mid)) return null;

  const spread = num(market.spread, 0.02);
  const quotedAsk = idx === 0 ? num(market.bestAsk) : 0;
  const ask = quotedAsk > 0 ? quotedAsk : clamp(mid + spread / 2, 0.0001, 1);

  return {
    conditionId: market.conditionId,
    title: market.groupItemTitle || market.question || 'Outcome',
    slug: market.slug || '',
    mid,
    ask,
    spread,
    liquidity: num(market.liquidityNum ?? market.liquidity),
    acceptingOrders: market.acceptingOrders !== false,
  };
}

/**
 * Scans grouped events for coherence violations.
 *
 * @param {Array} events - Gamma events, each with a `markets` array
 * @param {object} opts
 * @param {number} opts.minProfitPct   floor on raw guaranteed return
 * @param {number} opts.minLegLiquidity depth required on EVERY leg
 * @returns {Array} opportunities, best annualized return first
 */
export function findArbitrage(events, opts = {}) {
  const minProfitPct = opts.minProfitPct ?? 0.5;
  const minLegLiquidity = opts.minLegLiquidity ?? 500;

  const found = [];

  for (const ev of events || []) {
    const markets = (ev.markets || []).filter(
      (m) => m.closed !== true && m.active !== false
    );
    if (markets.length < 2) continue;

    // Only mutually-exclusive groups carry the guarantee. Polymarket flags
    // these as negative-risk; without that flag, "buy everything" is just an
    // expensive way to own a lot of unrelated contracts.
    const exclusive = ev.negRisk === true || markets.some((m) => m.negRisk === true);
    if (!exclusive) continue;

    const legs = [];
    let complete = true;

    for (const m of markets) {
      const leg = readLeg(m);
      if (!leg || !leg.acceptingOrders) {
        complete = false;
        break;
      }
      legs.push(leg);
    }
    // A missing or halted leg breaks the guarantee outright. No partial credit.
    if (!complete || legs.length < 2) continue;

    const sumAsk = legs.reduce((a, l) => a + l.ask, 0);
    const sumMid = legs.reduce((a, l) => a + l.mid, 0);
    if (sumAsk >= 1) continue;

    // Buy the full set for sumAsk, collect exactly $1 at resolution.
    const profitPct = (1 / sumAsk - 1) * 100;
    if (profitPct < minProfitPct) continue;

    // Time to resolution decides whether this is a great trade or a bad bond.
    const endTimes = markets
      .map((m) => new Date(m.endDate || ev.endDate || 0).getTime())
      .filter((t) => Number.isFinite(t) && t > 0);
    const resolveAt = endTimes.length ? Math.max(...endTimes) : null;
    const days = resolveAt ? Math.max((resolveAt - Date.now()) / 86400000, 0.5) : null;
    const annualizedPct = days ? ((1 / sumAsk) ** (365 / days) - 1) * 100 : null;

    const thinLegs = legs.filter((l) => l.liquidity < minLegLiquidity);
    const minLiq = Math.min(...legs.map((l) => l.liquidity));

    found.push({
      id: `arb:${ev.id || ev.slug}`,
      kind: 'arbitrage',
      title: ev.title || 'Untitled event',
      slug: ev.slug || '',
      icon: ev.icon || ev.image || '',
      url: ev.slug ? `https://polymarket.com/event/${ev.slug}` : 'https://polymarket.com',
      legs,
      legCount: legs.length,
      sumAsk,
      sumMid,
      costPerDollar: sumAsk,
      profitPct,
      annualizedPct,
      days,
      resolveAt,
      volume: num(ev.volume),
      minLegLiquidity: minLiq,
      thinLegs: thinLegs.length,
      // Practical cap: you cannot put more through this than the thinnest leg
      // will absorb, and taking the whole visible book is optimistic anyway.
      maxSize: Math.max(0, minLiq * 0.25),
      warnings: buildWarnings({ legs, thinLegs, days, annualizedPct, minLiq }),
    });
  }

  // Annualized return is the honest ranking key. A locked-up 5% until 2028 is
  // not better than a 2% that settles next month.
  found.sort((a, b) => (b.annualizedPct ?? -1) - (a.annualizedPct ?? -1));
  return found;
}

function buildWarnings({ legs, thinLegs, days, annualizedPct, minLiq }) {
  const w = [];

  if (legs.length > 20) {
    w.push(
      `${legs.length} separate orders must all fill. Partial execution leaves you with a directional bet, not an arbitrage.`
    );
  }
  if (thinLegs.length > 0) {
    w.push(
      `${thinLegs.length} leg${thinLegs.length === 1 ? '' : 's'} thinner than $500 of depth — the quoted price may not survive your order.`
    );
  }
  if (minLiq < 5000) {
    w.push(`Thinnest leg holds about $${Math.round(minLiq).toLocaleString()}; size accordingly.`);
  }
  if (days && days > 180) {
    w.push(
      `Capital is locked for roughly ${Math.round(days)} days${
        annualizedPct != null ? `, which is only ~${annualizedPct.toFixed(1)}% a year` : ''
      }.`
    );
  }
  w.push('Quotes are top-of-book snapshots and move constantly. Re-check before committing.');
  return w;
}

/**
 * Turns an opportunity into a concrete, per-leg order plan for a given budget.
 * To collect exactly $N at resolution you buy N shares of every outcome.
 */
export function buildArbPlan(opportunity, budget) {
  const shares = budget / opportunity.sumAsk;

  return {
    budget,
    shares,
    guaranteedReturn: shares,
    profit: shares - budget,
    profitPct: opportunity.profitPct,
    legs: opportunity.legs.map((l) => ({
      ...l,
      shares,
      cost: shares * l.ask,
      // How much of this leg's visible depth the order would consume.
      bookShare: l.liquidity > 0 ? (shares * l.ask) / l.liquidity : Infinity,
    })),
  };
}
