/**
 * Polymarket API client with caching, concurrency limits, and CORS proxy fallback.
 */

import {
  formatAddress,
  formatCurrency,
  formatPercent,
  formatTimeLeft,
  getRankBadge,
} from './utils';

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
