import { fetchTopTraders } from '../api.js';
import { formatCurrency, generateAvatarGradient, getInitials, truncateAddress, getSkeletonLoader, debounce } from '../utils.js';

export default {
  /**
   * Renders the Leaderboard Page
   * @param {HTMLElement} container - The main container to render into
   */
  async render(container) {
    container.innerHTML = `
      <div class="page-header animate-fade-in">
        <div>
          <h2 class="page-header__title">Leaderboard</h2>
          <p class="page-header__subtitle">Track the most profitable Polymarket wallets by timeframe</p>
        </div>
        <div class="stats-row" id="leaderboard-summary-stats">
          <!-- Populated dynamically -->
          <div class="stats-card skeleton-pulse" style="width: 140px; height: 60px;"></div>
          <div class="stats-card skeleton-pulse" style="width: 140px; height: 60px;"></div>
        </div>
      </div>

      <div class="control-bar animate-fade-in">
        <div class="search-box">
          <svg class="search-box__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input type="text" id="trader-search" placeholder="Search by name or wallet address..." class="search-box__input" />
        </div>
        <div class="filter-group">
          <div class="filter-tabs" id="window-filters">
            <button class="filter-tab window-btn" data-window="1d">Daily</button>
            <button class="filter-tab window-btn" data-window="7d">Weekly</button>
            <button class="filter-tab window-btn active" data-window="30d">Monthly</button>
            <button class="filter-tab window-btn" data-window="all">All Time</button>
          </div>
        </div>
      </div>

      <div class="table-container animate-fade-in" id="leaderboard-table-wrapper">
        ${getSkeletonLoader('table')}
      </div>
    `;

    const searchInput = document.getElementById('trader-search');
    const tableWrapper = document.getElementById('leaderboard-table-wrapper');
    const summaryStats = document.getElementById('leaderboard-summary-stats');
    const windowFilters = document.getElementById('window-filters');

    let traders = [];
    let filteredTraders = [];
    let currentWindow = '30d'; // Default to Monthly (30d)

    // Function to load and render leaderboard for a specific timeframe
    const loadLeaderboard = async (timeframe) => {
      tableWrapper.innerHTML = getSkeletonLoader('table');
      searchInput.value = ''; // Clear search when changing window

      try {
        traders = await fetchTopTraders(timeframe, 100);
        filteredTraders = [...traders];

        // Calculate global metrics for the header stats
        const totalProfit = traders.reduce((sum, t) => sum + (t.amount || 0), 0);
        const avgProfit = totalProfit / (traders.length || 1);

        summaryStats.innerHTML = `
          <div class="stats-card">
            <span class="stats-card__label">Combined Profit</span>
            <span class="stats-card__value text-success">${formatCurrency(totalProfit, true)}</span>
          </div>
          <div class="stats-card">
            <span class="stats-card__label">Average Profit</span>
            <span class="stats-card__value text-success">${formatCurrency(avgProfit, true)}</span>
          </div>
          <div class="stats-card">
            <span class="stats-card__label">Total Traders</span>
            <span class="stats-card__value">${traders.length}</span>
          </div>
        `;

        renderTable(tableWrapper, filteredTraders);
      } catch (error) {
        console.error(`Error loading leaderboard for ${timeframe}:`, error);
        tableWrapper.innerHTML = `
          <div class="error-state">
            <svg class="error-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <h3 class="error-state__title">Failed to load leaderboard</h3>
            <p class="error-state__message">Polymarket servers are currently busy. Please try again in a few moments.</p>
            <button class="btn btn--primary" id="retry-leaderboard">Retry</button>
          </div>
        `;

        document.getElementById('retry-leaderboard')?.addEventListener('click', () => {
          loadLeaderboard(timeframe);
        });
      }
    };

    // Initial load
    await loadLeaderboard(currentWindow);

    // Timeframe tabs event listeners
    windowFilters.querySelectorAll('.window-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        windowFilters.querySelectorAll('.window-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentWindow = btn.getAttribute('data-window');
        await loadLeaderboard(currentWindow);
      });
    });

    // Search functionality — debounced so the table isn't re-rendered on every keystroke
    searchInput.addEventListener('input', debounce((e) => {
      const query = e.target.value.toLowerCase().trim();
      if (!query) {
        filteredTraders = [...traders];
      } else {
        filteredTraders = traders.filter(t =>
          (t.pseudonym && t.pseudonym.toLowerCase().includes(query)) ||
          (t.name && t.name.toLowerCase().includes(query)) ||
          (t.proxyWallet && t.proxyWallet.toLowerCase().includes(query))
        );
      }
      renderTable(tableWrapper, filteredTraders);
    }, 200));
  }
};

