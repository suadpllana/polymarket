/**
 * SHARP EDGE — the main page.
 *
 * Design principle: every number on this screen must be defensible, and the
 * page must be as clear about what it does NOT know as about what it does.
 * A betting tool that only ever shows green is not a tool, it is a slot
 * machine with extra steps.
 */

import { runScan } from '../engine/scanner.js';
import { DEFAULTS, PRESETS, portfolioStats } from '../engine/model.js';
import { buildArbPlan } from '../engine/arb.js';
import { recordSignals, settleAgainst, summarize, resetLedger } from '../engine/ledger.js';
import { formatCurrency, formatTimeLeft } from '../utils.js';
import '../edge.css';

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const cents = (v) => `${(v * 100).toFixed(1)}¢`;
const pts = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}`;
const pct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`;

const STAKE_KEY = 'sharpedge_bankroll';
const PRESET_KEY = 'sharpedge_preset';

export default {
  async render(container) {
    let bankroll = Number(localStorage.getItem(STAKE_KEY)) || 1000;
    let presetName = localStorage.getItem(PRESET_KEY) || 'balanced';
    let result = null;
    let activeTab = 'bets';

    container.innerHTML = shell(bankroll, presetName);

    const els = {
      loader: container.querySelector('#edge-loader'),
      body: container.querySelector('#edge-body'),
      phase: container.querySelector('#loader-phase'),
      bar: container.querySelector('#loader-bar'),
      detail: container.querySelector('#loader-detail'),
      record: container.querySelector('#record-strip'),
      tabs: container.querySelector('#edge-tabs'),
      panel: container.querySelector('#edge-panel'),
      stats: container.querySelector('#scan-stats'),
      preset: container.querySelector('#preset-select'),
      bankroll: container.querySelector('#bankroll-input'),
      refresh: container.querySelector('#refresh-scan'),
      reset: container.querySelector('#reset-ledger'),
    };

    const cfg = () => ({ ...DEFAULTS, ...PRESETS[presetName] });

    const scan = async (force = false) => {
      els.loader.classList.remove('hidden');
      els.body.classList.add('hidden');

      try {
        result = await runScan({
          cfg: cfg(),
          windows: ['1d', '7d', '30d', 'all'],
          rosterSize: 50,
          forceRefresh: force,
          onProgress: (phase, done, total, label) => {
            const labels = {
              roster: 'Assembling the roster of proven traders',
              books: 'Measuring each trader’s portfolio size',
              positions: 'Reading every open position',
              group: 'Grouping by market and side',
              pricing: 'Re-pricing against live order books',
              scoring: 'Scoring and gating candidates',
              arbitrage: 'Hunting guaranteed mispricings',
            };
            els.phase.textContent = labels[phase] || label || 'Working';
            els.detail.textContent = total > 1 ? `${done} / ${total}` : '';
            const width = total > 1 ? Math.round((done / total) * 100) : 8;
            els.bar.style.width = `${width}%`;
          },
        });

        // Stamp every surfaced bet into the ledger before anything is shown,
        // then settle whatever the latest prices have already decided.
        recordSignals(result.signals);
        if (result.liveMarkets) settleAgainst(result.liveMarkets);

        els.loader.classList.add('hidden');
        els.body.classList.remove('hidden');
        renderAll();
      } catch (err) {
        console.error('Scan failed:', err);
        els.loader.innerHTML = `
          <div class="error-state">
            <h3 class="error-state__title">Scan interrupted</h3>
            <p class="error-state__message">${esc(err.message || 'Polymarket may be rate-limiting. Try again shortly.')}</p>
            <button class="btn btn--primary" id="retry-scan">Retry</button>
          </div>`;
        container.querySelector('#retry-scan')?.addEventListener('click', () => scan(true));
      }
    };

    const renderAll = () => {
      renderRecord();
      renderStats();
      renderPanel();
    };

    const renderRecord = () => {
      const s = summarize();
      els.record.innerHTML = recordStrip(s);
    };

    const renderStats = () => {
      const st = result.stats;
      els.stats.innerHTML = `
        <span><strong>${st.tradersScanned}</strong> proven traders</span>
        <span><strong>${st.livePositions}</strong> open positions</span>
        <span><strong>${st.marketsSeen}</strong> markets</span>
        <span><strong>${st.candidates}</strong> candidates</span>
        <span class="scan-stats__time">${(st.elapsedMs / 1000).toFixed(1)}s</span>`;

      const counts = {
        bets: result.signals.length,
        arb: result.arbitrage.length,
        watch: result.watchlist.length,
        traps: result.traps.length,
      };
      els.tabs.querySelectorAll('.edge-tab').forEach((t) => {
        const key = t.dataset.tab;
        const badge = t.querySelector('.edge-tab__count');
        if (badge) badge.textContent = counts[key] ?? 0;
        t.classList.toggle('active', key === activeTab);
      });
    };

    const renderPanel = () => {
      if (activeTab === 'bets') els.panel.innerHTML = betsView(result, bankroll);
      else if (activeTab === 'arb') els.panel.innerHTML = arbView(result, bankroll);
      else if (activeTab === 'watch') els.panel.innerHTML = watchView(result);
      else if (activeTab === 'traps') els.panel.innerHTML = trapsView(result);
      else els.panel.innerHTML = ledgerView(summarize());
    };

    els.tabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.edge-tab');
      if (!tab) return;
      activeTab = tab.dataset.tab;
      els.tabs.querySelectorAll('.edge-tab').forEach((t) =>
        t.classList.toggle('active', t.dataset.tab === activeTab)
      );
      renderPanel();
    });

    els.bankroll.addEventListener('input', () => {
      bankroll = Math.max(0, Number(els.bankroll.value) || 0);
      localStorage.setItem(STAKE_KEY, String(bankroll));
      if (result) renderPanel();
    });

    els.preset.addEventListener('change', async () => {
      presetName = els.preset.value;
      localStorage.setItem(PRESET_KEY, presetName);
      await scan(false);
    });

    els.refresh.addEventListener('click', () => scan(true));

    els.reset.addEventListener('click', () => {
      if (!confirm('Clear the tracked record of every signal this app has made? This cannot be undone.')) return;
      resetLedger();
      renderRecord();
      if (activeTab === 'ledger') renderPanel();
    });

    await scan(false);
  },
};

