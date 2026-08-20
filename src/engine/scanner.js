/**
 * ============================================================================
 *  SCANNER — turns public Polymarket data into graded, sized bets
 * ============================================================================
 *
 *  Pipeline:
 *    1. Build a roster of proven traders across several profit windows
 *    2. Load each trader's book value (denominator for conviction)
 *    3. Pull every open position they hold
 *    4. Group positions by market AND outcome — this is the key step, because
 *       a market where sharps sit on BOTH sides carries no directional signal
 *    5. Re-price every candidate market against the live book
 *    6. Run the model, apply the hard gates, rank what survives
 *
 *  Everything here is orchestration and data hygiene. All judgement lives in
 *  model.js, which is pure and unit-tested.
 * ============================================================================
 */

import {
  fetchSmartMoneyRoster,
  fetchTraderBookValues,
  fetchBatchTraderPositions,
  fetchMarketsByConditionIds,
  fetchTrendingEvents,
} from '../api.js';

import { aggregateSide, buildSignal, DEFAULTS, num } from './model.js';
import { findArbitrage } from './arb.js';

/**
 * A position is dead to us if it is resolved, redeemable, expired, or pinned
 * at a price where nothing tradable remains.
 */
function isLivePosition(pos) {
  if (!pos || !pos.conditionId) return false;
  if (pos.redeemable) return false;

  const price = num(pos.curPrice, 0);
  if (price <= 0.005 || price >= 0.995) return false;

  if (pos.endDate) {
    const end = new Date(pos.endDate).getTime();
    if (Number.isFinite(end) && end < Date.now()) return false;
  }
  return true;
}

/**
 * Runs a full scan.
 *
 * @param {object} options
 * @param {object} options.cfg        model config (see model.js DEFAULTS)
 * @param {string[]} options.windows  leaderboard windows to merge
 * @param {number} options.rosterSize traders per window
 * @param {function} options.onProgress (phase, done, total, label) => void
 * @param {boolean} options.forceRefresh bypass caches
 * @returns {Promise<object>} { signals, rejected, stats, roster }
 */
export async function runScan({
  cfg = DEFAULTS,
  windows = ['30d', '7d', 'all'],
  rosterSize = 100,
  onProgress = () => {},
  forceRefresh = false,
} = {}) {
  const startedAt = Date.now();

  /* --- 1. Roster ------------------------------------------------------- */
  onProgress('roster', 0, 1, 'Assembling smart-money roster');
  const roster = await fetchSmartMoneyRoster(windows, rosterSize, forceRefresh);

  if (!roster.length) {
    throw new Error('Leaderboard returned no traders — Polymarket may be rate-limiting.');
  }

  /* --- 2. Book values -------------------------------------------------- */
  onProgress('books', 0, roster.length, 'Measuring portfolio sizes');
  await fetchTraderBookValues(roster, (done, total) => {
    onProgress('books', done, total, 'Measuring portfolio sizes');
  });

  /* --- 3. Positions ---------------------------------------------------- */
  onProgress('positions', 0, roster.length, 'Reading open positions');
  const batches = await fetchBatchTraderPositions(
    roster,
    (done, total, label) => onProgress('positions', done, total, label),
    6
  );

  /* --- 4. Group by market + outcome ------------------------------------ */
  onProgress('group', 0, 1, 'Grouping by market and side');

  // conditionId -> { meta, sides: Map<outcome, holdings[]> }
  const markets = new Map();
  let livePositions = 0;

  for (const { trader, positions } of batches) {
    if (!Array.isArray(positions)) continue;

    for (const pos of positions) {
      if (!isLivePosition(pos)) continue;
      livePositions++;

      const cid = pos.conditionId;
      if (!markets.has(cid)) {
        markets.set(cid, {
          conditionId: cid,
          title: pos.title || 'Unknown market',
          slug: pos.slug || '',
          eventSlug: pos.eventSlug || '',
          icon: pos.icon || '',
          endDate: pos.endDate || null,
          negativeRisk: pos.negativeRisk === true,
          fallbackPrice: num(pos.curPrice, 0),
          sides: new Map(),
        });
      }

      const entry = markets.get(cid);
      const outcome = pos.outcome || 'Yes';
      if (!entry.sides.has(outcome)) entry.sides.set(outcome, []);

      entry.sides.get(outcome).push({
        trader,
        avgPrice: num(pos.avgPrice),
        initialValue: num(pos.initialValue),
        currentValue: num(pos.currentValue),
        size: num(pos.size),
        percentPnl: num(pos.percentPnl),
        curPrice: num(pos.curPrice),
        outcomeIndex: num(pos.outcomeIndex, 0),
      });
    }
  }

  /* --- 5. Re-price against the live book -------------------------------- */
  // Only bother pricing markets that already have enough sharps on one side to
  // have any chance of clearing the gates. Saves a lot of requests.
  const worthPricing = [...markets.values()].filter((m) =>
    [...m.sides.values()].some((holdings) => holdings.length >= cfg.minTraders)
  );

  onProgress('pricing', 0, worthPricing.length, 'Re-pricing against live order books');
  const liveMarkets = await fetchMarketsByConditionIds(
    worthPricing.map((m) => m.conditionId),
    forceRefresh
  );
  onProgress('pricing', worthPricing.length, worthPricing.length, 'Re-pricing against live order books');

  /* --- 6. Model + gates -------------------------------------------------- */
  onProgress('scoring', 0, worthPricing.length, 'Scoring candidates');

  const signals = [];
  const rejected = [];

  for (const entry of worthPricing) {
    const live = liveMarkets.get(entry.conditionId);

    for (const [outcome, holdings] of entry.sides.entries()) {
      if (holdings.length < cfg.minTraders) continue;

      // Everything the sharps hold that ISN'T this outcome counts as opposition.
      const opposingHoldings = [];
      for (const [other, list] of entry.sides.entries()) {
        if (other !== outcome) opposingHoldings.push(...list);
      }

      const side = aggregateSide(holdings, outcome, cfg);
      const opposite = opposingHoldings.length
        ? aggregateSide(opposingHoldings, 'other', cfg)
        : null;

      const market = resolveMarketPricing(entry, live, outcome, holdings);
      const signal = buildSignal(market, side, opposite, cfg);

      if (signal.passes) signals.push(signal);
      else rejected.push(signal);
    }
  }

  // Tiered view. `signals` holds only what cleared every gate; the watchlist
  // and trap list come out of the rejects, because "nearly qualified" and
  // "actively dangerous" deserve very different treatment on screen.
  const watchlist = rejected
    .filter((s) => s.tier === 'WATCH')
    .sort((a, b) => b.edge - a.edge);

  const traps = rejected
    .filter((s) => s.tier === 'AVOID' && s.entryAdvantage > 0.02)
    .sort((a, b) => a.side.avgPnlPct - b.side.avgPnlPct);

  // Best expected value first — that is the number that pays the rent.
  signals.sort((a, b) => b.gradeScore - a.gradeScore || b.evPct - a.evPct);
  rejected.sort((a, b) => b.evPct - a.evPct);

  /* --- 7. Coherence arbitrage (independent of everything above) ---------- */
  // This pass needs no roster and trusts nobody. It runs separately so a
  // failure here can never take the smart-money results down with it.
  onProgress('arbitrage', 0, 1, 'Checking mutually-exclusive events for mispricing');
  let arbitrage = [];
  try {
    const events = await fetchTrendingEvents(120, forceRefresh);
    arbitrage = findArbitrage(Array.isArray(events) ? events : []);
  } catch (e) {
    console.warn('Arbitrage pass failed (smart-money results unaffected):', e.message);
  }

  return {
    signals,
    rejected,
    watchlist,
    traps,
    arbitrage,
    roster,
    liveMarkets,
    stats: {
      tradersScanned: roster.length,
      livePositions,
      marketsSeen: markets.size,
      marketsPriced: liveMarkets.size,
      candidates: worthPricing.length,
      passed: signals.length,
      rejected: rejected.length,
      watchlist: watchlist.length,
      traps: traps.length,
      arbitrage: arbitrage.length,
      prime: signals.filter((s) => s.tier === 'PRIME').length,
      elapsedMs: Date.now() - startedAt,
      scannedAt: Date.now(),
    },
  };
}

