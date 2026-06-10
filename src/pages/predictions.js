import { fetchSportsEvents } from '../api.js';
import { formatCurrency, formatTimeLeft } from '../utils.js';
import '../predictions.css';

/**
 * Sports Predictions page — CS2 & Football (World Cup).
 *
 * IMPORTANT DESIGN DECISION (read this, future me):
 * There is no such thing as a "~100% accuracy" predictor. The most accurate
 * public probability estimate available for these events IS the prediction
 * market price itself (it aggregates bookmakers, sharps and models in real
 * time). So this page surfaces the strongest market favorites and is
 * brutally honest about combined parlay probability instead of pretending.
 */

const SPORTS = {
  cs2: {
    label: 'CS2 / Esports',
    icon: '🔫',
    tagSlugs: ['cs2', 'counter-strike-2', 'esports'],
    keywords: ['cs2', 'counter-strike', 'blast', 'iem', 'esl'],
  },
  football: {
    label: 'Football / World Cup',
    icon: '⚽',
    tagSlugs: ['world-cup', 'fifa-world-cup', 'soccer', 'football'],
    keywords: ['world cup', 'fifa', 'uefa', 'premier league', 'champions league', 'la liga', 'serie a', 'bundesliga'],
  },
};

const MIN_VOLUME = 1000; // ignore dead/illiquid markets

// ---------- helpers ----------

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Flattens gamma events into "pick" objects: one per market, keeping the
 * favorite (highest-priced) outcome.
 */
function extractPicks(events) {
  const picks = [];
  const now = Date.now();

  for (const ev of events) {
    const markets = Array.isArray(ev.markets) ? ev.markets : [];
    for (const m of markets) {
      if (m.closed === true || m.active === false) continue;

      const outcomes = parseJsonArray(m.outcomes);
      const prices = parseJsonArray(m.outcomePrices).map(Number);
      if (outcomes.length === 0 || prices.length !== outcomes.length) continue;

      let favIdx = 0;
      for (let i = 1; i < prices.length; i++) {
        if (prices[i] > prices[favIdx]) favIdx = i;
      }

      const price = prices[favIdx];
      if (!Number.isFinite(price) || price <= 0 || price >= 0.99) continue; // skip near-resolved

      const endDate = m.endDate || ev.endDate || null;
      if (endDate && new Date(endDate).getTime() < now) continue;

      const volume = Number(m.volume ?? ev.volume ?? 0) || 0;
      if (volume < MIN_VOLUME) continue;

      picks.push({
        id: m.conditionId || m.id || `${ev.id}-${m.slug}`,
        title: m.question || m.groupItemTitle || ev.title || 'Unknown market',
        eventTitle: ev.title || '',
        outcome: outcomes[favIdx],
        price,
        volume,
        liquidity: Number(m.liquidity ?? 0) || 0,
        endDate,
        icon: m.icon || ev.icon || '',
        url: m.slug
          ? `https://polymarket.com/market/${m.slug}`
          : `https://polymarket.com/event/${ev.slug || ''}`,
      });
    }
  }

  // strongest favorites first, dedupe by id
  const seen = new Set();
  return picks
    .filter(p => (seen.has(p.id) ? false : seen.add(p.id)))
    .sort((a, b) => b.price - a.price);
}

// ---------- page ----------

