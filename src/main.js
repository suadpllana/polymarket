import "./style.css";
import {
  fetchLeaderboard,
  fetchMarkets,
  rankBestBets,
  formatCurrency,
  formatAddress,
  formatPercent,
  formatTimeLeft,
  getRankBadge,
} from "./api.js";

// ---- App State ----
const state = {
  traders: [],
  markets: [],
  loading: true,
  marketsLoading: true,
  error: null,
  marketsError: null,
  sortBy: "profit",
  searchQuery: "",
  currentView: "bestbets",
  // Best Bets controls
  betConfidence: "0.8",
  betCategory: "all",
  // Markets controls
  marketSort: "volume",
  marketSearch: "",
  marketCategory: "all",
};

// ---- Routing ----
const routes = {
  bestbets: renderBestBets,
  markets: renderMarkets,
  leaderboard: renderLeaderboard,
  about: renderAbout,
};

function navigate(view) {
  state.currentView = view;
  window.location.hash = view;
}

function handleRouteChange() {
  const hash = window.location.hash.slice(1) || "bestbets";
  state.currentView = hash;
  render();
}

// ---- Render Functions ----
function render() {
  const app = document.querySelector("#app");
  if (!app) return;

  app.innerHTML = `
    ${renderNav()}
    <main class="main-content">
      ${renderCurrentView()}
    </main>
    ${renderFooter()}
  `;

  attachEventListeners();
}

function renderCurrentView() {
  const renderFn = routes[state.currentView] || renderBestBets;
  return renderFn();
}

function navLink(view, label) {
  return `<a href="#${view}" class="nav-link ${
    state.currentView === view ? "active" : ""
  }">${label}</a>`;
}

function renderNav() {
  return `
    <nav class="navbar">
      <div class="nav-container">
        <div class="nav-brand">
          <span class="nav-logo">📊</span>
          <span class="nav-title">Polymarket Edge</span>
        </div>
        <div class="nav-links">
          ${navLink("bestbets", "🏆 Best Bets")}
          ${navLink("markets", "📈 Markets")}
          ${navLink("leaderboard", "Top Traders")}
          ${navLink("about", "About")}
        </div>
      </div>
    </nav>
  `;
}

function renderFooter() {
  return `
    <footer class="footer">
      <div class="footer-content">
        <p class="footer-disclaimer">⚠️ Not financial advice. Markets carry risk — do your own research.</p>
        <p>Data sourced from Polymarket APIs. This is an unofficial dashboard.</p>
        <p class="footer-sub">Built with vanilla JavaScript and Vite.</p>
      </div>
    </footer>
  `;
}

function renderLoading(message = "Loading...") {
  return `
    <div class="loading-container">
      <div class="spinner"></div>
      <p>${message}</p>
    </div>
  `;
}

function renderError(message) {
  return `
    <div class="error-container">
      <p class="error-message">⚠️ ${message}</p>
      <button class="retry-btn" onclick="window.location.reload()">Retry</button>
    </div>
  `;
}

function renderEmpty(message) {
  return `<div class="empty-state"><p>${message}</p></div>`;
}

// ---- Probability bar helper ----
function probClass(p) {
  if (p >= 0.9) return "prob-high";
  if (p >= 0.75) return "prob-mid";
  return "prob-neutral";
}

function renderProbBar(p) {
  const pct = Math.round(p * 100);
  return `
    <div class="prob-bar">
      <div class="prob-bar-fill ${probClass(p)}" style="width:${pct}%"></div>
    </div>
  `;
}

function renderStars(score) {
  // map 0..1 score to 1..5 stars
  const stars = Math.max(1, Math.min(5, Math.round(score * 5)));
  let out = "";
  for (let i = 0; i < 5; i++) out += i < stars ? "★" : "☆";
  return out;
}

// ---- Categories ----
function getCategories() {
  const set = new Set();
  for (const m of state.markets) {
    if (m.category) set.add(m.category);
  }
  return [...set].sort();
}

// =====================================================================
// BEST BETS PAGE
// =====================================================================
function getBestBets() {
  const minProb = Number(state.betConfidence) || 0.6;
  let bets = rankBestBets(state.markets, { minProbability: minProb });
  if (state.betCategory !== "all") {
    bets = bets.filter((m) => m.category === state.betCategory);
  }
  return bets;
}