/**
 * Merges position-derived market data with the live Gamma book.
 *
 * The live book is authoritative for price, spread and depth. Position data is
 * the fallback when Gamma has no record (rare, but it happens for markets that
 * have just rolled). When we fall back we widen the assumed spread, because an
 * unknown book is a worse book.
 */
function resolveMarketPricing(entry, live, outcome, holdings) {
  const base = {
    conditionId: entry.conditionId,
    title: entry.title,
    slug: entry.slug,
    eventSlug: entry.eventSlug,
    icon: entry.icon,
    endDate: entry.endDate,
    outcome,
    negRisk: entry.negativeRisk,
  };

  if (!live) {
    // No live book: trust the position snapshot, assume a wide spread.
    const price = holdings.length
      ? holdings.reduce((a, h) => a + h.curPrice, 0) / holdings.length
      : entry.fallbackPrice;

    return {
      ...base,
      price,
      spread: 0.04,
      bestAsk: 0,
      liquidity: 0,
      volume: 0,
      volume24hr: 0,
      momentum24h: 0,
      resolved: false,
      stale: true,
      url: entry.slug
        ? `https://polymarket.com/market/${entry.slug}`
        : `https://polymarket.com/event/${entry.eventSlug}`,
    };
  }

  // Match our outcome to its index in the live book so we read the right price.
  let idx = live.outcomes.findIndex(
    (o) => String(o).toLowerCase() === String(outcome).toLowerCase()
  );
  if (idx < 0) idx = holdings.length ? holdings[0].outcomeIndex : 0;

  const price = Number.isFinite(live.prices[idx])
    ? live.prices[idx]
    : entry.fallbackPrice;

  // bestBid/bestAsk on Gamma describe outcome 0. For any other outcome the
  // book is mirrored, so an ask on index 1 is (1 - bid) on index 0.
  const bestAsk = idx === 0
    ? live.bestAsk
    : live.bestBid > 0
      ? 1 - live.bestBid
      : 0;

  const momentum = idx === 0 ? live.oneDayPriceChange : -live.oneDayPriceChange;

  return {
    ...base,
    title: live.question || base.title,
    slug: live.slug || base.slug,
    icon: live.icon || base.icon,
    endDate: live.endDate || base.endDate,
    price,
    spread: live.spread || 0.02,
    bestAsk,
    liquidity: live.liquidity,
    volume: live.volume,
    volume24hr: live.volume24hr,
    momentum24h: momentum,
    competitive: live.competitive,
    resolved: live.closed || !live.acceptingOrders,
    stale: false,
    url: live.slug
      ? `https://polymarket.com/market/${live.slug}`
      : `https://polymarket.com/event/${live.eventSlug || base.eventSlug}`,
  };
}