export default {
  async render(container) {
    container.innerHTML = `
      <div class="page-header animate-fade-in">
        <div>
          <h2 class="page-header__title">Sports Edge</h2>
          <p class="page-header__subtitle">Strongest market favorites for CS2 & football — with the real math behind every slip</p>
        </div>
      </div>

      <div class="honesty-banner animate-fade-in">
        <strong>How to read this page:</strong> percentages are <em>market-implied probabilities</em> —
        the live consensus of thousands of bettors. They are the best public estimate available, but
        no pick is guaranteed, and a slip's chance of winning is the <em>product</em> of its legs.
        At fair prices, a slip that pays $15 → $100 wins roughly 15% of the time — by definition.
      </div>

      <div class="control-bar animate-fade-in predictions-controls">
        <div class="filter-tabs" id="sport-tabs">
          ${Object.entries(SPORTS).map(([key, s], i) => `
            <button class="filter-tab sport-btn ${i === 0 ? 'active' : ''}" data-sport="${key}">${s.icon} ${s.label}</button>
          `).join('')}
        </div>
        <div class="filter-group">
          <label class="control-label font-semibold" for="confidence-select">Min implied probability:</label>
          <select id="confidence-select" class="sort-select inline-select">
            <option value="0.70">70%+</option>
            <option value="0.80" selected>80%+</option>
            <option value="0.90">90%+</option>
            <option value="0.95">95%+</option>
          </select>
          <button class="btn btn--secondary btn--sm" id="refresh-picks">↻ Refresh</button>
        </div>
      </div>

      <div class="predictions-layout">
        <div id="picks-grid" class="picks-grid">
          <div class="empty-state"><p class="empty-state__message">Loading markets…</p></div>
        </div>

        <aside class="slip-panel animate-fade-in">
          <h3 class="slip-panel__title">🎟️ Bet Slip</h3>
          <div id="slip-legs" class="slip-legs">
            <p class="slip-empty">Tap “Add to slip” on a pick to build a slip.</p>
          </div>
          <div class="slip-stake-row">
            <label for="slip-stake" class="control-label">Stake ($)</label>
            <input type="number" id="slip-stake" class="slip-stake-input" value="15" min="1" step="1" />
          </div>
          <div id="slip-summary" class="slip-summary"></div>
          <button class="btn btn--secondary btn--sm slip-clear" id="slip-clear">Clear slip</button>
        </aside>
      </div>
    `;

    const picksGrid = container.querySelector('#picks-grid');
    const sportTabs = container.querySelector('#sport-tabs');
    const confidenceSelect = container.querySelector('#confidence-select');
    const refreshBtn = container.querySelector('#refresh-picks');
    const slipLegsEl = container.querySelector('#slip-legs');
    const slipSummaryEl = container.querySelector('#slip-summary');
    const stakeInput = container.querySelector('#slip-stake');
    const clearBtn = container.querySelector('#slip-clear');

    let currentSport = 'cs2';
    let allPicks = [];
    const slip = new Map(); // id -> pick

    const loadPicks = async (forceRefresh = false) => {
      picksGrid.innerHTML = `<div class="empty-state"><p class="empty-state__message">Scanning ${SPORTS[currentSport].label} markets…</p></div>`;
      try {
        const cfg = SPORTS[currentSport];
        const events = await fetchSportsEvents(cfg.tagSlugs, cfg.keywords, 60, forceRefresh);
        allPicks = extractPicks(events);
        renderPicks();
      } catch (err) {
        console.error('Failed to load sports markets:', err);
        picksGrid.innerHTML = `
          <div class="error-state">
            <h3 class="error-state__title">Couldn't load markets</h3>
            <p class="error-state__message">Polymarket's API may be rate-limiting. Try refresh in a moment.</p>
          </div>`;
      }
    };

    const renderPicks = () => {
      const minProb = parseFloat(confidenceSelect.value);
      const list = allPicks.filter(p => p.price >= minProb);

      if (list.length === 0) {
        picksGrid.innerHTML = `
          <div class="empty-state">
            <h3 class="empty-state__title">No markets above ${(minProb * 100).toFixed(0)}%</h3>
            <p class="empty-state__message">Lower the confidence filter, or check back closer to match time — favorites firm up as games approach.</p>
          </div>`;
        return;
      }

      picksGrid.innerHTML = list.map(p => {
        const inSlip = slip.has(p.id);
        const pct = (p.price * 100).toFixed(1);
        const payoutMult = (1 / p.price).toFixed(2);
        return `
          <div class="pick-card animate-scale-in">
            <div class="pick-card__top">
              ${p.icon ? `<img src="${escapeHtml(p.icon)}" class="pick-card__icon" alt="" onerror="this.style.display='none'" />` : ''}
              <div class="pick-card__prob">
                <span class="pick-card__prob-value">${pct}%</span>
                <span class="pick-card__prob-label">implied</span>
              </div>
            </div>
            <h4 class="pick-card__title"><a href="${escapeHtml(p.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(p.title)}</a></h4>
            <div class="pick-card__outcome">
              Pick: <span class="outcome-badge outcome-badge--neutral">${escapeHtml(p.outcome)}</span>
              <span class="pick-card__mult">pays ×${payoutMult}</span>
            </div>
            <div class="pick-card__meta">
              <span>Vol ${formatCurrency(p.volume, true)}</span>
              <span>${p.endDate ? formatTimeLeft(p.endDate) : ''}</span>
            </div>
            <button class="btn ${inSlip ? 'btn--active' : 'btn--primary'} btn--sm pick-card__add" data-id="${escapeHtml(p.id)}">
              ${inSlip ? '✓ In slip' : '+ Add to slip'}
            </button>
          </div>
        `;
      }).join('');

      picksGrid.querySelectorAll('.pick-card__add').forEach(btn => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-id');
          const pick = allPicks.find(p => String(p.id) === id);
          if (!pick) return;
          if (slip.has(id)) slip.delete(id);
          else slip.set(id, pick);
          renderPicks();
          renderSlip();
        });
      });
    };

    const renderSlip = () => {
      const legs = [...slip.values()];

      if (legs.length === 0) {
        slipLegsEl.innerHTML = `<p class="slip-empty">Tap “Add to slip” on a pick to build a slip.</p>`;
        slipSummaryEl.innerHTML = '';
        return;
      }

      slipLegsEl.innerHTML = legs.map(p => `
        <div class="slip-leg">
          <div class="slip-leg__info">
            <span class="slip-leg__title">${escapeHtml(p.title)}</span>
            <span class="slip-leg__outcome">${escapeHtml(p.outcome)} · ${(p.price * 100).toFixed(1)}%</span>
          </div>
          <button class="slip-leg__remove" data-id="${escapeHtml(p.id)}" title="Remove">✕</button>
        </div>
      `).join('');

      slipLegsEl.querySelectorAll('.slip-leg__remove').forEach(btn => {
        btn.addEventListener('click', () => {
          slip.delete(btn.getAttribute('data-id'));
          renderPicks();
          renderSlip();
        });
      });

      const stake = Math.max(0, parseFloat(stakeInput.value) || 0);
      const combinedProb = legs.reduce((acc, p) => acc * p.price, 1);
      const multiplier = legs.reduce((acc, p) => acc * (1 / p.price), 1);
      const payout = stake * multiplier;
      const target = 100;
      const neededMult = stake > 0 ? target / stake : Infinity;
      const hitsTarget = payout >= target;

      // probability tone
      let probClass = 'text-success';
      if (combinedProb < 0.65) probClass = 'text-danger';
      else if (combinedProb < 0.85) probClass = '';

      slipSummaryEl.innerHTML = `
        <div class="slip-row"><span>Legs</span><span class="font-mono">${legs.length}</span></div>
        <div class="slip-row"><span>Combined payout</span><span class="font-mono">×${multiplier.toFixed(2)}</span></div>
        <div class="slip-row"><span>Returns</span><span class="font-mono">${formatCurrency(payout)}</span></div>
        <div class="slip-row slip-row--big">
          <span>Chance ALL legs win</span>
          <span class="font-mono font-semibold ${probClass}">${(combinedProb * 100).toFixed(1)}%</span>
        </div>
        <div class="slip-row"><span>Chance slip loses</span><span class="font-mono">${((1 - combinedProb) * 100).toFixed(1)}%</span></div>
        <div class="slip-note">
          ${hitsTarget
            ? `This slip hits your $${target} target — and its real win probability is <strong>${(combinedProb * 100).toFixed(1)}%</strong>. Over many attempts you'd expect to lose the stake the other ${((1 - combinedProb) * 100).toFixed(0)}% of the time.`
            : `To turn ${formatCurrency(stake)} into $${target} you need ×${neededMult.toFixed(2)}. This slip pays ×${multiplier.toFixed(2)} — add legs to raise the payout, but every leg multiplies the risk too.`}
        </div>
      `;
    };

    // events
    sportTabs.querySelectorAll('.sport-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        sportTabs.querySelectorAll('.sport-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentSport = btn.getAttribute('data-sport');
        await loadPicks();
      });
    });

    confidenceSelect.addEventListener('change', renderPicks);
    refreshBtn.addEventListener('click', () => loadPicks(true));
    stakeInput.addEventListener('input', renderSlip);
    clearBtn.addEventListener('click', () => {
      slip.clear();
      renderPicks();
      renderSlip();
    });

    await loadPicks();
    renderSlip();
  }
};