function renderBestBets() {
  if (state.marketsLoading) return renderLoading("Scanning markets for the best edges...");
  if (state.marketsError) return renderError(state.marketsError);

  const bets = getBestBets();
  const categoryOptions = ["all", ...getCategories()]
    .map(
      (c) =>
        `<option value="${c}" ${state.betCategory === c ? "selected" : ""}>${
          c === "all" ? "All categories" : c
        }</option>`
    )
    .join("");

  const confidenceLevels = [
    { value: "0.9", label: "Near-locks (90%+)" },
    { value: "0.8", label: "Strong (80%+)" },
    { value: "0.7", label: "Solid (70%+)" },
    { value: "0.6", label: "All edges (60%+)" },
  ];

  return `
    <div class="leaderboard-header">
      <h1>🏆 Best Bets</h1>
      <p class="subtitle">The most agreed-on, easiest-to-win markets — ranked by confidence</p>
    </div>

    <details class="explainer">
      <summary>How the confidence score works</summary>
      <p>Each market is scored 0–100% combining four signals: the favorite outcome's
      implied win chance (50%), market liquidity (25%), trading volume (15%), and how
      tight the spread is (10%). We exclude markets that are nearly settled (95%+) since
      there's almost no payout left, low-probability coin flips, and illiquid markets you
      can't trade. Higher score = more crowd agreement plus the depth to back it up.</p>
    </details>

    <div class="controls">
      <div class="sort-controls">
        <label>Confidence:</label>
        <select id="bet-confidence">
          ${confidenceLevels
            .map(
              (l) =>
                `<option value="${l.value}" ${
                  state.betConfidence === l.value ? "selected" : ""
                }>${l.label}</option>`
            )
            .join("")}
        </select>
      </div>
      <div class="sort-controls">
        <label>Category:</label>
        <select id="bet-category">${categoryOptions}</select>
      </div>
    </div>

    <div class="bestbets-grid">
      ${
        bets.length
          ? bets.map((b, i) => renderBestBetCard(b, i)).join("")
          : renderEmpty("No markets match this confidence level. Try lowering the threshold.")
      }
    </div>
  `;
}

function renderBestBetCard(bet, index) {
  const winPct = formatPercent(bet.favoriteProbability);
  const payoutPct = `+${(bet.potentialReturn * 100).toFixed(0)}%`;
  return `
    <a class="bet-card" href="${bet.url}" target="_blank" rel="noopener noreferrer">
      <div class="bet-rank">${getRankBadge(index + 1)}</div>
      <div class="bet-body">
        <div class="bet-top">
          <span class="bet-category">${bet.category}</span>
          <span class="bet-confidence" title="Confidence score ${(bet.score * 100).toFixed(0)}%">${renderStars(
            bet.score
          )}</span>
        </div>
        <h3 class="bet-question">${bet.question}</h3>
        <div class="bet-pick">
          <span class="bet-pick-label">Smart pick:</span>
          <span class="bet-pick-name">${bet.favorite}</span>
        </div>
        ${renderProbBar(bet.favoriteProbability)}
        <div class="bet-stats">
          <div class="stat">
            <span class="stat-label">Win chance</span>
            <span class="stat-value ${probClass(bet.favoriteProbability)}-text">${winPct}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Payout if win</span>
            <span class="stat-value profit">${payoutPct}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Liquidity</span>
            <span class="stat-value">${formatCurrency(bet.liquidity)}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Volume</span>
            <span class="stat-value">${formatCurrency(bet.volume)}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Time left</span>
            <span class="stat-value">${formatTimeLeft(bet.endDate)}</span>
          </div>
        </div>
      </div>
    </a>
  `;
}

// =====================================================================
// MARKETS PAGE
// =====================================================================
function getFilteredMarkets() {
  let result = [...state.markets];

  if (state.marketSearch) {
    const q = state.marketSearch.toLowerCase();
    result = result.filter(
      (m) =>
        m.question.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q)
    );
  }

  if (state.marketCategory !== "all") {
    result = result.filter((m) => m.category === state.marketCategory);
  }

  switch (state.marketSort) {
    case "liquidity":
      result.sort((a, b) => b.liquidity - a.liquidity);
      break;
    case "probability":
      result.sort((a, b) => b.favoriteProbability - a.favoriteProbability);
      break;
    default:
      result.sort((a, b) => b.volume - a.volume);
  }

  return result;
}

