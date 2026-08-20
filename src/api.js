/**
 * Polymarket API client with caching, concurrency limits, and CORS proxy fallback.
 */

import {
  formatAddress,
  formatCurrency,
  formatPercent,
  formatTimeLeft,
  getRankBadge,
} from './utils.js';

// Caching configuration
const CACHE_PREFIX = 'polytracker_cache_';
const DEFAULT_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds

// Public CORS Proxies to try in order if direct fetch fails
const CORS_PROXIES = [
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`
];

/**
 * Robust fetch wrapper that handles CORS proxies and retries
 */
async function robustFetch(url, options = {}, attempt = 0) {
  try {
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.warn(`Direct fetch failed for ${url}:`, error.message);

    if (options.method && options.method !== 'GET') {
      throw error;
    }

    if (attempt < CORS_PROXIES.length) {
      const proxyUrl = CORS_PROXIES[attempt](url);
      console.log(`Attempting fetch via CORS proxy ${attempt + 1}: ${proxyUrl}`);
      try {
        const response = await fetch(proxyUrl, options);
        if (!response.ok) {
          throw new Error(`Proxy HTTP error! Status: ${response.status}`);
        }
        return await response.json();
      } catch (proxyError) {
        console.warn(`Proxy ${attempt + 1} failed:`, proxyError.message);
        return robustFetch(url, options, attempt + 1);
      }
    }

    throw new Error(`Failed to fetch ${url} directly and through all proxies.`);
  }
}

/**
 * Cache wrapper
 */
function getCachedData(key) {
  try {
    const cached = localStorage.getItem(CACHE_PREFIX + key);
    if (!cached) return null;

    const { data, timestamp, ttl } = JSON.parse(cached);
    if (Date.now() - timestamp > ttl) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return data;
  } catch (e) {
    console.error('Error reading from localStorage cache', e);
    return null;
  }
}

function setCachedData(key, data, ttl = DEFAULT_TTL) {
  try {
    localStorage.setItem(
      CACHE_PREFIX + key,
      JSON.stringify({ data, timestamp: Date.now(), ttl })
    );
  } catch (e) {
    console.error('Error writing to localStorage cache', e);
    clearOldCache();
  }
}

function clearOldCache() {
  try {
    const keys = Object.keys(localStorage);
    for (const key of keys) {
      if (key.startsWith(CACHE_PREFIX)) {
        localStorage.removeItem(key);
      }
    }
  } catch (e) {
    console.error('Failed to clear cache', e);
  }
}

/**
 * Fetches the top traders by profit from Polymarket Leaderboard API
 */
export async function fetchTopTraders(window = 'all', limit = 100, forceRefresh = false) {
  const cacheKey = `leaderboard_${window}_${limit}`;
  if (!forceRefresh) {
    const cached = getCachedData(cacheKey);
    if (cached) return cached;
  }

  const url = `https://lb-api.polymarket.com/profit?window=${window}&limit=${limit}`;
  const data = await robustFetch(url);

  setCachedData(cacheKey, data, 10 * 60 * 1000);
  return data;
}

/**
 * Fetches positions for a specific trader wallet
 */
export async function fetchTraderPositions(wallet, forceRefresh = false) {
  if (!wallet) return [];
  const cleanWallet = wallet.toLowerCase().trim();
  const cacheKey = `positions_${cleanWallet}`;

  if (!forceRefresh) {
    const cached = getCachedData(cacheKey);
    if (cached) return cached;
  }

  const url = `https://data-api.polymarket.com/positions?user=${cleanWallet}`;
  try {
    const data = await robustFetch(url);
    setCachedData(cacheKey, data, 3 * 60 * 1000);
    return data;
  } catch (error) {
    console.error(`Failed to fetch positions for ${wallet}:`, error);
    return [];
  }
}

/**
 * Fetches trending events/markets from Gamma API
 */
export async function fetchTrendingEvents(limit = 10, forceRefresh = false) {
  const cacheKey = `events_${limit}`;
  if (!forceRefresh) {
    const cached = getCachedData(cacheKey);
    if (cached) return cached;
  }

  const url = `https://gamma-api.polymarket.com/events?limit=${limit}&active=true&closed=false&order=volume24hr&ascending=false`;
  const data = await robustFetch(url);

  setCachedData(cacheKey, data, 5 * 60 * 1000);
  return data;
}

/**
 * Fetches sports events for the predictions page by trying a list of tag slugs,
 * then falling back to a keyword filter over trending events.
 *
 * @param {string[]} tagSlugs - Gamma tag slugs to try (e.g. ['cs2', 'esports'])
 * @param {string[]} keywords - Lowercase keywords for the trending fallback filter
 * @param {number} limit - Max events per tag query
 * @param {boolean} forceRefresh - Ignore cache
 * @returns {Promise<Array>} Deduplicated list of events
 */
