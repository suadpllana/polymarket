/**
 * ============================================================================
 *  LEDGER — the model's report card
 * ============================================================================
 *
 *  Any tool can display a confident number. The only thing that separates a
 *  real edge from a good-looking one is a record kept in public, from before
 *  the outcome was known.
 *
 *  So: every signal this app surfaces is written down the moment it appears,
 *  with the price at that instant. On every later scan we check back. When a
 *  market resolves, the entry settles win or lose and the realised hit rate,
 *  ROI, and calibration update automatically.
 *
 *  Two properties make this honest rather than decorative:
 *
 *   - Entries are stamped at first sight and never re-stamped. The recorded
 *     price is the one you could actually have taken, not a later better one.
 *   - We also record Closing Line Value: whether the price moved our way after
 *     we called it. CLV is the single best fast proxy for genuine edge, because
 *     it pays off long before slow markets resolve. If the app consistently
 *     beats the close, the edge is real even on a small settled sample.
 * ============================================================================
 */

const STORE_KEY = 'sharpedge_ledger_v1';
const MAX_ENTRIES = 1000;

function safeRead() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return { entries: {}, version: 1 };
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && parsed.entries
      ? parsed
      : { entries: {}, version: 1 };
  } catch (e) {
    console.warn('Ledger unreadable, starting fresh:', e.message);
    return { entries: {}, version: 1 };
  }
}

function safeWrite(store) {
  try {
    // Keep the ledger bounded: drop the oldest settled entries first.
    const keys = Object.keys(store.entries);
    if (keys.length > MAX_ENTRIES) {
      const settled = keys
        .filter((k) => store.entries[k].status !== 'open')
        .sort((a, b) => store.entries[a].firstSeen - store.entries[b].firstSeen);

      for (const k of settled.slice(0, keys.length - MAX_ENTRIES)) {
        delete store.entries[k];
      }
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(store));
  } catch (e) {
    console.warn('Could not persist ledger:', e.message);
  }
}

/**
 * Records freshly surfaced signals. Existing entries keep their original
 * stamp — that immutability is the whole point — but we refresh the current
 * price so closing-line value can be computed later.
 *
 * @param {Array} signals - passing signals from the scanner
 * @returns {object} the updated store
 */
export function recordSignals(signals) {
  const store = safeRead();
  const now = Date.now();

  for (const s of signals) {
    const key = s.id;
    const existing = store.entries[key];

    if (existing) {
      if (existing.status === 'open') {
        existing.lastPrice = s.market.price;
        existing.lastSeen = now;
        existing.lastFair = s.fair;
      }
      continue;
    }

    store.entries[key] = {
      id: key,
      conditionId: s.market.conditionId,
      title: s.market.title,
      outcome: s.outcome,
      url: s.market.url,

      // Stamped once, never rewritten.
      firstSeen: now,
      entryPrice: s.execPrice,       // what it would have cost, all-in
      marketPrice: s.market.price,   // mid at the time we called it
      fair: s.fair,
      edge: s.edge,
      evPct: s.evPct,
      grade: s.grade,
      sharps: s.side.traders,
      sharpCapital: s.side.capital,

      // Updated on every later scan.
      lastPrice: s.market.price,
      lastFair: s.fair,
      lastSeen: now,

      status: 'open',
      endDate: s.market.endDate,
    };
  }

  safeWrite(store);
  return store;
}

/**
 * Settles open entries against fresh market data.
 *
 * A market counts as resolved when its price pins at an extreme or the book
 * stops accepting orders after the end date. We deliberately require the price
 * to be decisive (<=2c or >=98c) rather than trusting a flag, because a market
 * can go inactive for reasons other than resolution.
 *
 * @param {Map<string, object>} liveMarkets - conditionId -> market
 */
export function settleAgainst(liveMarkets) {
  const store = safeRead();
  const now = Date.now();
  let settled = 0;

  for (const entry of Object.values(store.entries)) {
    if (entry.status !== 'open') continue;

    const live = liveMarkets.get(entry.conditionId);
    if (!live) continue;

    let idx = live.outcomes.findIndex(
      (o) => String(o).toLowerCase() === String(entry.outcome).toLowerCase()
    );
    if (idx < 0) continue;

    const price = Number(live.prices[idx]);
    if (!Number.isFinite(price)) continue;

    entry.lastPrice = price;
    entry.lastSeen = now;

    const ended = entry.endDate
      ? new Date(entry.endDate).getTime() < now
      : false;
    const decisive = price <= 0.02 || price >= 0.98;

    if (decisive && (ended || live.closed || !live.acceptingOrders)) {
      entry.status = price >= 0.98 ? 'won' : 'lost';
      entry.settledAt = now;
      entry.settlePrice = price;
      // Profit per $1 staked at our recorded entry price.
      entry.pnlPerDollar = entry.status === 'won'
        ? (1 - entry.entryPrice) / entry.entryPrice
        : -1;
      settled++;
    }
  }

  safeWrite(store);
  return { store, settled };
}

/**
 * Computes the performance summary shown at the top of the page.
 *
 * `hitRate` only counts settled bets. `clv` counts every entry we have seen
 * again, settled or not — it is available far sooner and is the leading
 * indicator that the model is finding real mispricings.
 */
export function summarize() {
  const store = safeRead();
  const all = Object.values(store.entries);

  const settled = all.filter((e) => e.status === 'won' || e.status === 'lost');
  const open = all.filter((e) => e.status === 'open');

  const wins = settled.filter((e) => e.status === 'won').length;

  const staked = settled.length;
  const returned = settled.reduce((a, e) => a + (e.pnlPerDollar || 0), 0);

  // Closing line value: did the price move toward us after we called it?
  // Beating the close consistently is the strongest evidence of real edge.
  const moved = all.filter(
    (e) => Number.isFinite(e.lastPrice) && e.lastSeen > e.firstSeen
  );
  const clvSum = moved.reduce((a, e) => a + (e.lastPrice - e.marketPrice), 0);
  const clvBeat = moved.filter((e) => e.lastPrice > e.marketPrice).length;

  // Calibration: when the model says 60%, do those land ~60% of the time?
  const buckets = [];
  for (let lo = 0.3; lo < 0.95; lo += 0.1) {
    const hi = lo + 0.1;
    const inBucket = settled.filter((e) => e.fair >= lo && e.fair < hi);
    if (inBucket.length === 0) continue;
    buckets.push({
      label: `${Math.round(lo * 100)}-${Math.round(hi * 100)}%`,
      predicted: inBucket.reduce((a, e) => a + e.fair, 0) / inBucket.length,
      actual: inBucket.filter((e) => e.status === 'won').length / inBucket.length,
      n: inBucket.length,
    });
  }

  return {
    total: all.length,
    open: open.length,
    settled: settled.length,
    wins,
    losses: settled.length - wins,
    hitRate: settled.length ? wins / settled.length : null,
    roi: staked ? returned / staked : null,
    avgPredicted: settled.length
      ? settled.reduce((a, e) => a + e.fair, 0) / settled.length
      : null,
    clvAvg: moved.length ? clvSum / moved.length : null,
    clvBeatRate: moved.length ? clvBeat / moved.length : null,
    clvSample: moved.length,
    buckets,
    entries: all.sort((a, b) => b.firstSeen - a.firstSeen),
  };
}

/** Wipes the ledger. Used by the reset control on the page. */
export function resetLedger() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch (e) {
    console.warn('Could not reset ledger:', e.message);
  }
}

/** Exports the ledger as JSON so a record can be kept outside the browser. */
export function exportLedger() {
  return JSON.stringify(safeRead(), null, 2);
}
