import { computeStats, SPORTS } from '../lib/stats.js';
import { lineChart } from '../ui/charts.js';
import { addDays, dayLabel, esc, localDate, money, pct, signedPct } from '../ui/format.js';

const PERIODS = [
  ['all', 'All time'],
  ['30', 'Last 30 days'],
  ['7', 'Last 7 days'],
];
let period = 'all';

const tone = (x) => (x > 0 ? 'good' : x < 0 ? 'bad' : '');

function tile(label, value, cls = '', note = '') {
  return `<div class="tile"><span class="tile__label">${esc(label)}</span><strong class="tile__value ${cls}">${value}</strong>${note ? `<span class="tile__note">${note}</span>` : ''}</div>`;
}

/** One row per group: how many bets, how they went, and the profit. */
function breakdown(title, rows) {
  const shown = rows.filter((r) => r.count);
  return `<div class="card">
    <h2>${esc(title)}</h2>
    <table class="table table--compact simple">
      <thead><tr><th scope="col"></th><th scope="col">Bets</th><th scope="col">Won</th><th scope="col">Profit</th></tr></thead>
      <tbody>${shown
        .map((r) => `<tr><th scope="row">${esc(r.label)}</th><td>${r.count}</td><td>${r.winRate === null ? '–' : pct(r.winRate)}</td><td class="${tone(r.profit)}"><strong>${money(r.profit, { sign: true })}</strong></td></tr>`)
        .join('')}</tbody>
    </table>
  </div>`;
}

const PICK_LABEL = { 'Win (1x2)': 'Team to win', 'Win (2-up)': 'Team to win (2-up)', 'Goals over/under': 'Goals over / under', 'Other sports': 'Tennis, basketball, NFL winner' };

/** Won and lost picks per row, with a small bar showing the split. */
function recordList(title, sub, rows) {
  return `<div class="card">
    <h2>${esc(title)}</h2>
    <p class="card__sub">${esc(sub)}</p>
    ${
      rows.length
        ? `<ul class="rec">${rows
            .map((r) => {
              const share = r.won / (r.won + r.lost);
              return `<li class="rec__row"><span class="rec__name">${esc(PICK_LABEL[r.label] || r.label)}</span><span class="rec__bar" aria-hidden="true"><span style="width:${share * 100}%"></span></span><span class="rec__score"><strong class="good">${r.won}</strong> won · <strong class="${r.lost ? 'bad' : ''}">${r.lost}</strong> lost</span></li>`;
            })
            .join('')}</ul>`
        : '<p class="muted small">Not enough bets yet.</p>'
    }
  </div>`;
}

/** Up to three plain sentences: the best group, the worst group, and cash-outs. */
function takeaways(s) {
  const groups = [...SPORTS.map((k) => s.bySport[k]), ...s.byLegs].filter((g) => g.count >= 3);
  const out = [];
  const best = [...groups].sort((a, b) => b.profit - a.profit)[0];
  const worst = [...groups].sort((a, b) => a.profit - b.profit)[0];
  if (best && best.profit > 0) out.push(['good', `Your best: ${best.label.toLowerCase()}, ${money(best.profit, { sign: true })} from ${best.count} bets.`]);
  if (worst && worst.profit < 0 && worst !== best) out.push(['bad', `Your worst: ${worst.label.toLowerCase()}, ${money(worst.profit, { sign: true })} from ${worst.count} bets.`]);
  if (s.cash.costYou > 0) out.push(['bad', `Cashing out early cost you ${money(s.cash.costYou)}: ${s.cash.wouldHaveWon} of those bets would have won.`]);
  return out;
}

// --- Research record ---------------------------------------------------------
// Every game the daily research looked at (research-record.json, written by
// scripts/daily.mjs), its final rating and whether the market favourite won.

let record = null;
let recordRequest = null;

