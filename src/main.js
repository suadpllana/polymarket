import './style.css';

const TZ = 'Europe/Belgrade';
const LOG_KEY = 'dailyParlay.log.v1';
const AMOUNT_KEY = 'dailyParlay.amount';

// ---------- storage (every access guarded: private mode can throw) ----------

function readLog() {
  try {
    return JSON.parse(localStorage.getItem(LOG_KEY)) || {};
  } catch {
    return {};
  }
}

function writeLog(log) {
  try {
    localStorage.setItem(LOG_KEY, JSON.stringify(log));
  } catch {
    /* storage unavailable: the page still works from the server copy */
  }
}

function readAmount() {
  try {
    return Number(localStorage.getItem(AMOUNT_KEY)) || 10;
  } catch {
    return 10;
  }
}

function writeAmount(value) {
  try {
    localStorage.setItem(AMOUNT_KEY, String(value));
  } catch {
    /* ignore */
  }
}

/**
 * Server entries carry results; the local log keeps every slip this browser
 * has seen, even if the server copy is ever reset.
 */
function mergeIntoLog(serverEntries) {
  const log = readLog();
  for (const entry of serverEntries) {
    log[entry.date] = entry;
  }
  writeLog(log);
  return Object.values(log).sort((a, b) => b.date.localeCompare(a.date));
}

// ---------- formatting ----------

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function localDate(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(date);
}

function timeLabel(iso) {
  const d = new Date(iso);
  const day = localDate(d) === localDate() ? 'Today' : new Intl.DateTimeFormat('en-GB', { timeZone: TZ, weekday: 'short' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(d);
  return `${day} ${time}`;
}

function dateLabel(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(
    new Date(Date.UTC(y, m - 1, d))
  );
}

const odds = (x) => Number(x).toFixed(2);
const pct = (x) => `${Math.round(x * 100)}%`;
const units = (x) => `${x > 0 ? '+' : ''}${x.toFixed(2)}u`;

const SPORT_ICON = {
  football: '⚽',
  cs2: '🎯',
  basketball: '🏀',
  american_football: '🏈',
  ice_hockey: '🏒',
  baseball: '⚾',
  tennis: '🎾',
  mma: '🥊',
  esports_other: '🎮',
};

const RESULT_ICON = { won: '✓', lost: '✕', void: '–' };

function stakeChip(entry) {
  if (entry.grade === 'NO_BET') return '<span class="chip chip--muted">No bet</span>';
  if (!entry.stake_units) return '<span class="chip chip--muted">Skip today</span>';
  const label = entry.stake_units === 1 ? 'Bet 1 unit' : 'Bet ½ unit';
  return `<span class="chip ${entry.stake_units === 1 ? 'chip--green' : 'chip--amber'}">${label}</span>`;
}

function resultChip(entry) {
  if (entry.grade === 'NO_BET') return '<span class="chip chip--muted">No bet</span>';
  if (entry.parlay_result === 'won') return '<span class="chip chip--green">Won</span>';
  if (entry.parlay_result === 'lost') return '<span class="chip chip--red">Lost</span>';
  if (entry.parlay_result === 'void') return '<span class="chip chip--muted">Void</span>';
  return '<span class="chip chip--blue">Pending</span>';
}

// ---------- bet slip ----------

function legHtml(leg) {
  const result = leg.result ? `<span class="leg__result leg__result--${leg.result}">${RESULT_ICON[leg.result]}</span>` : '';
  return `
    <div class="leg">
      <div class="leg__meta">
        <span>${SPORT_ICON[leg.sport] || '•'} ${esc(leg.league)}</span>
        <span>${esc(timeLabel(leg.start))}</span>
      </div>
      <div class="leg__event">${esc(leg.event)}</div>
      <div class="leg__row">
        <div>
          <div class="leg__pick">${esc(leg.selection)}</div>
          <div class="leg__market">${esc(leg.label)}</div>
        </div>
        <div class="leg__right">
          ${result}
          <div class="leg__price">
            <span class="leg__odds">${odds(leg.odds)}</span>
            <span class="leg__book">${leg.book ? esc(leg.book) : 'est.'}</span>
          </div>
        </div>
      </div>
      ${leg.reason ? `<div class="leg__why">${esc(leg.reason)}</div>` : ''}
    </div>`;
}

function slipText(entry) {
  const lines = entry.legs.map((l) => `${l.event} — ${l.selection} (${l.label}) @ ${odds(l.odds)}${l.book ? ` on ${l.book}` : ''}`);
  return `Daily parlay ${entry.date}\n${lines.join('\n')}\nTotal odds ${odds(entry.combined_odds)}`;
}

function renderSlip(entry, updatedAt) {
  const el = document.getElementById('slip');

  if (!entry) {
    el.innerHTML = `
      <div class="slip__head"><span>Bet Slip</span></div>
      <div class="empty">
        <div class="empty__title">Today’s parlay isn’t out yet</div>
        <p>A new slip is built every morning around 08:00–10:00 Belgrade time.</p>
        ${updatedAt ? `<p class="muted">Last update ${esc(timeLabel(updatedAt))}</p>` : ''}
      </div>`;
    return;
  }

  if (entry.grade === 'NO_BET') {
    el.innerHTML = `
      <div class="slip__head"><span>Bet Slip</span>${stakeChip(entry)}</div>
      <div class="empty">
        <div class="empty__title">No bet today</div>
        <p>${esc(entry.no_bet_reason || 'Nothing passed the rules today.')}</p>
        <p class="muted">Skipping is part of the plan — a bad slip costs more than a missed day.</p>
      </div>`;
    return;
  }

  const amount = readAmount();
  const p = entry.est_hit_prob;
  el.innerHTML = `
    <div class="slip__head">
      <span>Bet Slip <span class="count">${entry.legs.length}</span></span>
      ${stakeChip(entry)}
    </div>
    <div class="legs">${entry.legs.map(legHtml).join('')}</div>
    <div class="slip__foot">
      <div class="line"><span>Total Odds</span><strong>${odds(entry.combined_odds)}</strong></div>
      <label class="amount">
        <span>Amount</span>
        <input id="amount" type="number" min="0" step="1" inputmode="decimal" value="${amount}" />
      </label>
      <div class="line"><span>Est. Payout</span><strong id="payout">${(amount * entry.combined_odds).toFixed(2)}</strong></div>
      <div class="line line--small"><span>Win chance</span><span>${pct(p)} · about 1 in ${(1 / p).toFixed(1)}</span></div>
      <div class="line line--small"><span>Place before</span><span>${esc(timeLabel(entry.place_before))}</span></div>
      <button id="copy" class="btn">Copy bet</button>
      <p class="note">${entry.mode === 'research' ? 'Researched this morning.' : 'Market prices only — today’s research didn’t arrive in time.'} Odds with a site name were checked there; “est.” odds are fair prices, and your site will usually pay a little less.</p>
    </div>`;

  const input = document.getElementById('amount');
  input.addEventListener('input', () => {
    const value = Math.max(0, Number(input.value) || 0);
    writeAmount(value);
    document.getElementById('payout').textContent = (value * entry.combined_odds).toFixed(2);
  });

  const button = document.getElementById('copy');
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(slipText(entry));
      button.textContent = 'Copied';
    } catch {
      button.textContent = 'Copy failed';
    }
    setTimeout(() => (button.textContent = 'Copy bet'), 1500);
  });
}