function renderMarkets() {
  if (state.marketsLoading) return renderLoading("Loading markets...");
  if (state.marketsError) return renderError(state.marketsError);

  const filtered = getFilteredMarkets();
  const categoryOptions = ["all", ...getCategories()]
    .map(
      (c) =>
        `<option value="${c}" ${state.marketCategory === c ? "selected" : ""}>${
          c === "all" ? "All categories" : c
        }</option>`
    )
    .join("");

  return `
    <div class="leaderboard-header">
      <h1>📈 Markets</h1>
      <p class="subtitle">Browse ${state.markets.length} live Polymarket markets</p>
    </div>
    <div class="controls">
      <div class="search-box">
        <input
          type="text"
          id="market-search"
          placeholder="Search markets..."
          value="${state.marketSearch}"
        />
      </div>
      <div class="sort-controls">
        <label>Category:</label>
        <select id="market-category">${categoryOptions}</select>
      </div>
      <div class="sort-controls">
        <label>Sort by:</label>
        <select id="market-sort">
          <option value="volume" ${state.marketSort === "volume" ? "selected" : ""}>Volume</option>
          <option value="liquidity" ${state.marketSort === "liquidity" ? "selected" : ""}>Liquidity</option>
          <option value="probability" ${state.marketSort === "probability" ? "selected" : ""}>Probability</option>
        </select>
      </div>
    </div>
    <div class="markets-grid">
      ${
        filtered.length
          ? filtered.map((m) => renderMarketCard(m)).join("")
          : renderEmpty("No markets found. Try a different search or category.")
      }
    </div>
  `;
}

function renderMarketCard(m) {
  return `
    <a class="market-card" href="${m.url}" target="_blank" rel="noopener noreferrer">
      <div class="market-top">
        <span class="bet-category">${m.category}</span>
        <span class="market-end">${formatTimeLeft(m.endDate)}</span>
      </div>
      <h3 class="market-question">${m.question}</h3>
      <div class="market-fav">
        <span class="market-fav-name">${m.favorite}</span>
        <span class="market-fav-prob ${probClass(m.favoriteProbability)}-text">${formatPercent(
          m.favoriteProbability
        )}</span>
      </div>
      ${renderProbBar(m.favoriteProbability)}
      <div class="market-stats">
        <div class="stat">
          <span class="stat-label">Volume</span>
          <span class="stat-value">${formatCurrency(m.volume)}</span>
        </div>
        <div class="stat">
          <span class="stat-label">Liquidity</span>
          <span class="stat-value">${formatCurrency(m.liquidity)}</span>
        </div>
      </div>
    </a>
  `;
}

// =====================================================================
// LEADERBOARD PAGE (existing)
// =====================================================================
function renderLeaderboard() {
  if (state.loading) return renderLoading("Loading top traders...");
  if (state.error) return renderError(state.error);

  const filtered = getFilteredTraders();

  return `
    <div class="leaderboard-header">
      <h1>🏆 Top 100 Traders</h1>
      <p class="subtitle">Ranked by all-time profit on Polymarket</p>
    </div>
    <div class="controls">
      <div class="search-box">
        <input
          type="text"
          id="search-input"
          placeholder="Search by address..."
          value="${state.searchQuery}"
        />
      </div>
      <div class="sort-controls">
        <label>Sort by:</label>
        <select id="sort-select">
          <option value="profit" ${state.sortBy === "profit" ? "selected" : ""}>Profit</option>
          <option value="volume" ${state.sortBy === "volume" ? "selected" : ""}>Volume</option>
          <option value="rank" ${state.sortBy === "rank" ? "selected" : ""}>Rank</option>
        </select>
      </div>
    </div>
    <div class="leaderboard-grid">
      ${filtered.map((t, i) => renderTraderCard(t, i)).join("")}
    </div>
  `;
}