/* ------------------------------------------------------------------ shell */

function shell(bankroll, presetName) {
  return `
    <div class="page-header animate-fade-in">
      <div>
        <h2 class="page-header__title">Sharp Edge</h2>
        <p class="page-header__subtitle">
          Bets where the price looks wrong — measured against what proven traders paid, and against arithmetic
        </p>
      </div>
      <div class="edge-controls">
        <label class="control-label" for="preset-select">Model</label>
        <select id="preset-select" class="sort-select inline-select">
          ${Object.entries(PRESETS)
            .map(
              ([k, p]) =>
                `<option value="${k}" ${k === presetName ? 'selected' : ''}>${p.label}</option>`
            )
            .join('')}
        </select>
        <label class="control-label" for="bankroll-input">Bankroll $</label>
        <input type="number" id="bankroll-input" class="bankroll-input" value="${bankroll}" min="0" step="50" />
        <button class="btn btn--secondary btn--sm" id="refresh-scan">↻ Rescan</button>
      </div>
    </div>

    <div class="thesis-banner animate-fade-in">
      <strong>What this page actually claims.</strong>
      A market trading at 92¢ wins about 92% of the time and pays 8.7% — high probability, no profit.
      So nothing here is ranked by how likely it is to win. It is ranked by how far the price looks
      <em>wrong</em>: what Polymarket's most profitable traders paid for the same contract, versus what it
      costs you now, after spread and slippage. The Guaranteed tab is different in kind — those are
      arithmetic, not opinion.
    </div>

    <div id="record-strip" class="record-strip animate-fade-in"></div>

    <div id="edge-loader" class="edge-loader">
      <div class="loader-card">
        <div class="loader-card__spinner"></div>
        <h3 class="loader-card__title" id="loader-phase">Starting scan…</h3>
        <p class="loader-card__message" id="loader-detail"></p>
        <div class="progress-bar-wrapper">
          <div class="progress-bar-fill" id="loader-bar" style="width:0%"></div>
        </div>
      </div>
    </div>

    <div id="edge-body" class="hidden animate-fade-in">
      <div id="scan-stats" class="scan-stats"></div>
      <div id="edge-tabs" class="edge-tabs">
        <button class="edge-tab active" data-tab="bets">Value bets <span class="edge-tab__count">0</span></button>
        <button class="edge-tab" data-tab="arb">Guaranteed <span class="edge-tab__count">0</span></button>
        <button class="edge-tab" data-tab="watch">Watchlist <span class="edge-tab__count">0</span></button>
        <button class="edge-tab" data-tab="traps">Traps <span class="edge-tab__count">0</span></button>
        <button class="edge-tab" data-tab="ledger">Track record</button>
      </div>
      <div id="edge-panel" class="edge-panel"></div>
      <div class="edge-footer">
        <button class="btn btn--ghost btn--sm" id="reset-ledger">Reset tracked record</button>
      </div>
    </div>
  `;
}