export async function fetchSportsEvents(tagSlugs = [], keywords = [], limit = 60, forceRefresh = false) {
  const cacheKey = `sports_${tagSlugs.join('-')}_${limit}`;
  if (!forceRefresh) {
    const cached = getCachedData(cacheKey);
    if (cached) return cached;
  }

  const collected = [];

  // 1. Try tag slugs (some may 404 / return empty — that's fine)
  for (const slug of tagSlugs) {
    try {
      const url = `https://gamma-api.polymarket.com/events?limit=${limit}&active=true&closed=false&order=volume24hr&ascending=false&tag_slug=${encodeURIComponent(slug)}`;
      const data = await robustFetch(url);
      if (Array.isArray(data)) collected.push(...data);
    } catch (e) {
      console.warn(`Tag slug "${slug}" returned no usable data:`, e.message);
    }
  }

  // 2. Fallback: keyword filter over trending events if tags found nothing
  if (collected.length === 0 && keywords.length > 0) {
    try {
      const trending = await fetchTrendingEvents(100, forceRefresh);
      const matches = (Array.isArray(trending) ? trending : []).filter(ev => {
        const haystack = `${ev.title || ''} ${ev.slug || ''}`.toLowerCase();
        return keywords.some(kw => haystack.includes(kw));
      });
      collected.push(...matches);
    } catch (e) {
      console.warn('Trending fallback failed:', e.message);
    }
  }

  // 3. Deduplicate by event id/slug
  const seen = new Set();
  const deduped = [];
  for (const ev of collected) {
    const key = ev.id ?? ev.slug;
    if (key == null || seen.has(key)) continue;
    seen.add(key);
    deduped.push(ev);
  }

  setCachedData(cacheKey, deduped, 3 * 60 * 1000);
  return deduped;
}

/* ==========================================================================
 * SHARP EDGE ENGINE — data access
 *
 * The engine needs three things the legacy loaders never fetched:
 *   1. a roster of proven traders scored across MULTIPLE profit windows,
 *      so one lucky week cannot buy a seat at the table
 *   2. each trader's total book value, so position size can be read as
 *      conviction rather than raw dollars
 *   3. live market microstructure (price, spread, depth) for the exact
 *      markets those traders are actually in
 * ========================================================================== */

/**
 * Builds the smart-money roster by merging several leaderboard windows.
 *
 * A trader who shows up in the 1d, 30d AND all-time lists has demonstrated
 * durable skill; one who appears only in the 1d list may have simply been
 * lucky yesterday. We keep every trader but record `windowCount` so the model
 * can weight persistence — see traderWeight() in engine/model.js.
 *
 * @param {string[]} windows - leaderboard windows to merge
 * @param {number} limit - traders per window
 * @returns {Promise<Array>} roster sorted by best PnL, each with rank/windowCount
 */
export async function fetchSmartMoneyRoster(
  windows = ['30d', '7d', 'all'],
  limit = 100,
  forceRefresh = false
) {
  const cacheKey = `roster_${windows.join('-')}_${limit}`;
  if (!forceRefresh) {
    const cached = getCachedData(cacheKey);
    if (cached) return cached;
  }

  const byWallet = new Map();

  for (const window of windows) {
    let list;
    try {
      list = await fetchTopTraders(window, limit, forceRefresh);
    } catch (e) {
      console.warn(`Leaderboard window "${window}" unavailable:`, e.message);
      continue;
    }
    if (!Array.isArray(list)) continue;

    list.forEach((t, index) => {
      const wallet = (t.proxyWallet || '').toLowerCase();
      if (!wallet) return;

      const pnl = Number(t.amount) || 0;
      const existing = byWallet.get(wallet);

      if (existing) {
        existing.windowCount += 1;
        existing.windows.push(window);
        // Keep the strongest showing across windows.
        if (pnl > existing.pnl) existing.pnl = pnl;
        if (index + 1 < existing.rank) existing.rank = index + 1;
      } else {
        byWallet.set(wallet, {
          proxyWallet: wallet,
          name: t.name || t.pseudonym || wallet,
          pseudonym: t.pseudonym || t.name || wallet,
          profileImage: t.profileImageOptimized || t.profileImage || '',
          pnl,
          rank: index + 1,
          windowCount: 1,
          windows: [window],
          bookValue: 0, // filled in by fetchTraderBookValues()
        });
      }
    });
  }

  const roster = Array.from(byWallet.values()).sort((a, b) => b.pnl - a.pnl);

  setCachedData(cacheKey, roster, 10 * 60 * 1000);
  return roster;
}

/**
 * Fetches a trader's total portfolio value, which the model uses as the
 * denominator for conviction. $50k means very different things to a $20M book
 * and a $200k book.
 */
