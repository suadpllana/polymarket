import { computeStats, insights, SPORT_LABEL } from '../lib/stats.js';
import { divergingBars, lineChart, meterHtml, segmentedBar } from '../ui/charts.js';
import { addDays, dayLabel, esc, localDate, money, odds, pct, signedPct } from '../ui/format.js';

// Validated categorical slots 1-3 (dark steps) on the panel surface #1a2c38.
export const SPORT_COLOR = { football: '#3987e5', cs2: '#d95926', mixed: '#199e70' };
const PERIODS = [
  ['all', 'All time'],
  ['7', 'Last 7 days'],
  ['14', 'Last 14 days'],
  ['30', 'Last 30 days'],
];
let period = 'all';

function tile(label, value, cls = '', note = '') {
  return `<div class="tile"><span class="tile__label">${esc(label)}</span><strong class="tile__value ${cls}">${value}</strong>${note ? `<span class="tile__note">${note}</span>` : ''}</div>`;
}

const tone = (x) => (x > 0 ? 'good' : x < 0 ? 'bad' : '');

function bucketRows(rows) {
  return rows
    .filter((r) => r.count)
    .map(
      (r) => `<tr><th scope="row">${esc(r.label)}</th><td>${r.count}</td><td>${r.won}</td><td>${r.lost}</td><td>${r.cashed}</td><td>${r.winRate === null ? '–' : pct(r.winRate)}</td><td>${money(r.staked)}</td><td class="${tone(r.profit)}">${money(r.profit, { sign: true })}</td><td class="${tone(r.roi)}">${signedPct(r.roi)}</td></tr>`
    )
    .join('');
}

const BUCKET_HEAD = '<tr><th scope="col"></th><th scope="col">Bets</th><th scope="col">Won</th><th scope="col">Lost</th><th scope="col">Cashed out</th><th scope="col">Win rate</th><th scope="col">Staked</th><th scope="col">Profit</th><th scope="col">Return</th></tr>';