/* ------------------------------------------------------------ record strip */

function recordStrip(s) {
  if (!s.total) {
    return `
      <div class="record-strip__empty">
        <strong>No track record yet.</strong> Every bet this app surfaces is stamped with the price at that
        moment and checked back automatically. Come back after a few scans and this strip will show whether
        the model actually beats the market — rather than asking you to take its word for it.
      </div>`;
  }

  const cell = (label, value, tone = '', hint = '') => `
    <div class="record-cell ${tone}">
      <span class="record-cell__value">${value}</span>
      <span class="record-cell__label">${label}</span>
      ${hint ? `<span class="record-cell__hint">${hint}</span>` : ''}
    </div>`;

  const hit = s.hitRate == null ? '—' : `${(s.hitRate * 100).toFixed(0)}%`;
  const roi = s.roi == null ? '—' : pct(s.roi * 100);
  const clv = s.clvAvg == null ? '—' : pts(s.clvAvg);
  const roiTone = s.roi == null ? '' : s.roi >= 0 ? 'is-good' : 'is-bad';
  const clvTone = s.clvAvg == null ? '' : s.clvAvg >= 0 ? 'is-good' : 'is-bad';

  // Below ~30 settled bets, hit rate is mostly noise. Say so rather than
  // letting a 3-1 start read as proof of anything.
  const thin = s.settled < 30;

  return `
    <div class="record-strip__grid">
      ${cell('Tracked', s.total, '', `${s.open} still open`)}
      ${cell('Settled', s.settled, '', `${s.wins}W / ${s.losses}L`)}
      ${cell('Hit rate', hit, '', thin ? 'too few to be meaningful' : 'realised')}
      ${cell('ROI per $1', roi, roiTone, 'on settled bets')}
      ${cell('Closing line', clv, clvTone, `${s.clvSample} priced again`)}
    </div>
    ${
      thin
        ? `<p class="record-strip__caveat">Fewer than 30 settled bets. Treat the hit rate as noise for now —
           closing-line value is the number worth watching early, because it moves long before slow markets resolve.</p>`
        : ''
    }`;
}

/* -------------------------------------------------------------- bets view */

function betsView(result, bankroll) {
  const signals = result.signals;

  if (!signals.length) {
    return emptyBets(result);
  }

  const port = portfolioStats(signals, bankroll);

  return `
    ${port ? portfolioSummary(port) : ''}
    <div class="signal-grid">
      ${signals.map((s) => signalCard(s, bankroll)).join('')}
    </div>`;
}

