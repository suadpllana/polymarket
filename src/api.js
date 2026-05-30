/**
 * Polymarket API client with caching, concurrency limits, and CORS proxy fallback.
 */

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
    // Attempt direct fetch first
    const response = await fetch(url, options);
    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }
    return await response.json();
  } catch (error) {
    console.warn(`Direct fetch failed for ${url}:`, error.message);
    
    // If we've already tried proxies or it's a non-GET request, throw
    if (options.method && options.method !== 'GET') {
      throw error;
    }

    // Try CORS proxies sequentially
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
      JSON.stringify({
        data,
        timestamp: Date.now(),
        ttl
      })
    );
  } catch (e) {
    console.error('Error writing to localStorage cache', e);
    // If localStorage is full, clear old cache items
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
 * @param {string} window - Time window ('all', 'month', 'week')
 * @param {number} limit - Maximum number of traders (default 100)
 * @param {boolean} forceRefresh - Ignore cache
 */
export async function fetchTopTraders(window = 'all', limit = 100, forceRefresh = false) {
  const cacheKey = `leaderboard_${window}_${limit}`;
  if (!forceRefresh) {
    const cached = getCachedData(cacheKey);
    if (cached) return cached;
  }

  const url = `https://lb-api.polymarket.com/profit?window=${window}&limit=${limit}`;
  const data = await robustFetch(url);
  
  // Cache leaderboard for 10 minutes (it doesn't change second-by-second)
  setCachedData(cacheKey, data, 10 * 60 * 1000);
  return data;
}

/**
 * Fetches positions for a specific trader wallet
 * @param {string} wallet - Proxy wallet address of the trader
 * @param {boolean} forceRefresh - Ignore cache
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
    // Cache individual trader positions for 3 minutes
    setCachedData(cacheKey, data, 3 * 60 * 1000);
    return data;
  } catch (error) {
    console.error(`Failed to fetch positions for ${wallet}:`, error);
    // Return empty array instead of failing completely, to keep the UI running
    return [];
  }
}

/**
 * Fetches trending events/markets from Gamma API
 * @param {number} limit - Maximum number of events
 * @param {boolean} forceRefresh - Ignore cache
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
 * Loads positions for a batch of traders with concurrency limit and progress reports
 * @param {Array} traders - List of trader objects from the leaderboard
 * @param {Function} onProgress - Callback(loadedCount, totalCount, currentPseudonym)
 * @param {number} concurrency - Max simultaneous requests
 * @returns {Promise<Array>} List of results containing { trader, positions }
 */
export async function fetchBatchTraderPositions(traders, onProgress, concurrency = 5) {
  const results = [];
  let loadedCount = 0;
  const totalCount = traders.length;

  // Helper to run tasks with limited concurrency
  const queue = [...traders];
  const activePromises = [];

  const worker = async () => {
    while (queue.length > 0) {
      const trader = queue.shift();
      try {
        if (onProgress) {
          onProgress(loadedCount, totalCount, trader.pseudonym || trader.name || trader.proxyWallet);
        }
        
        // Fetch positions (will check cache first)
        const positions = await fetchTraderPositions(trader.proxyWallet);
        results.push({
          trader,
          positions: positions || []
        });
      } catch (err) {
        console.error(`Failed batch fetch for trader ${trader.pseudonym}:`, err);
        results.push({
          trader,
          positions: []
        });
      } finally {
        loadedCount++;
        if (onProgress) {
          onProgress(loadedCount, totalCount, trader.pseudonym || trader.name || trader.proxyWallet);
        }
      }
    }
  };

  // Launch initial batch of workers
  const workerCount = Math.min(concurrency, totalCount);
  const workers = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker());
  }

  // Wait for all workers to complete
  await Promise.all(workers);
  return results;
}