// ---------- log ----------

function summary(entries) {
  const bets = entries.filter((e) => e.grade !== 'NO_BET' && e.stake_units > 0);
  const settled = bets.filter((e) => e.parlay_result === 'won' || e.parlay_result === 'lost');
  const won = settled.filter((e) => e.parlay_result === 'won');
  const pl = settled.reduce(
    (sum, e) => sum + (e.parlay_result === 'won' ? e.stake_units * ((e.settled_odds || e.combined_odds) - 1) : -e.stake_units),
    0
  );
  const predicted = settled.length ? settled.reduce((s, e) => s + e.est_hit_prob, 0) / settled.length : 0;
  return { played: settled.length, won: won.length, pl, predicted };
}

function renderLog(entries) {
  const el = document.getElementById('log');
  const past = entries.filter((e) => e.date !== localDate());
  if (!entries.length) {
    el.innerHTML = '';
    return;
  }
  const s = summary(entries);
  el.innerHTML = `
    <h2 class="log__title">History</h2>
    <div class="stats">
      <div><span>Won</span><strong>${s.won}/${s.played}</strong></div>
      <div><span>Hit rate</span><strong>${s.played ? pct(s.won / s.played) : '—'}</strong></div>
      <div><span>Expected</span><strong>${s.played ? pct(s.predicted) : '—'}</strong></div>
      <div><span>Profit</span><strong class="${s.pl >= 0 ? 'pos' : 'neg'}">${s.played ? units(s.pl) : '—'}</strong></div>
    </div>
    ${past.length ? '' : '<p class="muted">Past slips will show up here, with whether they hit.</p>'}
    <div class="days">
      ${past
        .map(
          (e) => `
        <details class="day">
          <summary>
            <span class="day__date">${esc(dateLabel(e.date))}</span>
            <span class="day__info">${e.legs.length ? `${e.legs.length} legs · ${odds(e.combined_odds)}` : ''}</span>
            ${resultChip(e)}
          </summary>
          ${
            e.legs.length
              ? e.legs
                  .map(
                    (l) => `
            <div class="day__leg">
              <span class="leg__result leg__result--${l.result || 'open'}">${RESULT_ICON[l.result] || '•'}</span>
              <span class="day__pick">${esc(l.selection)} <span class="muted">· ${esc(l.event)}</span></span>
              <span>${odds(l.odds)}</span>
            </div>`
                  )
                  .join('')
              : `<p class="muted day__none">${esc(e.no_bet_reason || '')}</p>`
          }
        </details>`
        )
        .join('')}
    </div>
    <p class="muted small">Judge this on months, not days: about 1 in 5 slips at these odds is expected to hit.</p>`;
}

// ---------- boot ----------

async function boot() {
  document.getElementById('today').textContent = dateLabel(localDate());

  let server = { entries: [], updated_at: null };
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}history.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) server = await res.json();
  } catch {
    /* offline: fall back to the local log */
  }

  const entries = mergeIntoLog(Array.isArray(server.entries) ? server.entries : []);
  const today = entries.find((e) => e.date === localDate());
  renderSlip(today, server.updated_at);
  renderLog(entries);
}

boot();