function emptyBets(result) {
  const near = result.rejected.slice(0, 3);
  return `
    <div class="empty-state empty-state--reasoned">
      <h3 class="empty-state__title">No bet cleared every gate on this scan</h3>
      <p class="empty-state__message">
        This is a real answer, not a failure. The tracked traders' positions currently line up with market
        prices closely enough that there is no mispricing worth your money at this setting. Forcing something
        onto the screen here is exactly how a tool like this starts costing you money.
      </p>
      <p class="empty-state__message">
        Options: check <strong>Guaranteed</strong> for arbitrage that needs no forecast at all, look at the
        <strong>Watchlist</strong> for positions that are close, or loosen the model dial above.
      </p>
      ${
        near.length
          ? `<div class="near-miss">
              <h4>Closest to qualifying</h4>
              ${near
                .map(
                  (s) => `
                <div class="near-miss__row">
                  <span class="near-miss__title">${esc(s.market.title)}</span>
                  <span class="near-miss__why">${esc(s.failures[0] || '')}</span>
                </div>`
                )
                .join('')}
            </div>`
          : ''
      }
    </div>`;
}

function portfolioSummary(p) {
  return `
    <div class="portfolio-summary">
      <div class="portfolio-summary__main">
        <div class="ps-cell">
          <span class="ps-value">${p.count}</span>
          <span class="ps-label">bets</span>
        </div>
        <div class="ps-cell">
          <span class="ps-value">${formatCurrency(p.totalStake)}</span>
          <span class="ps-label">total stake (¼-Kelly)</span>
        </div>
        <div class="ps-cell">
          <span class="ps-value ${p.totalEv >= 0 ? 'text-success' : 'text-danger'}">${formatCurrency(p.totalEv)}</span>
          <span class="ps-label">expected profit</span>
        </div>
        <div class="ps-cell">
          <span class="ps-value">${p.expectedWins.toFixed(1)}</span>
          <span class="ps-label">expected winners of ${p.count}</span>
        </div>
      </div>
      <p class="portfolio-summary__note">
        Stakes are quarter-Kelly on your bankroll and scaled down if the set would risk more than half of it.
        Expect roughly ${p.expectedWins.toFixed(1)} of these ${p.count} to land — the profit comes from the
        prices being wrong on average, not from every bet winning.
      </p>
    </div>`;
}

