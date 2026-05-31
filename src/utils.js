/**
 * Utility functions for the Polymarket Top Traders Dashboard.
 */

/**
 * Formats a number as a currency string (USD) with optional compact notation (K, M, B).
 * @param {number} amount - The numeric amount to format.
 * @param {boolean} compact - Whether to use compact notation (e.g. $1.2M).
 * @returns {string} Formatted currency string.
 */
export function formatCurrency(amount, compact = false) {
  if (amount === undefined || amount === null || isNaN(amount)) {
    return '$0.00';
  }

  const sign = amount < 0 ? '-' : '';
  const absoluteAmount = Math.abs(amount);

  if (compact && absoluteAmount >= 1000) {
    const formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 2
    });
    return formatter.format(amount);
  }

  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  return formatter.format(amount);
}

/**
 * Formats a percentage value.
 * @param {number} value - The decimal percentage value (e.g., 0.67 or 67).
 * @param {boolean} absolute - If true, treats the value as a percentage value itself, not decimal.
 * @returns {string} Formatted percentage string.
 */
export function formatPercent(value, absolute = true) {
  if (value === undefined || value === null || isNaN(value)) {
    return '0.00%';
  }
  const percentVal = absolute ? value : value * 100;
  return `${percentVal >= 0 ? '+' : ''}${percentVal.toFixed(2)}%`;
}

/**
 * Formats a wallet or address for display.
 * @param {string} address - The address to format.
 * @returns {string} Formatted address.
 */
export function formatAddress(address) {
  return truncateAddress(address);
}

/**
 * Formats a date into a simple time-left label.
 * @param {string|number|Date} value - Date-like value.
 * @returns {string} Human readable time remaining.
 */
export function formatTimeLeft(value) {
  if (!value) return 'Unknown';

  const targetTime = new Date(value).getTime();
  if (Number.isNaN(targetTime)) return 'Unknown';

  const diffMs = targetTime - Date.now();
  if (diffMs <= 0) return 'Ended';

  const totalMinutes = Math.floor(diffMs / 60000);
  const totalHours = Math.floor(totalMinutes / 60);
  const totalDays = Math.floor(totalHours / 24);

  if (totalDays > 0) return `${totalDays}d left`;
  if (totalHours > 0) return `${totalHours}h left`;
  if (totalMinutes > 0) return `${totalMinutes}m left`;
  return 'Less than 1m left';
}

/**
 * Formats a number with commas.
 * @param {number} num - Number to format.
 * @returns {string} Formatted number.
 */
export function formatNumber(num) {
  if (num === undefined || num === null || isNaN(num)) return '0';
  return new Intl.NumberFormat('en-US').format(num);
}

/**
 * Generates a beautiful CSS gradient avatar based on a seed string (e.g., username or wallet address).
 * @param {string} seed - The seed string (username or wallet).
 * @returns {string} A CSS linear-gradient string.
 */
export function generateAvatarGradient(seed) {
  if (!seed) seed = 'unknown';
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = seed.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Generate 2 contrasting but harmonious HSL colors
  const h1 = Math.abs(hash % 360);
  const s1 = 70 + (Math.abs(hash >> 8) % 20); // 70% to 90%
  const l1 = 40 + (Math.abs(hash >> 16) % 15); // 40% to 55%

  const h2 = (h1 + 120) % 360; // Triadic color
  const s2 = s1;
  const l2 = l1;

  return `linear-gradient(135deg, hsl(${h1}, ${s1}%, ${l1}%) 0%, hsl(${h2}, ${s2}%, ${l2}%) 100%)`;
}

/**
 * Generates initial text for avatar.
 * @param {string} name - The name or wallet.
 * @returns {string} The first 2 characters/initials.
 */
export function getInitials(name) {
  if (!name) return '??';
  if (name.startsWith('0x') && name.length > 6) {
    return name.slice(2, 4).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}

/**
 * Truncates a wallet address (e.g., 0x1234...5678).
 * @param {string} address - The Ethereum wallet address.
 * @returns {string} Truncated address.
 */
export function truncateAddress(address) {
  if (!address) return '';
  if (address.length <= 10) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Returns a short visual badge for a rank.
 * @param {number} rank - 1-based rank.
 * @returns {string} Badge label.
 */
export function getRankBadge(rank) {
  if (rank === 1) return '🥇 #1';
  if (rank === 2) return '🥈 #2';
  if (rank === 3) return '🥉 #3';
  return `#${rank}`;
}

/**
 * Creates skeleton loader structure as HTML template.
 * @param {string} type - The skeleton type ('table', 'grid', 'insights').
 * @returns {string} HTML string.
 */
export function getSkeletonLoader(type) {
  if (type === 'table') {
    return `
      <div class="skeleton-table">
        <div class="skeleton-row header"></div>
        ${Array(8).fill(0).map(() => `
          <div class="skeleton-row">
            <div class="skeleton-cell rank"></div>
            <div class="skeleton-cell avatar"></div>
            <div class="skeleton-cell name"></div>
            <div class="skeleton-cell profit"></div>
            <div class="skeleton-cell bets"></div>
          </div>
        `).join('')}
      </div>
    `;
  }
  
  if (type === 'grid') {
    return `
      <div class="skeleton-grid">
        ${Array(6).fill(0).map(() => `
          <div class="skeleton-card">
            <div class="skeleton-title"></div>
            <div class="skeleton-meta"></div>
            <div class="skeleton-bar"></div>
            <div class="skeleton-footer"></div>
          </div>
        `).join('')}
      </div>
    `;
  }

  if (type === 'insights') {
    return `
      <div class="skeleton-insights">
        <div class="skeleton-hero-card"></div>
        <div class="skeleton-grid">
          ${Array(4).fill(0).map(() => `
            <div class="skeleton-card insight">
              <div class="skeleton-meta"></div>
              <div class="skeleton-title"></div>
              <div class="skeleton-bar"></div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  return '<div class="skeleton"></div>';
}

/**
 * Simple debounce function.
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}