function renderTraderCard(trader) {
  const rankBadge = getRankBadge(trader.rank);
  return `
    <div class="trader-card">
      <div class="trader-rank">${rankBadge}</div>
      <div class="trader-info">
        <div class="trader-address">${formatAddress(trader.address)}</div>
        <div class="trader-stats">
          <div class="stat">
            <span class="stat-label">Profit</span>
            <span class="stat-value profit">${formatCurrency(trader.profit)}</span>
          </div>
          <div class="stat">
            <span class="stat-label">Volume</span>
            <span class="stat-value">${formatCurrency(trader.volume)}</span>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderAbout() {
  return `
    <div class="about-container">
      <h1>About</h1>
      <p>Polymarket Edge surfaces the most agreed-on, easiest-to-win markets on Polymarket,
      lets you browse hundreds of live markets, and tracks the top traders.</p>
      <p><strong>Best Bets</strong> ranks markets by a confidence score blending the favorite's
      implied win chance, liquidity, volume, and spread tightness.</p>
      <p><strong>Markets</strong> lets you search, filter, and sort every live market by volume,
      liquidity, or probability.</p>
      <p class="about-note">⚠️ This is not financial advice. A high implied probability is not a
      guarantee — upsets happen and you can lose your stake.</p>
    </div>
  `;
}

// ---- Filtering & Sorting (traders) ----
function getFilteredTraders() {
  let result = [...state.traders];

  if (state.searchQuery) {
    const q = state.searchQuery.toLowerCase();
    result = result.filter((t) => t.address.toLowerCase().includes(q));
  }

  switch (state.sortBy) {
    case "volume":
      result.sort((a, b) => b.volume - a.volume);
      break;
    case "rank":
      result.sort((a, b) => a.rank - b.rank);
      break;
    default:
      result.sort((a, b) => b.profit - a.profit);
  }

  return result;
}

// ---- Event Listeners ----
function attachEventListeners() {
  // Leaderboard
  const searchInput = document.querySelector("#search-input");
  if (searchInput) {
    searchInput.addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      const grid = document.querySelector(".leaderboard-grid");
      if (grid) {
        grid.innerHTML = getFilteredTraders()
          .map((t, i) => renderTraderCard(t, i))
          .join("");
      }
    });
  }

  const sortSelect = document.querySelector("#sort-select");
  if (sortSelect) {
    sortSelect.addEventListener("change", (e) => {
      state.sortBy = e.target.value;
      render();
    });
  }

  // Best Bets
  const betConfidence = document.querySelector("#bet-confidence");
  if (betConfidence) {
    betConfidence.addEventListener("change", (e) => {
      state.betConfidence = e.target.value;
      render();
    });
  }

  const betCategory = document.querySelector("#bet-category");
  if (betCategory) {
    betCategory.addEventListener("change", (e) => {
      state.betCategory = e.target.value;
      render();
    });
  }

  // Markets
  const marketSearch = document.querySelector("#market-search");
  if (marketSearch) {
    marketSearch.addEventListener("input", (e) => {
      state.marketSearch = e.target.value;
      const grid = document.querySelector(".markets-grid");
      if (grid) {
        const filtered = getFilteredMarkets();
        grid.innerHTML = filtered.length
          ? filtered.map((m) => renderMarketCard(m)).join("")
          : renderEmpty("No markets found. Try a different search or category.");
      }
    });
  }

  const marketCategory = document.querySelector("#market-category");
  if (marketCategory) {
    marketCategory.addEventListener("change", (e) => {
      state.marketCategory = e.target.value;
      render();
    });
  }

  const marketSort = document.querySelector("#market-sort");
  if (marketSort) {
    marketSort.addEventListener("change", (e) => {
      state.marketSort = e.target.value;
      render();
    });
  }
}

// ---- Initialization ----
async function init() {
  window.addEventListener("hashchange", handleRouteChange);

  const hash = window.location.hash.slice(1);
  if (hash) state.currentView = hash;

  render();

  // Load markets (powers Best Bets + Markets)
  fetchMarkets()
    .then((markets) => {
      state.markets = markets;
      state.marketsLoading = false;
      render();
    })
    .catch((err) => {
      state.marketsError = err.message || "Failed to load markets";
      state.marketsLoading = false;
      render();
    });

  // Load traders (Top Traders)
  fetchLeaderboard()
    .then((traders) => {
      state.traders = traders;
      state.loading = false;
      if (state.currentView === "leaderboard") render();
    })
    .catch((err) => {
      state.error = err.message || "Failed to load data";
      state.loading = false;
      if (state.currentView === "leaderboard") render();
    });
}

init();