export function renderStats(root, ctx) {
  const today = localDate();
  const bets = period === 'all' ? ctx.bets : ctx.bets.filter((b) => b.date > addDays(today, -Number(period)));
  root.innerHTML = `
    <section class="page-head">
      <h1>Stats</h1>
      <p class="muted">Every number comes from your settled Stake bets. Win rate counts won and lost bets; cash-outs are shown on their own.</p>
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
  const sportsPresent = ['football', 'cs2', 'mixed'].filter((k) => s.bySport[k].count);

  body.innerHTML = `
    <section class="tiles">
      <div class="tile tile--hero"><span class="tile__label">Profit</span><strong class="tile__value ${tone(t.profit)}">${money(t.profit, { sign: true })}</strong><span class="tile__note">${signedPct(t.roi)} return on ${money(t.staked)} staked</span></div>
      ${tile('Bets', String(t.count), '', `${t.won} won · ${t.lost} lost · ${t.cashed} cashed out`)}
      ${tile('Win rate', pct(t.winRate), '', 'won ÷ (won + lost)')}
      ${tile('Paid out', money(t.returned))}
      ${tile('Cash-outs cost you', money(-s.cash.costYou), s.cash.costYou > 0 ? 'bad' : '', `${s.cash.wouldHaveWon} would have won if held`)}
    </section>

    <section class="card">
      <h2>What the numbers say</h2>
      <ul class="insights">${insights(s).map((i) => `<li class="insight insight--${i.tone}"><span aria-hidden="true">${i.tone === 'good' ? '▲' : '▼'}</span><span>${esc(i.text)}</span></li>`).join('')}</ul>
    </section>

    <section class="grid-2">
      <div class="card">
        <h2>Profit by sport</h2>
        <p class="card__sub">Football-only, CS2-only and mixed bets.</p>
        <div class="chart-box" id="c-sport"></div>
      </div>
      <div class="card">
        <h2>What lost your bets</h2>
        <p class="card__sub">${s.lostBets} lost bets, by the sport of the leg that lost.</p>
        <div id="c-blame"></div>
        <table class="table table--compact">
          <thead><tr><th scope="col"></th><th scope="col">Lost bets</th><th scope="col">Share</th><th scope="col">Stake lost</th></tr></thead>
          <tbody>${[
            ['A CS2 leg', s.blame.cs2],
            ['A football leg', s.blame.football],
            ['Both', s.blame.both],
          ]
            .filter(([, b]) => b.bets)
            .map(([l, b]) => `<tr><th scope="row">${l}</th><td>${b.bets}</td><td>${pct(b.bets / (s.lostBets || 1))}</td><td>${money(b.stake)}</td></tr>`)
            .join('')}</tbody>
        </table>
      </div>
    </section>

    <section class="card">
      <h2>Profit over time</h2>
      <p class="card__sub">Running profit for each kind of bet.</p>
      <div class="legend">${sportsPresent.map((k) => `<span class="legend__item"><span class="legend__line" style="background:${SPORT_COLOR[k]}"></span>${esc(SPORT_LABEL[k])}</span>`).join('')}</div>
      <div class="chart-box" id="c-time"></div>
      <details class="table-view"><summary>Show as table</summary>
        <table class="table table--compact"><thead><tr><th scope="col">Day</th><th scope="col">Bets</th><th scope="col">Staked</th><th scope="col">Profit</th><th scope="col">Running</th></tr></thead>
        <tbody>${s.timeline.map((d) => `<tr><th scope="row">${esc(dayLabel(d.date))}</th><td>${d.bets}</td><td>${money(d.staked)}</td><td class="${tone(d.profit)}">${money(d.profit, { sign: true })}</td><td class="${tone(d.cumulative)}">${money(d.cumulative, { sign: true })}</td></tr>`).join('')}</tbody></table>
      </details>
    </section>

    <section class="card">
      <h2>By sport</h2>
      <div class="table-wrap"><table class="table"><thead>${BUCKET_HEAD}</thead><tbody>${bucketRows(sportsPresent.map((k) => ({ label: SPORT_LABEL[k], ...s.bySport[k] })))}</tbody></table></div>
    </section>

    <section class="card">
      <h2>Legs: how often each pick type landed</h2>
      <p class="card__sub">Hit rate (bar) against what the odds said it should be (tick). Above the tick, you beat the price.</p>
      <div class="table-wrap"><table class="table">
        <thead><tr><th scope="col">Pick type</th><th scope="col">Legs</th><th scope="col">Won</th><th scope="col">Lost</th><th scope="col" class="col-meter">Hit rate</th><th scope="col">Odds said</th><th scope="col">vs odds</th></tr></thead>
        <tbody>${s.groups
          .map(
            (g) => `<tr><th scope="row"><span class="tag tag--${g.sport}">${g.sport === 'cs2' ? 'CS2' : 'Football'}</span> ${esc(g.group.replace(/^CS2 /, ''))}</th><td>${g.legs}</td><td>${g.won}</td><td>${g.lost}${g.unknown ? ` <span class="muted small">(+${g.unknown} unknown)</span>` : ''}</td><td class="col-meter">${meterHtml(g.hitRate, g.implied)} <span class="small">${pct(g.hitRate)}</span></td><td>${pct(g.implied)}</td><td class="${tone(g.edge)}">${g.edge === null ? '–' : `${g.edge > 0 ? '+' : g.edge < 0 ? '−' : ''}${Math.abs(Math.round(g.edge * 100))} pts`}</td></tr>`
          )
          .join('')}</tbody>
      </table></div>
      <p class="small muted">Football legs: ${s.legSport.football.won} of ${s.legSport.football.won + s.legSport.football.lost} landed (${pct(s.legSport.football.hitRate)}), the odds said ${pct(s.legSport.football.implied)}. CS2 legs: ${s.legSport.cs2.won} of ${s.legSport.cs2.won + s.legSport.cs2.lost} (${pct(s.legSport.cs2.hitRate)}), the odds said ${pct(s.legSport.cs2.implied)}.</p>
    </section>

    <section class="card">
      <h2>By number of legs</h2>
      <div class="table-wrap"><table class="table"><thead>${BUCKET_HEAD}</thead><tbody>${bucketRows(s.byLegs)}</tbody></table></div>
    </section>

    <section class="card">
      <h2>By total odds</h2>
      <div class="table-wrap"><table class="table"><thead>${BUCKET_HEAD}</thead><tbody>${bucketRows(s.byOdds)}</tbody></table></div>
    </section>

    ${
      s.cash.count
        ? `<section class="card">
      <h2>Cash-outs</h2>
      <p class="card__sub">You took ${money(s.cash.got)} back on ${money(s.cash.stake)} staked. Holding would have paid ${money(s.cash.costYou)} more on the winners, and lost the ${money(s.cash.savedYou)} you saved on the losers.</p>
      <div class="table-wrap"><table class="table table--compact">
        <thead><tr><th scope="col">Day</th><th scope="col">Bet</th><th scope="col">Stake</th><th scope="col">Cashed out</th><th scope="col">If held</th><th scope="col">Difference</th></tr></thead>
        <tbody>${s.cash.list
          .map(({ bet, held }) => {
            const l0 = bet.legs[0];
            const name = bet.type === 'multi' ? `${bet.legs.length} legs: ${bet.legs.map((l) => l.selection).join(', ')}` : `${l0.selection} (${l0.market}), ${l0.home} vs ${l0.away}`;
            const heldText = typeof held === 'number' ? money(held) : held === 'won_unknown_odds' ? 'Won (odds unknown)' : 'Unknown';
            const diff = typeof held === 'number' ? held - bet.payout : null;
            return `<tr><th scope="row">${esc(dayLabel(bet.date))}</th><td class="wrap">${esc(name)}</td><td>${money(bet.stake)}</td><td>${money(bet.payout)}</td><td>${heldText}</td><td class="${diff === null ? '' : diff > 0 ? 'bad' : 'good'}">${diff === null ? '–' : diff > 0 ? `Lost ${money(diff)}` : `Saved ${money(-diff)}`}</td></tr>`;
          })
          .join('')}</tbody>
      </table></div>
    </section>`
        : ''
    }

    <section class="grid-2">
      <div class="card">
        <h2>Teams you read well</h2>
        <table class="table table--compact"><thead><tr><th scope="col">Team</th><th scope="col">Won</th><th scope="col">Lost</th></tr></thead>
        <tbody>${s.bestTeams.map((x) => `<tr><th scope="row"><span class="tag tag--${x.sport}">${x.sport === 'cs2' ? 'CS2' : 'Football'}</span> ${esc(x.name)}</th><td>${x.won}</td><td>${x.lost}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">Not enough bets yet.</td></tr>'}</tbody></table>
      </div>
      <div class="card">
        <h2>Teams that let you down</h2>
        <table class="table table--compact"><thead><tr><th scope="col">Team</th><th scope="col">Won</th><th scope="col">Lost</th></tr></thead>
        <tbody>${s.worstTeams.map((x) => `<tr><th scope="row"><span class="tag tag--${x.sport}">${x.sport === 'cs2' ? 'CS2' : 'Football'}</span> ${esc(x.name)}</th><td>${x.won}</td><td>${x.lost}</td></tr>`).join('') || '<tr><td colspan="3" class="muted">None.</td></tr>'}</tbody></table>
      </div>
    </section>`;

  divergingBars(
    body.querySelector('#c-sport'),
    sportsPresent.map((k) => {
      const b = s.bySport[k];
      return {
        label: SPORT_LABEL[k],
        value: b.profit,
        color: SPORT_COLOR[k],
        tip: [
          { value: money(b.profit, { sign: true }), label: 'profit' },
          { value: `${b.won}–${b.lost}`, label: `won–lost (${b.cashed} cashed out)` },
          { value: money(b.staked), label: 'staked' },
          { value: signedPct(b.roi), label: 'return' },
        ],
      };
    })
  );

  segmentedBar(body.querySelector('#c-blame'), [
    { label: 'A CS2 leg lost', value: s.blame.cs2.bets, color: SPORT_COLOR.cs2, detail: money(s.blame.cs2.stake) },
    { label: 'A football leg lost', value: s.blame.football.bets, color: SPORT_COLOR.football, detail: money(s.blame.football.stake) },
    { label: 'Both lost', value: s.blame.both.bets, color: SPORT_COLOR.mixed, detail: money(s.blame.both.stake) },
  ]);

  // Running profit per sport, one point per day from the first bet to the last.
  const first = s.timeline[0].date;
  const last = s.timeline[s.timeline.length - 1].date;
  const dates = [];
  for (let d = first; d <= last; d = addDays(d, 1)) dates.push(d);
  const series = sportsPresent.map((k) => {
    let run = 0;
    const byDate = new Map();
    for (const b of bets) if (b.sport === k) byDate.set(b.date, (byDate.get(b.date) || 0) + b.profit);
    return { key: k, label: SPORT_LABEL[k], color: SPORT_COLOR[k], values: dates.map((d) => (run += byDate.get(d) || 0)) };
  });
  lineChart(body.querySelector('#c-time'), { dates, series });
}

export { odds };