/**
 * Helper to render the actual HTML table of traders
 */
function renderTable(wrapper, tradersList) {
  if (tradersList.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
        </svg>
        <h3 class="empty-state__title">No traders found</h3>
        <p class="empty-state__message">Try searching for a different name or wallet address.</p>
      </div>
    `;
    return;
  }

  wrapper.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th style="width: 80px;">Rank</th>
          <th>Trader</th>
          <th>Wallet Address</th>
          <th class="text-right">Total Profit</th>
          <th style="width: 140px;" class="text-center">Action</th>
        </tr>
      </thead>
      <tbody>
        ${tradersList.map((trader, index) => {
          const rank = index + 1;
          const displayName = trader.pseudonym || trader.name || `Trader #${rank}`;
          const wallet = trader.proxyWallet;
          const profit = trader.amount || 0;
          const gradient = generateAvatarGradient(wallet || displayName);
          const initials = getInitials(displayName);
          const truncatedWallet = truncateAddress(wallet);

          return `
            <tr class="table-row" data-wallet="${wallet}">
              <td>
                <span class="rank-badge ${rank <= 3 ? `rank-badge--${rank}` : ''}">${rank}</span>
              </td>
              <td>
                <div class="trader-cell">
                  <div class="avatar" style="background: ${gradient}">
                    ${initials}
                  </div>
                  <div class="trader-info">
                    <span class="trader-name">${displayName}</span>
                    ${trader.bio ? `<span class="trader-bio">${trader.bio.slice(0, 45)}${trader.bio.length > 45 ? '...' : ''}</span>` : ''}
                  </div>
                </div>
              </td>
              <td>
                <div class="wallet-cell" onclick="event.stopPropagation()">
                  <code class="wallet-code">${truncatedWallet}</code>
                  <button class="copy-btn" data-clipboard="${wallet}" title="Copy full address">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="copy-icon">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                </div>
              </td>
              <td class="text-right font-mono font-semibold text-success">
                ${formatCurrency(profit)}
              </td>
              <td class="text-center" onclick="event.stopPropagation()">
                <a href="#trader/${wallet}" class="btn btn--secondary btn--sm">
                  View Bets
                </a>
              </td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  // Attach event listeners for copying to clipboard
  const copyButtons = wrapper.querySelectorAll('.copy-btn');
  copyButtons.forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const address = btn.getAttribute('data-clipboard');
      try {
        await navigator.clipboard.writeText(address);

        // Visual feedback
        const originalSVG = btn.innerHTML;
        btn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" class="copy-icon">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
        `;
        btn.classList.add('copy-btn--copied');

        setTimeout(() => {
          btn.innerHTML = originalSVG;
          btn.classList.remove('copy-btn--copied');
        }, 1500);
      } catch (err) {
        console.error('Failed to copy text: ', err);
      }
    });
  });

  // Attach row click listeners for easy navigation
  const rows = wrapper.querySelectorAll('.table-row');
  rows.forEach(row => {
    row.addEventListener('click', () => {
      const wallet = row.getAttribute('data-wallet');
      if (wallet) {
        window.location.hash = `#trader/${wallet}`;
      }
    });
  });
}