function loadRecord() {
  if (!recordRequest) {
    recordRequest = fetch(`${import.meta.env.BASE_URL}research-record.json?t=${Date.now()}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((r) => (record = r));
  }
  return recordRequest;
}

const RATINGS = [
  ['high', 'High'],
  ['medium', 'Medium'],
  ['low', 'Low'],
  ['excluded', 'Excluded'],
];

const MARK = {
  fav_won: ['good', '✓', 'Favourite won'],
  fav_lost: ['bad', '✕', 'Favourite lost'],
  draw: ['', '=', 'Draw'],
  not_played: ['muted', '–', 'Not played'],
};

const settled = (g) => g.result === 'fav_won' || g.result === 'fav_lost' || g.result === 'draw';

function tally(games) {
  const done = games.filter(settled);
  const won = done.filter((g) => g.result === 'fav_won').length;
  return {
    n: done.length,
    won,
    draw: done.filter((g) => g.result === 'draw').length,
    lost: done.filter((g) => g.result === 'fav_lost').length,
    expected: done.length ? done.reduce((a, g) => a + g.fav_p, 0) / done.length : null,
  };
}

function favouriteText(g) {
  if (!g.result) return 'Open';
  const [, icon, label] = MARK[g.result] || ['', '', g.result];
  const who = g.result === 'fav_lost' && g.winner ? ` (${g.winner} won)` : '';
  return `${icon} ${label}${who}`;
}

const LEG_RESULT = {
  won: ['good', '✓ Won', 'would have won'],
  lost: ['bad', '✕ Lost', 'would have lost'],
  void: ['muted', '– Refunded', 'would have been refunded'],
};

/** What was bet on the game and how it did; for a game not bet, how the favourite did. */
function betCell(g) {
  const bets = g.bets || [];
  if (!bets.length) return `<span class="muted">Not bet</span><div class="muted small">${esc(favouriteText(g))}</div>`;
  return bets
    .map((b) => {
      const [cls, finalText, draftText] = LEG_RESULT[b.result] || ['muted', 'Open', 'still open'];
      const leg = `<strong>${esc(b.selection)}</strong> <span class="muted small">${esc(b.label)} · ${Number(b.odds).toFixed(2)}</span>`;
      return b.final
        ? `<div class="rg-bet">${leg}<div class="${cls}">${finalText}</div></div>`
        : `<div class="rg-bet rg-bet--dropped"><span class="muted small">Dropped at a check:</span> ${leg}<div class="${cls} small">${draftText}</div></div>`;
    })
    .join('');
}

/** The day's slip result, from its final legs. */
function slipBadge(r, day) {
  const legs = r.games.filter((g) => g.date === day).flatMap((g) => (g.bets || []).filter((b) => b.final));
  if (!legs.length) return '<span class="muted">no slip</span>';
  if (legs.some((b) => b.result === 'lost')) return '<span class="badge badge--lost">✕ Slip lost</span>';
  if (legs.some((b) => !b.result)) return '<span class="badge badge--open">Slip open</span>';
  return '<span class="badge badge--won">✓ Slip won</span>';
}

function recordHtml(r) {
  if (!r?.games?.length) return '<section class="card"><h2>Research record</h2><p class="muted small">The record appears after the next site build.</p></section>';
  const all = tally(r.games);
  const legs = r.legs || { won: 0, void: 0, lost: 0 };
  const dropped = r.dropped || { won: 0, void: 0, lost: 0 };
  const droppedN = dropped.won + dropped.lost + dropped.void;
  const days = [...new Set(r.games.map((g) => g.date))].sort().reverse();
  const rows = RATINGS.map(([k, label]) => [label, k, tally(r.games.filter((g) => g.rating === k))]).filter(([, , t]) => t.n);
  return `<section class="card record-card">
    <h2>Research record</h2>
    <p class="card__sub">Every game the daily research looked at since ${esc(dayLabel(r.start))}, and whether the market favourite won. Ratings are the final ones, after the last check. This is the research, not your bets.</p>
    <div class="tiles tiles--simple record-tiles">
      ${tile('Favourites won', all.n ? `${all.won} of ${all.n}` : '–', '', all.n ? `${pct(all.won / all.n)} · the market expected ${pct(all.expected)}` : '')}
      ${tile('Slip legs', `${legs.won} won`, '', `${legs.void} refunded · ${legs.lost} lost`)}
      ${droppedN ? tile('Dropped at a check', `${dropped.lost} would have lost`, '', `${dropped.won} would have won${dropped.void ? ` · ${dropped.void} refunded` : ''}`) : ''}
    </div>
    <div class="table-wrap">
      <table class="table table--compact simple">
        <thead><tr><th scope="col" class="rt-first">Rating</th><th scope="col">Games</th><th scope="col">Fav. won</th><th scope="col">Draw</th><th scope="col">Lost</th><th scope="col">Market</th></tr></thead>
        <tbody>${rows
          .map(([label, k, t]) => `<tr><th scope="row"><span class="conf conf--${k === 'excluded' ? 'market' : k}">${esc(label)}</span></th><td>${t.n}</td><td><strong>${t.won}</strong> <span class="muted">(${pct(t.won / t.n)})</span></td><td>${t.draw}</td><td class="${t.lost ? 'bad' : ''}">${t.lost}</td><td class="muted">${pct(t.expected)}</td></tr>`)
          .join('')}</tbody>
      </table>
    </div>
    <p class="muted small">“Market” is the favourite’s average market chance in that group, so it shows whether the group did better or worse than its odds. “Low” is not a prediction that the favourite loses: it means too much could not be checked to stake money on it. Excluded games break a hard rule (derby, nothing to play for, rotation and so on).</p>
    <div class="record-days">${days
      .map((d, i) => {
        const games = r.games.filter((g) => g.date === d);
        const t = tally(games);
        const open = games.filter((g) => !g.result).length;
        return `<details class="record-day"${i === 0 ? ' open' : ''}>
          <summary><strong>${esc(dayLabel(d))}</strong>${slipBadge(r, d)}<span class="muted">${t.n ? `favourites ${t.won} of ${t.n}` : ''}${open ? `${t.n ? ' · ' : ''}${open} open` : ''}</span></summary>
          <div class="table-wrap"><table class="table table--compact record-games">
            <thead><tr><th scope="col">Game</th><th scope="col">Rating</th><th scope="col">The bet</th></tr></thead>
            <tbody>${games
              .map((g) => `<tr><td class="rg-event">${g.on_slip ? '<span class="record-star" title="On that day’s slip">★</span> ' : ''}${esc(g.event)}<div class="muted small">Favourite: ${esc(g.favourite)} ${pct(g.fav_p)}</div></td><td><span class="conf conf--${g.rating === 'excluded' ? 'market' : esc(g.rating)}">${esc(g.rating)}</span></td><td class="rg-result">${betCell(g)}</td></tr>`)
              .join('')}</tbody>
          </table></div>
        </details>`;
      })
      .join('')}</div>
    <p class="muted small">★ = on that day’s final slip. “Dropped at a check” is a leg that was on the site earlier that day (the draft before the final check) and was taken off; it shows how that leg would have done. Drafts are recorded from 13 Nov.</p>
  </section>`;
}

function fillRecord(el) {
  if (!el) return;
  if (record) {
    el.innerHTML = recordHtml(record);
    return;
  }
  el.innerHTML = '<section class="card"><h2>Research record</h2><p class="muted small">Loading…</p></section>';
  loadRecord().then(() => {
    if (el.isConnected) el.innerHTML = recordHtml(record);
  });
}

export function renderStats(root, ctx) {
  const today = localDate();
  const bets = period === 'all' ? ctx.bets : ctx.bets.filter((b) => b.date > addDays(today, -Number(period)));
  root.innerHTML = `
    <section class="page-head">
      <h1>Stats</h1>
      <p class="muted">How your own bets are doing, and below, how the daily research has done.</p>
    </section>
    <section class="filters">
      <div class="chips" role="group" aria-label="Period">${PERIODS.map(([v, l]) => `<button type="button" class="chip${period === v ? ' chip--on' : ''}" data-p="${v}" aria-pressed="${period === v}">${l}</button>`).join('')}</div>
    </section>
    <div class="stats-body"></div>
    <div class="record-body"></div>`;
  root.querySelectorAll('[data-p]').forEach((b) =>
    b.addEventListener('click', () => {
      period = b.dataset.p;
      renderStats(root, ctx);
    })
  );
  const body = root.querySelector('.stats-body');
  fillRecord(root.querySelector('.record-body'));
  if (!bets.length) {
    body.innerHTML = '<p class="empty">No bets in this period.</p>';
    return;
  }

  const s = computeStats(bets);
  const t = s.total;
  const notes = takeaways(s);

  body.innerHTML = `
    <section class="tiles tiles--simple">
      <div class="tile tile--hero"><span class="tile__label">Profit</span><strong class="tile__value ${tone(t.profit)}">${money(t.profit, { sign: true })}</strong><span class="tile__note">${signedPct(t.roi)} on ${money(t.staked)} staked</span></div>
      ${tile('Bets', String(t.count), '', `${t.won} won · ${t.lost} lost${t.cashed ? ` · ${t.cashed} cashed out` : ''}`)}
      ${tile('Win rate', pct(t.winRate))}
    </section>

    ${notes.length ? `<section class="card"><ul class="insights">${notes.map(([k, text]) => `<li class="insight insight--${k}"><span aria-hidden="true">${k === 'good' ? '▲' : '▼'}</span><span>${esc(text)}</span></li>`).join('')}</ul></section>` : ''}

    <section class="card">
      <h2>Profit over time</h2>
      <div class="chart-box" id="c-time"></div>
    </section>

    <section class="grid-2">
      ${breakdown('By sport', SPORTS.map((k) => s.bySport[k]))}
      ${breakdown('By number of legs', s.byLegs)}
    </section>

    <section class="grid-2">
      ${recordList('Teams you predicted best', 'Picks on that team or player, across all your bets.', s.bestTeams)}
      ${recordList('Teams that let you down', 'Most lost picks first. Correct-score picks count for the team they had winning.', s.worstTeams)}
    </section>

    <section class="grid-2">
      ${recordList('Your picks by type', 'How often each kind of pick landed.', s.pickTypes)}
    </section>`;

  // Running profit, one point per day from the first bet to the last.
  const first = s.timeline[0].date;
  const last = s.timeline[s.timeline.length - 1].date;
  const byDate = new Map(s.timeline.map((d) => [d.date, d.profit]));
  const dates = [];
  const values = [];
  let run = 0;
  for (let d = first; d <= last; d = addDays(d, 1)) {
    dates.push(d);
    values.push((run += byDate.get(d) || 0));
  }
  lineChart(body.querySelector('#c-time'), { dates, series: [{ key: 'profit', label: 'Profit', color: '#3987e5', values }] });
}