function signalCard(s, bankroll) {
  const stake = bankroll * s.stakeFraction;
  const tierClass = `tier-${s.tier.toLowerCase()}`;

  return `
    <article class="signal-card ${tierClass} animate-scale-in">
      <header class="signal-card__head">
        <div class="signal-card__badges">
          <span class="tier-badge">${esc(s.tier)}</span>
          <span class="grade-badge grade-${s.grade}">${s.grade}</span>
        </div>
        <div class="signal-card__ev">
          <span class="signal-card__ev-value">${pct(s.evPct)}</span>
          <span class="signal-card__ev-label">expected value</span>
        </div>
      </header>

      <h3 class="signal-card__title">
        <a href="${esc(s.market.url)}" target="_blank" rel="noopener noreferrer">${esc(s.market.title)}</a>
      </h3>

      <div class="signal-card__action">
        <span class="action-verb">BUY</span>
        <span class="action-outcome">${esc(s.outcome)}</span>
        <span class="action-price">at ${cents(s.execPrice)}</span>
        <span class="action-note">all-in, after spread &amp; slippage</span>
      </div>

      <div class="price-bar">
        <div class="price-bar__track">
          <div class="price-bar__market" style="left:${(s.execPrice * 100).toFixed(1)}%"></div>
          <div class="price-bar__fair" style="left:${(s.fair * 100).toFixed(1)}%"></div>
          <div class="price-bar__edge" style="left:${(Math.min(s.execPrice, s.fair) * 100).toFixed(1)}%;width:${(Math.abs(s.edge) * 100).toFixed(1)}%"></div>
        </div>
        <div class="price-bar__legend">
          <span><i class="dot dot--market"></i>You pay ${cents(s.execPrice)}</span>
          <span><i class="dot dot--fair"></i>Model fair value ${cents(s.fair)}</span>
          <span class="price-bar__edge-label">${pts(s.edge)}pts edge</span>
        </div>
      </div>

      <div class="metric-row">
        ${metric('Stake', formatCurrency(stake), '¼-Kelly')}
        ${metric('Returns', formatCurrency(stake * s.payoutMultiple), `×${s.payoutMultiple.toFixed(2)}`)}
        ${metric('Break-even', `${(s.breakEven * 100).toFixed(0)}%`, 'to not lose')}
        ${metric('Model says', `${(s.fair * 100).toFixed(0)}%`, 'chance to win')}
      </div>

      <div class="sharp-strip">
        <div class="sharp-strip__head">
          <span><strong>${s.side.traders}</strong> proven traders in</span>
          <span>${formatCurrency(s.side.capital, true)} committed</span>
          <span>${(s.unanimity * 100).toFixed(0)}% agree</span>
        </div>
        <div class="sharp-strip__entry ${s.entryAdvantage > 0 ? 'is-good' : 'is-bad'}">
          They paid <strong>${cents(s.side.avgEntry)}</strong> · you pay <strong>${cents(s.execPrice)}</strong>
          <span>${s.entryAdvantage > 0 ? `${cents(Math.abs(s.entryAdvantage))} better` : `${cents(Math.abs(s.entryAdvantage))} worse`}</span>
        </div>
        <div class="sharp-strip__names">
          ${s.side.holdings
            .slice()
            .sort((a, b) => b.initialValue - a.initialValue)
            .slice(0, 6)
            .map(
              (h) => `<span class="sharp-pill" title="${esc(h.trader.name)} · ${formatCurrency(h.initialValue)} in at ${cents(h.avgPrice)}">
                ${esc(shortName(h.trader.name))}
                <code>${formatCurrency(h.initialValue, true)}</code>
              </span>`
            )
            .join('')}
        </div>
      </div>

      <details class="signal-card__why">
        <summary>Why this passed</summary>
        <ul>${s.reasons.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        <p class="why-meta">
          Liquidity ${formatCurrency(s.market.liquidity, true)} ·
          spread ${(s.market.spread * 100).toFixed(1)}¢ ·
          ${s.market.endDate ? esc(formatTimeLeft(s.market.endDate)) : 'no end date'}
        </p>
      </details>

      <a class="signal-card__cta" href="${esc(s.market.url)}" target="_blank" rel="noopener noreferrer">
        Open on Polymarket →
      </a>
    </article>`;
}

function metric(label, value, hint) {
  return `
    <div class="metric">
      <span class="metric__value">${value}</span>
      <span class="metric__label">${label}</span>
      ${hint ? `<span class="metric__hint">${hint}</span>` : ''}
    </div>`;
}

function shortName(name) {
  if (!name) return 'anon';
  if (name.startsWith('0x')) return `${name.slice(0, 6)}…`;
  return name.length > 16 ? `${name.slice(0, 15)}…` : name;
}

/* --------------------------------------------------------------- arb view */

function arbView(result, bankroll) {
  const arbs = result.arbitrage;

  if (!arbs.length) {
    return `
      <div class="empty-state">
        <h3 class="empty-state__title">No coherence gaps open right now</h3>
        <p class="empty-state__message">
          These close fast — bots watch for them constantly. Rescan later.
        </p>
      </div>`;
  }

  return `
    <div class="arb-explainer">
      <strong>These are arithmetic, not forecasts.</strong>
      In a one-winner event, exactly one outcome pays $1. When every outcome can be bought for less than
      $1 in total, the payout is certain regardless of who wins. The catch is never the maths — it is
      execution: every leg must fill, and slow-resolving events tie your capital up, which is why these
      are ranked by <em>annualized</em> return rather than headline profit.
    </div>
    <div class="arb-list">
      ${arbs.map((a) => arbCard(a, bankroll)).join('')}
    </div>`;
}

