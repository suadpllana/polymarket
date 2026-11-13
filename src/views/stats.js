import { computeStats, SPORTS } from '../lib/stats.js';
import { lineChart } from '../ui/charts.js';
import { addDays, esc, localDate, money, pct, signedPct } from '../ui/format.js';

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

export function renderStats(root, ctx) {
  const today = localDate();
  const bets = period === 'all' ? ctx.bets : ctx.bets.filter((b) => b.date > addDays(today, -Number(period)));
  root.innerHTML = `
    <section class="page-head">
      <h1>Stats</h1>
      <p class="muted">How your own bets are doing.</p>
    </section>
    <section class="filters">
      <div class="chips" role="group" aria-label="Period">${PERIODS.map(([v, l]) => `<button type="button" class="chip${period === v ? ' chip--on' : ''}" data-p="${v}" aria-pressed="${period === v}">${l}</button>`).join('')}</div>
    </section>
    <div class="stats-body"></div>`;
  root.querySelectorAll('[data-p]').forEach((b) =>
    b.addEventListener('click', () => {
      period = b.dataset.p;
      renderStats(root, ctx);
    })
  );
  const body = root.querySelector('.stats-body');
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
