import { fetchTopTraders, fetchBatchTraderPositions } from '../api.js';
import { formatCurrency } from '../utils.js';

export default {
  /**
   * Renders the Smart Money Insights Page
   * @param {HTMLElement} container - Container to render into
   */
  async render(container) {
    container.innerHTML = `
      <div class="page-header animate-fade-in">
        <div>
          <h2 class="page-header__title">Smart Money Insights</h2>
          <p class="page-header__subtitle">Aggregated consensus and capital deployment from top profit leaders</p>
        </div>
        <div class="filter-group">
          <div class="filter-tabs" id="insights-window-filters">
            <button class="filter-tab window-btn" data-window="1d">Daily</button>
            <button class="filter-tab window-btn" data-window="7d">Weekly</button>
            <button class="filter-tab window-btn active" data-window="30d">Monthly</button>
            <button class="filter-tab window-btn" data-window="all">All Time</button>
          </div>
        </div>
      </div>

      <!-- Loading overlay/status, initially shown -->
      <div id="insights-loader" class="insights-loader animate-fade-in">
        <div class="loader-card">
          <div class="loader-card__spinner"></div>
          <h3 class="loader-card__title" id="loader-card-title">Scanning Smart Money Wallets...</h3>
          <p class="loader-card__message" id="loader-status">Initializing scanner...</p>

          <div class="progress-bar-wrapper">
            <div class="progress-bar-fill" id="loader-progress" style="width: 0%"></div>
          </div>

          <div class="loader-stats">
            <div class="loader-stat">
              <span class="loader-stat__label">Wallets Scanned</span>
              <span class="loader-stat__value" id="loader-stat-scanned">0 / 100</span>
            </div>
            <div class="loader-stat">
              <span class="loader-stat__label">Active Bets Found</span>
              <span class="loader-stat__value" id="loader-stat-positions">0</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Insights Content, initially hidden -->
      <div id="insights-content" class="insights-content hidden animate-fade-in">
        <div class="control-bar insights-controls">
          <div class="filter-group">
            <label for="insights-threshold-select" class="control-label font-semibold">Min Participation:</label>
            <select id="insights-threshold-select" class="sort-select inline-select">
              <option value="2">2+ Traders</option>
              <option value="5" selected>5+ Traders</option>
              <option value="10">10+ Traders</option>
              <option value="15">15+ Traders</option>
            </select>
          </div>

          <div class="filter-group">
            <label for="insights-sort-select" class="control-label font-semibold">Sort By:</label>
            <select id="insights-sort-select" class="sort-select inline-select">
              <option value="participation-desc">Traders Count (Highest)</option>
              <option value="capital-desc">Capital Deployed (Highest)</option>
              <option value="consensus-desc">Consensus Strength (Highest)</option>
            </select>
          </div>
        </div>

        <div id="insights-cards-grid" class="insights-grid">
          <!-- Populated dynamically -->
        </div>
      </div>
    `;

    const loaderOverlay = document.getElementById('insights-loader');
    const insightsContent = document.getElementById('insights-content');
    const statusText = document.getElementById('loader-status');
    const progressBar = document.getElementById('loader-progress');
    const statScanned = document.getElementById('loader-stat-scanned');
    const statPositions = document.getElementById('loader-stat-positions');

    const thresholdSelect = document.getElementById('insights-threshold-select');
    const sortSelect = document.getElementById('insights-sort-select');
    const cardsGrid = document.getElementById('insights-cards-grid');
    const windowFilters = document.getElementById('insights-window-filters');

    let aggregatedMarkets = [];
    let scannedTradersCount = 100; // actual number of wallets scanned (for participation %)
    let activePositionsCount = 0;
    let currentWindow = '30d'; // Defaults to monthly
    let isScanning = false;

    // Timeframe labeling mapping
    const timeframeLabels = {
      '1d': 'Daily Profit Leaders',
      '7d': 'Weekly Profit Leaders',
      '30d': 'Monthly Profit Leaders',
      'all': 'All-Time Profit Leaders'
    };

    /**
     * Executes the batch scan and aggregation for a timeframe
     */
    const runScan = async (timeframe) => {
      if (isScanning) return;
      isScanning = true;

      windowFilters.style.pointerEvents = 'none';
      windowFilters.style.opacity = '0.6';

      loaderOverlay.classList.remove('hidden');
      insightsContent.classList.add('hidden');

      activePositionsCount = 0;
      progressBar.style.width = '0%';
      statusText.textContent = `Fetching ${timeframeLabels[timeframe]}...`;
      statScanned.textContent = '0 / 100';
      statPositions.textContent = '0';
      document.getElementById('loader-card-title').textContent = `Scanning ${timeframeLabels[timeframe]}...`;

      try {
        // 1. Fetch top 100 traders for chosen window
        const traders = await fetchTopTraders(timeframe, 100);
        scannedTradersCount = traders.length || 100;

        // 2. Batch fetch portfolios with rate limit concurrency
        const batchData = await fetchBatchTraderPositions(
          traders,
          (scanned, total, currentPseudonym) => {
            const pct = Math.round((scanned / total) * 100);
            progressBar.style.width = `${pct}%`;
            statusText.textContent = `Scanning wallet for ${currentPseudonym}...`;
            statScanned.textContent = `${scanned} / ${total}`;
            statPositions.textContent = activePositionsCount;
          },
          6 // Concurrency
        );

        statusText.textContent = 'Aggregating active bets...';

        // 3. Aggregate active bets by conditionId
        const marketsMap = new Map();
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const item of batchData) {
          const { trader, positions } = item;
          const displayName = trader.pseudonym || trader.name || trader.proxyWallet;

          for (const pos of positions) {
            // Only aggregate ACTIVE bets (exclude resolved/ended)
            const endDate = pos.endDate ? new Date(pos.endDate) : null;
            const isEnded = endDate && endDate < today;

            const isResolved = pos.curPrice <= 0.005 || pos.curPrice >= 0.995 || pos.redeemable || isEnded;
            if (isResolved) continue;

            activePositionsCount++;

            const cid = pos.conditionId;
            if (!cid) continue;

            if (!marketsMap.has(cid)) {
              marketsMap.set(cid, {
                conditionId: cid,
                title: pos.title || 'Unknown Market',
                slug: pos.slug,
                eventSlug: pos.eventSlug,
                icon: pos.icon,
                tradersCount: 0,
                totalCapital: 0,
                outcomes: {}
              });
            }

            const mObj = marketsMap.get(cid);
            mObj.tradersCount++;

            const posCost = pos.initialValue || 0;
            mObj.totalCapital += posCost;

            const outcomeName = pos.outcome || 'Unknown';
            if (!mObj.outcomes[outcomeName]) {
              mObj.outcomes[outcomeName] = {
                tradersCount: 0,
                totalCost: 0,
                totalShares: 0,
                currentPrice: pos.curPrice || 0,
                tradersList: []
              };
            }

            const oObj = mObj.outcomes[outcomeName];
            oObj.tradersCount++;
            oObj.totalCost += posCost;
            oObj.totalShares += pos.size || 0;
            oObj.tradersList.push({
              name: displayName,
              wallet: trader.proxyWallet,
              initialValue: posCost,
              outcome: outcomeName,
              shares: pos.size || 0
            });
          }
        }

        // Convert map to array and compute consensus stats
        aggregatedMarkets = Array.from(marketsMap.values()).map(m => {
          let consensusOutcome = 'Unknown';
          let consensusCount = 0;
          let consensusCapital = 0;
          let consensusTradersList = [];

          Object.entries(m.outcomes).forEach(([oName, oData]) => {
            if (oData.tradersCount > consensusCount) {
              consensusOutcome = oName;
              consensusCount = oData.tradersCount;
              consensusCapital = oData.totalCost;
              consensusTradersList = oData.tradersList;
            }
          });

          const consensusStrength = m.tradersCount > 0 ? (consensusCount / m.tradersCount) * 100 : 0;
          // FIX: use the real number of scanned wallets instead of hardcoded 100
          const participationRate = (m.tradersCount / scannedTradersCount) * 100;

          // FIX: biggest positions first so the most meaningful names show up
          consensusTradersList = [...consensusTradersList].sort(
            (a, b) => (b.initialValue || 0) - (a.initialValue || 0)
          );

          return {
            ...m,
            consensusOutcome,
            consensusStrength,
            consensusCapital,
            participationRate,
            consensusTradersList,
            dominantOutcomeDetails: m.outcomes[consensusOutcome]
          };
        });

        loaderOverlay.classList.add('hidden');
        insightsContent.classList.remove('hidden');

        applyFilterAndSort();

      } catch (error) {
        console.error(`Error aggregating insights for ${timeframe}:`, error);
        loaderOverlay.innerHTML = `
          <div class="error-state">
            <svg class="error-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <h3 class="error-state__title">Scans Interrupted</h3>
            <p class="error-state__message">Polymarket data rate limits reached. Please refresh to start a cached scan.</p>
            <button class="btn btn--primary" id="retry-insights">Restart Scanner</button>
          </div>
        `;
        document.getElementById('retry-insights')?.addEventListener('click', () => {
          isScanning = false;
          runScan(timeframe);
        });
      } finally {
        isScanning = false;
        windowFilters.style.pointerEvents = 'auto';
        windowFilters.style.opacity = '1';
      }
    };

    // Kickoff default Monthly scan
    await runScan(currentWindow);

    // Dynamic timeframe switching tab listeners
    windowFilters.querySelectorAll('.window-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (isScanning) return;
        windowFilters.querySelectorAll('.window-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentWindow = btn.getAttribute('data-window');
        await runScan(currentWindow);
      });
    });

    // Filtering & Sorting listeners
    thresholdSelect.addEventListener('change', applyFilterAndSort);
    sortSelect.addEventListener('change', applyFilterAndSort);

    /**
     * Filters and sorts the aggregated insight lists
     */
    function applyFilterAndSort() {
      const minTraders = parseInt(thresholdSelect.value, 10);
      const sortBy = sortSelect.value;

      let list = aggregatedMarkets.filter(m => m.tradersCount >= minTraders);

      list.sort((a, b) => {
        if (sortBy === 'participation-desc') {
          return b.tradersCount - a.tradersCount;
        } else if (sortBy === 'capital-desc') {
          return b.totalCapital - a.totalCapital;
        } else if (sortBy === 'consensus-desc') {
          return b.consensusStrength - a.consensusStrength;
        }
        return 0;
      });

      renderInsightCards(cardsGrid, list);
    }
  }
};