function arbCard(a, bankroll) {
  const plan = buildArbPlan(a, Math.min(bankroll, a.maxSize || bankroll));
  const annual = a.annualizedPct;
  const weak = annual != null && annual < 5;

  return `
    <article class="arb-card animate-scale-in ${weak ? 'is-weak' : ''}">
      <header class="arb-card__head">
        <div>
          <h3 class="arb-card__title">
            <a href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">${esc(a.title)}</a>
          </h3>
          <p class="arb-card__sub">${a.legCount} outcomes · ${a.days ? `${Math.round(a.days)} days to resolution` : 'no end date'}</p>
        </div>
        <div class="arb-card__returns">
          <span class="arb-card__profit">+${a.profitPct.toFixed(2)}%</span>
          <span class="arb-card__annual">${annual != null ? `${annual.toFixed(1)}% / year` : 'unknown horizon'}</span>
        </div>
      </header>

      <div class="arb-math">
        <span>Buy all ${a.legCount} outcomes for <strong>$${a.sumAsk.toFixed(4)}</strong></span>
        <span class="arb-math__arrow">→</span>
        <span>collect <strong>$1.0000</strong> guaranteed</span>
      </div>

      ${
        weak
          ? `<p class="arb-card__weak-note">
              Headline profit looks good, but spread over ${Math.round(a.days)} days it annualizes to
              ${annual.toFixed(1)}% — comparable to leaving the money in a savings account, with far more
              execution risk. Included for completeness, not as a recommendation.
             </p>`
          : ''
      }

      <div class="metric-row">
        ${metric('Cost per $1', `$${a.sumAsk.toFixed(4)}`, 'all legs')}
        ${metric('Thinnest leg', formatCurrency(a.minLegLiquidity, true), 'depth')}
        ${metric('Practical max', formatCurrency(a.maxSize, true), 'suggested cap')}
        ${metric('On ' + formatCurrency(plan.budget, true), formatCurrency(plan.profit), 'locked profit')}
      </div>

      <details class="arb-card__legs">
        <summary>All ${a.legCount} legs and what each costs</summary>
        <div class="leg-table">
          ${a.legs
            .slice()
            .sort((x, y) => y.ask - x.ask)
            .map(
              (l) => `
              <div class="leg-row ${l.liquidity < 500 ? 'is-thin' : ''}">
                <span class="leg-row__name">${esc(l.title)}</span>
                <span class="leg-row__ask">${cents(l.ask)}</span>
                <span class="leg-row__liq">${formatCurrency(l.liquidity, true)}</span>
              </div>`
            )
            .join('')}
        </div>
      </details>

      <ul class="arb-card__warnings">
        ${a.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}
      </ul>

      <a class="signal-card__cta" href="${esc(a.url)}" target="_blank" rel="noopener noreferrer">
        Open event on Polymarket →
      </a>
    </article>`;
}

/* ------------------------------------------------------- watch / traps view */

function watchView(result) {
  const list = result.watchlist;
  if (!list.length) {
    return `<div class="empty-state"><p class="empty-state__message">Nothing on the watchlist this scan.</p></div>`;
  }

  return `
    <div class="arb-explainer">
      Positive edge, but short of the bar on size, breadth or margin. Not actionable on their own —
      worth watching in case the price drifts further in your favour.
    </div>
    <div class="watch-list">
      ${list
        .map(
          (s) => `
        <div class="watch-row">
          <div class="watch-row__main">
            <a href="${esc(s.market.url)}" target="_blank" rel="noopener noreferrer">${esc(s.market.title)}</a>
            <span class="watch-row__pick">${esc(s.outcome)} at ${cents(s.execPrice)}</span>
          </div>
          <div class="watch-row__nums">
            <span>${pts(s.edge)}pts</span>
            <span>${pct(s.evPct)}</span>
            <span>${s.side.traders} in</span>
          </div>
          <div class="watch-row__gap">${esc(s.failures[0] || '')}</div>
        </div>`
        )
        .join('')}
    </div>`;
}