export async function fetchTraderValue(wallet, forceRefresh = false) {
  if (!wallet) return 0;
  const clean = wallet.toLowerCase().trim();
  const cacheKey = `value_${clean}`;

  if (!forceRefresh) {
    const cached = getCachedData(cacheKey);
    if (cached !== null && cached !== undefined) return cached;
  }

  try {
    const data = await robustFetch(`https://data-api.polymarket.com/value?user=${clean}`);
    const value = Array.isArray(data) ? Number(data[0]?.value) || 0 : 0;
    setCachedData(cacheKey, value, 10 * 60 * 1000);
    return value;
  } catch (e) {
    console.warn(`Could not fetch book value for ${clean}:`, e.message);
    return 0;
  }
}

/**
 * Fetches live market microstructure for a set of condition IDs.
 *
 * Position data tells us what the sharps hold and what they paid, but not
 * what the book looks like right now. Without spread and depth we would be
 * modelling edge against a price nobody can actually trade at.
 *
 * Chunked because condition IDs are 66 characters each and URLs are finite.
 *
 * @param {string[]} conditionIds
 * @returns {Promise<Map<string, object>>} conditionId -> normalized market
 */
export async function fetchMarketsByConditionIds(conditionIds, forceRefresh = false) {
  const out = new Map();
  const unique = [...new Set((conditionIds || []).filter(Boolean))];
  if (unique.length === 0) return out;

  const pending = [];

  // Serve what we can from cache first — market data is the hottest path.
  for (const id of unique) {
    if (!forceRefresh) {
      const cached = getCachedData(`market_${id}`);
      if (cached) {
        out.set(id, cached);
        continue;
      }
    }
    pending.push(id);
  }

  const CHUNK = 20;
  for (let i = 0; i < pending.length; i += CHUNK) {
    const chunk = pending.slice(i, i + CHUNK);
    const query = chunk.map((id) => `condition_ids=${encodeURIComponent(id)}`).join('&');

    try {
      const data = await robustFetch(`https://gamma-api.polymarket.com/markets?${query}`);
      if (!Array.isArray(data)) continue;

      for (const raw of data) {
        const market = normalizeGammaMarket(raw);
        if (!market) continue;
        out.set(market.conditionId, market);
        setCachedData(`market_${market.conditionId}`, market, 2 * 60 * 1000);
      }
    } catch (e) {
      console.warn(`Market chunk ${i / CHUNK + 1} failed:`, e.message);
    }
  }

  return out;
}

/**
 * Normalizes a Gamma market into the shape the model expects, parsing the
 * stringified JSON arrays Gamma returns for outcomes and prices.
 */
function normalizeGammaMarket(raw) {
  if (!raw || !raw.conditionId) return null;

  const parseArr = (v) => {
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
  };

  const outcomes = parseArr(raw.outcomes);
  const prices = parseArr(raw.outcomePrices).map(Number);

  return {
    conditionId: raw.conditionId,
    question: raw.question || raw.groupItemTitle || 'Unknown market',
    slug: raw.slug || '',
    icon: raw.icon || raw.image || '',
    outcomes,
    prices,
    liquidity: Number(raw.liquidityNum ?? raw.liquidity) || 0,
    volume: Number(raw.volumeNum ?? raw.volume) || 0,
    volume24hr: Number(raw.volume24hr) || 0,
    spread: Number(raw.spread) || 0,
    bestBid: Number(raw.bestBid) || 0,
    bestAsk: Number(raw.bestAsk) || 0,
    lastTradePrice: Number(raw.lastTradePrice) || 0,
    oneDayPriceChange: Number(raw.oneDayPriceChange) || 0,
    oneHourPriceChange: Number(raw.oneHourPriceChange) || 0,
    competitive: Number(raw.competitive) || 0,
    endDate: raw.endDate || raw.endDateIso || null,
    closed: raw.closed === true,
    active: raw.active !== false,
    acceptingOrders: raw.acceptingOrders !== false,
    negRisk: raw.negRisk === true,
    eventSlug: raw.eventSlug || '',
  };
}

/**
 * Loads book values for a roster with bounded concurrency, mutating each
 * trader in place. Failures are non-fatal: the model degrades to an absolute
 * size proxy when book value is missing.
 */
export async function fetchTraderBookValues(traders, onProgress, concurrency = 6) {
  const queue = [...traders];
  let done = 0;
  const total = traders.length;

  const worker = async () => {
    while (queue.length > 0) {
      const trader = queue.shift();
      try {
        trader.bookValue = await fetchTraderValue(trader.proxyWallet);
      } catch {
        trader.bookValue = 0;
      } finally {
        done++;
        if (onProgress) onProgress(done, total);
      }
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, total) }, worker)
  );
  return traders;
}

function toNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeProbability(value) {
  const num = toNumber(value, 0);
  if (num > 1 && num <= 100) return num / 100;
  return Math.max(0, Math.min(1, num));
}

function normalizeMarket(market, index = 0) {
  const favoriteProbability = normalizeProbability(
    market.favoriteProbability ??
      market.probability ??
      market.winProbability ??
      market.yesPrice ??
      market.price ??
      market.p
  );
  const liquidity = toNumber(market.liquidity ?? market.totalLiquidity ?? market.depth);
  const volume = toNumber(market.volume ?? market.volume24hr ?? market.volume_24h);
  const question = market.question ?? market.title ?? market.name ?? `Market ${index + 1}`;
  const favorite = market.favorite ?? market.outcome ?? market.bestOutcome ?? 'Yes';
  const category = market.category ?? market.tag ?? market.groupTitle ?? 'General';
  const endDate = market.endDate ?? market.end_date ?? market.closeDate ?? market.endsAt ?? null;
  const slug = market.slug ?? market.marketSlug ?? market.conditionId ?? market.id ?? index;
  const url = market.url ?? (slug ? `https://polymarket.com/event/${slug}` : '#');
  const spread = toNumber(market.spread ?? market.bidAskSpread ?? market.maxSpread, 0.5);
  const potentialReturn = favoriteProbability > 0 ? Math.max(0, (1 / favoriteProbability) - 1) : 0;

  const score =
    market.score ??
    (
      favoriteProbability * 0.5 +
      Math.min(1, Math.log10(liquidity + 1) / 4) * 0.25 +
      Math.min(1, Math.log10(volume + 1) / 5) * 0.15 +
      Math.max(0, 1 - Math.min(1, spread)) * 0.1
    );

  return {
    ...market,
    question,
    favorite,
    category,
    favoriteProbability,
    liquidity,
    volume,
    endDate,
    url,
    score,
    potentialReturn,
  };
}

function flattenMarkets(items) {
  const flattened = [];

  items.forEach((item, index) => {
    if (Array.isArray(item?.markets) && item.markets.length > 0) {
      item.markets.forEach((market, nestedIndex) => {
        flattened.push(
          normalizeMarket(
            {
              ...market,
              title: market.title ?? item.title,
              category: market.category ?? item.category,
              endDate: market.endDate ?? item.endDate,
              url: market.url ?? item.url,
            },
            `${index}-${nestedIndex}`
          )
        );
      });
      return;
    }

    flattened.push(normalizeMarket(item, index));
  });

  return flattened;
}

/**
 * Backwards-compatible alias for the legacy leaderboard loader.
 */
export async function fetchLeaderboard(window = 'all', limit = 100, forceRefresh = false) {
  return fetchTopTraders(window, limit, forceRefresh);
}

/**
 * Backwards-compatible market loader used by the legacy app shell.
 */
export async function fetchMarkets(limit = 10, forceRefresh = false) {
  const events = await fetchTrendingEvents(limit, forceRefresh);
  return flattenMarkets(Array.isArray(events) ? events : []);
}

/**
 * Backwards-compatible best-bets ranking helper.
 */
export function rankBestBets(markets, options = {}) {
  const minProbability = options.minProbability ?? 0.6;

  return (Array.isArray(markets) ? markets : [])
    .map((market, index) => normalizeMarket(market, index))
    .filter((market) => market.favoriteProbability >= minProbability)
    .filter((market) => market.favoriteProbability < 0.95)
    .sort((a, b) => b.score - a.score);
}

export {
  formatAddress,
  formatCurrency,
  formatPercent,
  formatTimeLeft,
  getRankBadge,
};

/**
 * Loads positions for a batch of traders with concurrency limit and progress reports
 */
export async function fetchBatchTraderPositions(traders, onProgress, concurrency = 5) {
  const results = [];
  let loadedCount = 0;
  const totalCount = traders.length;

  const queue = [...traders];

  const worker = async () => {
    while (queue.length > 0) {
      const trader = queue.shift();
      try {
        if (onProgress) {
          onProgress(loadedCount, totalCount, trader.pseudonym || trader.name || trader.proxyWallet);
        }

        const positions = await fetchTraderPositions(trader.proxyWallet);
        results.push({ trader, positions: positions || [] });
      } catch (err) {
        console.error(`Failed batch fetch for trader ${trader.pseudonym}:`, err);
        results.push({ trader, positions: [] });
      } finally {
        loadedCount++;
        if (onProgress) {
          onProgress(loadedCount, totalCount, trader.pseudonym || trader.name || trader.proxyWallet);
        }
      }
    }
  };

  const workerCount = Math.min(concurrency, totalCount);
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  return results;
}
