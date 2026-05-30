import { fetchTraderPositions, fetchTopTraders } from '../api.js';
import { formatCurrency, formatPercent, generateAvatarGradient, getInitials, truncateAddress, getSkeletonLoader } from '../utils.js';
/**
 * Helper to determine if a position is truly active.
 * Excludes ended calendar events and extreme pricing close to 0 or 1.
 */
function isActivePosition(p) {
  if (!p) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const endDate = p.endDate ? new Date(p.endDate) : null;
  const isEnded = endDate && endDate < today;
  return p.curPrice > 0.005 && p.curPrice < 0.995 && !p.redeemable && !isEnded;
}

export default {
  /**
   * Renders the Trader Detail Page
   * @param {HTMLElement} container - Container to render into
   * @param {string} wallet - Proxy wallet address of the trader
   */
  async render(container, wallet) {
    if (!wallet) {
      container.innerHTML = `<div class="error-state"><p>No wallet address provided.</p></div>`;
      return;
    }

    const cleanWallet = wallet.toLowerCase().trim();
    
    // Set up loading structure
    container.innerHTML = `
      <div class="animate-fade-in">
        <a href="#leaderboard" class="back-link">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="back-link__icon">
            <line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>
          </svg>
          Back to Leaderboard
        </a>
      </div>

      <!-- Trader Profile Header -->
      <div id="trader-profile-header" class="trader-profile animate-fade-in">
        <!-- Rendered after loading profile -->
        <div class="trader-profile__loading skeleton-pulse" style="height: 180px; width: 100%; border-radius: 12px; margin-bottom: 24px;"></div>
      </div>

      <!-- Trader Bets Summary and Controls -->
      <div class="bets-section animate-fade-in">
        <div class="bets-section__header">
          <h3 class="bets-section__title">Active & Historical Bets</h3>
          
          <div class="bets-controls">
            <div class="filter-tabs">
              <button class="filter-tab active font-semibold" data-filter="all">All Bets</button>
              <button class="filter-tab font-semibold" data-filter="active">Active Only</button>
              <button class="filter-tab font-semibold" data-filter="resolved">Resolved</button>
            </div>
            
            <div class="sort-select-wrapper">
              <select id="bets-sort" class="sort-select">
                <option value="size-desc">Size: High to Low</option>
                <option value="pnl-desc">PnL: High to Low</option>
                <option value="pnl-asc">PnL: Low to High</option>
                <option value="title-asc">Market Name: A-Z</option>
              </select>
            </div>
          </div>
        </div>

        <div id="trader-bets-grid" class="bets-grid">
          ${getSkeletonLoader('grid')}
        </div>
      </div>
    `;

    const profileHeader = document.getElementById('trader-profile-header');
    const betsGrid = document.getElementById('trader-bets-grid');
    const filterTabs = document.querySelectorAll('.filter-tab');
    const sortSelect = document.getElementById('bets-sort');

    let allPositions = [];
    let displayedPositions = [];
    let currentFilter = 'all';
    let currentSort = 'size-desc';

    try {
      // 1. Fetch trader details from leaderboard cache if available
      let traderInfo = null;
      let rank = null;

      try {
        const topTraders = await fetchTopTraders('all', 100);
        const matchIndex = topTraders.findIndex(t => t.proxyWallet.toLowerCase() === cleanWallet);
        if (matchIndex !== -1) {
          traderInfo = topTraders[matchIndex];
          rank = matchIndex + 1;
        }
      } catch (err) {
        console.warn('Could not check leaderboard for trader info:', err);
      }

      // If not in top 100 or leaderboard failed
      if (!traderInfo) {
        traderInfo = {
          proxyWallet: cleanWallet,
          pseudonym: `Wallet ${truncateAddress(cleanWallet)}`,
          name: truncateAddress(cleanWallet),
          amount: 0
        };
      }

      // 2. Fetch active positions
      allPositions = await fetchTraderPositions(cleanWallet);
      
      // Calculate summary stats specifically for positions
      const activePositions = allPositions.filter(isActivePosition);
      const resolvedPositions = allPositions.filter(p => !isActivePosition(p));
      
      const totalInvested = activePositions.reduce((sum, p) => sum + (p.currentValue || p.initialValue || 0), 0);
      const activePnL = activePositions.reduce((sum, p) => sum + (p.cashPnl || 0), 0);

      // Render profile header card
      const displayName = traderInfo.pseudonym || traderInfo.name;
      const gradient = generateAvatarGradient(cleanWallet);
      const initials = getInitials(displayName);
      const totalLeaderboardProfit = traderInfo.amount || 0;

      profileHeader.innerHTML = `
        <div class="trader-profile__main">
          <div class="trader-profile__identity">
            <div class="avatar avatar--lg" style="background: ${gradient}">
              ${initials}
            </div>
            <div class="trader-profile__meta">
              <div class="trader-profile__name-row">
                <h2 class="trader-profile__name">${displayName}</h2>
                ${rank ? `<span class="rank-badge rank-badge--hero">Rank #${rank}</span>` : '<span class="rank-badge">Trader</span>'}
              </div>
              <p class="trader-profile__wallet font-mono">${cleanWallet}</p>
              ${traderInfo.bio ? `<p class="trader-profile__bio">${traderInfo.bio}</p>` : ''}
            </div>
          </div>
          
          <div class="trader-profile__stats">
            <div class="trader-profile__stat-card">
              <span class="trader-profile__stat-label">Total Realized Profit</span>
              <span class="trader-profile__stat-value font-mono ${totalLeaderboardProfit >= 0 ? 'text-success' : 'text-danger'}">
                ${formatCurrency(totalLeaderboardProfit)}
              </span>
            </div>
            <div class="trader-profile__stat-card">
              <span class="trader-profile__stat-label">Capital at Risk</span>
              <span class="trader-profile__stat-value font-mono">
                ${formatCurrency(totalInvested)}
              </span>
            </div>
            <div class="trader-profile__stat-card">
              <span class="trader-profile__stat-label">Open Position PnL</span>
              <span class="trader-profile__stat-value font-mono ${activePnL >= 0 ? 'text-success' : 'text-danger'}">
                ${formatCurrency(activePnL)}
              </span>
            </div>
          </div>
        </div>
      `;

      // 3. Render Positions
      applyFilterAndSort();

      // Attach Filter tab event listeners
      filterTabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
          filterTabs.forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          currentFilter = tab.getAttribute('data-filter');
          applyFilterAndSort();
        });
      });

      // Attach Sort event listener
      sortSelect.addEventListener('change', (e) => {
        currentSort = e.target.value;
        applyFilterAndSort();
      });

    } catch (error) {
      console.error('Error rendering trader detail:', error);
      betsGrid.innerHTML = `
        <div class="error-state">
          <svg class="error-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <h3 class="error-state__title">Failed to load trader data</h3>
          <p class="error-state__message">Polymarket servers are busy or the wallet address is invalid.</p>
        </div>
      `;
    }

    /**
     * Filter and sort current positions
     */
    function applyFilterAndSort() {
      // A. Filter
      if (currentFilter === 'all') {
        displayedPositions = [...allPositions];
      } else if (currentFilter === 'active') {
        displayedPositions = allPositions.filter(isActivePosition);
      } else if (currentFilter === 'resolved') {
        displayedPositions = allPositions.filter(p => !isActivePosition(p));
      }

      // B. Sort
      displayedPositions.sort((a, b) => {
        if (currentSort === 'size-desc') {
          const valA = a.initialValue || 0;
          const valB = b.initialValue || 0;
          return valB - valA;
        } else if (currentSort === 'pnl-desc') {
          return (b.cashPnl || 0) - (a.cashPnl || 0);
        } else if (currentSort === 'pnl-asc') {
          return (a.cashPnl || 0) - (b.cashPnl || 0);
        } else if (currentSort === 'title-asc') {
          return (a.title || '').localeCompare(b.title || '');
        }
        return 0;
      });

      // C. Render
      renderPositionsList(betsGrid, displayedPositions);
    }
  }
};

/**
 * Renders the filtered list of positions/bets as beautiful cards
 */
function renderPositionsList(wrapper, positions) {
  if (positions.length === 0) {
    wrapper.innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <svg class="empty-state__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
        </svg>
        <h3 class="empty-state__title">No positions found</h3>
        <p class="empty-state__message">This wallet doesn't have any bets in this category.</p>
      </div>
    `;
    return;
  }

  wrapper.innerHTML = positions.map(pos => {
    const isResolved = !isActivePosition(pos);
    const initialValue = pos.initialValue || 0;
    const currentValue = pos.currentValue || 0;
    const cashPnl = pos.cashPnl || 0;
    const percentPnl = pos.percentPnl || 0;
    const curPrice = pos.curPrice !== undefined ? pos.curPrice : 0;
    const avgPrice = pos.avgPrice || 0;
    const shares = pos.size || 0;
    const outcome = pos.outcome || 'Unknown';
    const isProfit = cashPnl >= 0;
    
    // Status text
    const statusText = isResolved ? 'RESOLVED' : 'ACTIVE';
    const statusClass = isResolved ? 'badge--resolved' : 'badge--active';

    // Outcome Badge styling (YES, NO, or Named teams)
    let outcomeClass = 'outcome-badge--neutral';
    if (outcome.toLowerCase() === 'yes') outcomeClass = 'outcome-badge--yes';
    else if (outcome.toLowerCase() === 'no') outcomeClass = 'outcome-badge--no';

    // Market links
    const marketUrl = pos.slug 
      ? `https://polymarket.com/market/${pos.slug}`
      : `https://polymarket.com/event/${pos.eventSlug || ''}`;

    const iconUrl = pos.icon || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="%231a233a"><rect width="100" height="100"/><text y=".75em" font-size="60" x="15">📈</text></svg>';

    return `
      <div class="bet-card animate-scale-in">
        <div class="bet-card__header">
          <img src="${iconUrl}" class="bet-card__icon" alt="Market Icon" onerror="this.src='data:image/svg+xml,<svg xmlns=\\'http://www.w3.org/2000/svg\\' viewBox=\\'0 0 100 100\\' fill=\\'%231a233a\\'><rect width=\\'100\\' height=\\'100\\'/><text y=\\'.75em\\' font-size=\\'60\\' x=\\'15\\'>📈</text></svg>';" />
          <div class="bet-card__meta">
            <span class="badge ${statusClass}">${statusText}</span>
            <span class="outcome-badge ${outcomeClass}">${outcome}</span>
          </div>
        </div>
        
        <h4 class="bet-card__title" title="${pos.title}">
          <a href="${marketUrl}" target="_blank" rel="noopener noreferrer">${pos.title}</a>
        </h4>

        <div class="bet-card__price-tracker">
          <div class="bet-card__price-labels">
            <span>Avg Entry: <strong class="font-mono font-medium">${(avgPrice * 100).toFixed(0)}¢</strong></span>
            <span>Current: <strong class="font-mono font-medium">${(curPrice * 100).toFixed(0)}¢</strong></span>
          </div>
          <div class="price-bar">
            <!-- Entry marker -->
            <div class="price-bar__marker price-bar__marker--entry" style="left: ${avgPrice * 100}%" title="Avg Entry: ${(avgPrice * 100).toFixed(0)}¢"></div>
            <!-- Current level -->
            <div class="price-bar__fill ${isProfit ? 'price-bar__fill--profit' : 'price-bar__fill--loss'}" style="width: ${curPrice * 100}%"></div>
          </div>
        </div>

        <div class="bet-card__stats">
          <div class="bet-card__stat">
            <span class="bet-card__stat-label">Contracts Held</span>
            <span class="bet-card__stat-value font-mono">${new Intl.NumberFormat('en-US').format(shares.toFixed(0))} shares</span>
            <span class="bet-card__stat-help">Number of tickets/bets bought</span>
          </div>
          <div class="bet-card__stat">
            <span class="bet-card__stat-label">Total Spent</span>
            <span class="bet-card__stat-value font-mono">${formatCurrency(initialValue)}</span>
            <span class="bet-card__stat-help">What they paid to enter bet</span>
          </div>
          <div class="bet-card__stat">
            <span class="bet-card__stat-label">Value Right Now</span>
            <span class="bet-card__stat-value font-mono">${formatCurrency(currentValue)}</span>
            <span class="bet-card__stat-help">What it's worth if sold now</span>
          </div>
          <div class="bet-card__stat">
            <span class="bet-card__stat-label">Net Profit / Loss</span>
            <span class="bet-card__stat-value font-mono font-semibold ${isProfit ? 'text-success' : 'text-danger'}">
              ${formatCurrency(cashPnl)} (${formatPercent(percentPnl)})
            </span>
            <span class="bet-card__stat-help">${isProfit ? 'Current net profit' : 'Current net loss'}</span>
          </div>
        </div>

        <div class="bet-card__footer">
          <a href="${marketUrl}" target="_blank" rel="noopener noreferrer" class="bet-card__link">
            Trade on Polymarket
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="bet-card__link-icon">
              <line x1="7" y1="17" x2="17" y2="7"/><polyline points="7 7 17 7 17 17"/>
            </svg>
          </a>
        </div>
      </div>
    `;
  }).join('');
}