function trapsView(result) {
  const list = result.traps;
  if (!list.length) {
    return `<div class="empty-state"><p class="empty-state__message">No falling-knife traps detected this scan.</p></div>`;
  }

  return `
    <div class="arb-explainer arb-explainer--warn">
      <strong>These look like the best bargains on the board. They are the most dangerous bets here.</strong>
      In each one, proven traders are holding at a price far above today's — so a naive screen reports a
      huge "discount" against what they paid. In reality the market has repriced on information that
      arrived after they bought, and their position is deep underwater. An old entry price is not a
      discount; it is a stale quote from before the world changed.
    </div>
    <div class="watch-list">
      ${list
        .map(
          (s) => `
        <div class="watch-row watch-row--trap">
          <div class="watch-row__main">
            <a href="${esc(s.market.url)}" target="_blank" rel="noopener noreferrer">${esc(s.market.title)}</a>
            <span class="watch-row__pick">${esc(s.outcome)} — they paid ${cents(s.side.avgEntry)}, now ${cents(s.market.price)}</span>
          </div>
          <div class="watch-row__nums">
            <span class="text-danger">${s.side.avgPnlPct.toFixed(0)}%</span>
            <span>${s.side.traders} in</span>
          </div>
          <div class="watch-row__gap">Looks ${cents(Math.abs(s.entryAdvantage))} cheap — actually a thesis that is breaking down.</div>
        </div>`
        )
        .join('')}
    </div>`;
}

/* ------------------------------------------------------------ ledger view */

function ledgerView(s) {
  if (!s.total) {
    return `
      <div class="empty-state">
        <h3 class="empty-state__title">Nothing tracked yet</h3>
        <p class="empty-state__message">
          Each bet gets stamped here the first time it appears, at the price available then. That stamp is
          never rewritten, so the record cannot flatter itself later.
        </p>
      </div>`;
  }

  const rows = s.entries.slice(0, 60);

  return `
    ${
      s.buckets.length
        ? `<div class="calibration">
            <h4 class="calibration__title">Calibration — does "60%" actually mean 60%?</h4>
            <div class="calibration__bars">
              ${s.buckets
                .map(
                  (b) => `
                <div class="cal-row">
                  <span class="cal-row__label">${b.label}</span>
                  <div class="cal-row__track">
                    <div class="cal-row__pred" style="width:${(b.predicted * 100).toFixed(0)}%"></div>
                    <div class="cal-row__act" style="width:${(b.actual * 100).toFixed(0)}%"></div>
                  </div>
                  <span class="cal-row__nums">${(b.predicted * 100).toFixed(0)}% said · ${(b.actual * 100).toFixed(0)}% real · n=${b.n}</span>
                </div>`
                )
                .join('')}
            </div>
            <p class="calibration__note">
              A well-calibrated model has these two bars roughly equal in every band. Predicted above actual
              means it is overconfident.
            </p>
          </div>`
        : ''
    }
    <div class="ledger-table">
      <div class="ledger-row ledger-row--head">
        <span>Bet</span><span>Called at</span><span>Now</span><span>Edge</span><span>Status</span>
      </div>
      ${rows
        .map(
          (e) => `
        <div class="ledger-row">
          <span class="ledger-row__title">
            <a href="${esc(e.url)}" target="_blank" rel="noopener noreferrer">${esc(e.title)}</a>
            <em>${esc(e.outcome)}</em>
          </span>
          <span>${cents(e.entryPrice)}</span>
          <span>${cents(e.lastPrice)}</span>
          <span class="${e.lastPrice >= e.marketPrice ? 'text-success' : 'text-danger'}">${pts(e.lastPrice - e.marketPrice)}</span>
          <span class="ledger-status ledger-status--${e.status}">${e.status}</span>
        </div>`
        )
        .join('')}
    </div>`;
}