/**
 * Renders the aggregated insights cards
 */
function renderInsightCards(wrapper, markets) {
  if (wrapper === null) return;
  if (markets.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>
        </svg>
        <h3 class="empty-state__title">No consensus markets found</h3>
        <p class="empty-state__message">Try lowering the minimum trader threshold to see more active markets.</p>
      </div>
    `;
    return;
  }

  const MAX_PILLS = 12;

  wrapper.innerHTML = markets.map((m, index) => {
    const marketUrl = m.slug
      ? `https://polymarket.com/market/${m.slug}`
      : `https://polymarket.com/event/${m.eventSlug || ''}`;

    const iconUrl = m.icon || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="%231a233a"><rect width="100" height="100"/><text y=".75em" font-size="60" x="15">📈</text></svg>';

    let consensusOutcomeClass = 'outcome-badge--neutral';
    if (m.consensusOutcome.toLowerCase() === 'yes') consensusOutcomeClass = 'outcome-badge--yes';
    else if (m.consensusOutcome.toLowerCase() === 'no') consensusOutcomeClass = 'outcome-badge--no';

    const isTop3 = index < 3;
    const badgeText = isTop3 ? `🔥 TOP ${index + 1}` : '';

    const visiblePills = m.consensusTradersList.slice(0, MAX_PILLS);
    const hiddenCount = m.consensusTradersList.length - visiblePills.length;

    return `
      <div class="insight-card animate-scale-in">
        ${isTop3 ? `<div class="insight-card__top-badge">${badgeText}</div>` : ''}

        <div class="insight-card__header">
          <img src="${iconUrl}" class="insight-card__icon" alt="Market Icon" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 100\\' fill=\\'%231a233a\\'><rect width=\\'100\\' height=\\'100\\'/><text y=\\'.75em\\' font-size=\\'60\\' x=\\'15\\'>📈</text></svg>';" />
          <div class="insight-card__participation">
            <span class="participation-count">👥 <strong>${m.tradersCount}</strong> of Top 100</span>
            <span class="participation-rate">(${m.participationRate.toFixed(1)}% Participation)</span>
          </div>
        </div>

        <h4 class="insight-card__title" title="${m.title}">
          <a href="${marketUrl}" target="_blank" rel="noopener noreferrer">${m.title}</a>
        </h4>

        <!-- Consensus Tracker -->
        <div class="insight-card__consensus">
          <div class="consensus-info">
            <span class="consensus-info__label">Consensus Bet</span>
            <span class="outcome-badge ${consensusOutcomeClass} font-semibold">${m.consensusOutcome}</span>
            <span class="consensus-info__strength">${m.consensusStrength.toFixed(1)}% Consensus</span>
          </div>

          <div class="consensus-meter">
            <div class="consensus-meter__fill" style="width: ${m.consensusStrength}%"></div>
          </div>
        </div>

        <div class="insight-card__details">
          <div class="detail-row">
            <span class="detail-row__label">Total Capital Invested</span>
            <span class="detail-row__value font-mono font-medium text-success">${formatCurrency(m.totalCapital)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-row__label">Capital on Consensus Side</span>
            <span class="detail-row__value font-mono font-medium">${formatCurrency(m.consensusCapital)}</span>
          </div>
          <div class="detail-row">
            <span class="detail-row__label">Outcome Price</span>
            <span class="detail-row__value font-mono font-medium">${(m.dominantOutcomeDetails.currentPrice * 100).toFixed(0)}¢</span>
          </div>
        </div>

        <!-- Consensus Traders list -->
        <div class="insight-card__traders">
          <span class="traders-list-title">Consensus Traders:</span>
          <div class="traders-list-pills">
            ${visiblePills.map(t => `
              <span class="trader-pill" title="${t.name} invested ${formatCurrency(t.initialValue)}">
                ${t.name} <code class="trader-pill__val">${formatCurrency(t.initialValue, true)}</code>
              </span>
            `).join('')}
            ${hiddenCount > 0 ? `<span class="trader-pill">+${hiddenCount} more</span>` : ''}
          </div>
        </div>

        <div class="insight-card__footer">
          <a href="${marketUrl}" target="_blank" rel="noopener noreferrer" class="insight-card__link">
            Trade Consensus
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="insight-card__link-icon">
              <line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>
            </svg>
          </a>
        </div>
      </div>
    `;
  }).join('');
}
