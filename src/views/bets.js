import { RESULT_ICON, RESULT_LABEL, dayLabel, esc, money, odds } from '../ui/format.js';
import { SPORT_LABEL } from '../lib/stats.js';

const state = { sport: 'all', result: 'all', type: 'all', q: '' };

const FILTERS = {
  sport: [['all', 'All sports'], ['football', 'Football'], ['cs2', 'CS2'], ['mixed', 'Football + CS2']],
  result: [['all', 'All results'], ['won', 'Won'], ['lost', 'Lost'], ['cashed_out', 'Cashed out']],
  type: [['all', 'Singles & multis'], ['single', 'Singles'], ['multi', 'Multis']],
};

function chips(name) {
  return `<div class="chips" role="group" aria-label="${name}">${FILTERS[name]
    .map(([v, l]) => `<button type="button" class="chip${state[name] === v ? ' chip--on' : ''}" data-f="${name}" data-v="${v}" aria-pressed="${state[name] === v}">${esc(l)}</button>`)
    .join('')}</div>`;
}

function matches(b) {
  if (state.sport !== 'all' && b.sport !== state.sport) return false;
  if (state.result !== 'all' && b.status !== state.result) return false;
  if (state.type !== 'all' && b.type !== state.type) return false;
  if (state.q) {
    const q = state.q.toLowerCase();
    const hay = b.legs.map((l) => `${l.selection} ${l.home} ${l.away} ${l.market}`).join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function legHtml(l, mixed) {
  const r = l.result || 'unknown';
  const score = l.score ? `${l.score[0]}–${l.score[1]}` : 'vs';
  const why = l.note ? `<div class="leg__note">${esc(l.note)}</div>` : '';
  return `<li class="leg">
    <span class="leg__dot leg__dot--${r}" title="${esc(r === 'unknown' ? 'Result not known from the score' : RESULT_LABEL[r] || r)}">${r === 'unknown' ? '?' : RESULT_ICON[r]}</span>
    <div class="leg__body">
      <div class="leg__pick"><strong>${esc(l.selection)}</strong><span class="leg__odds">${odds(l.odds)}</span></div>
      <div class="leg__market">${esc(l.market)}${mixed ? ` · <span class="tag tag--${l.sport}">${l.sport === 'cs2' ? 'CS2' : 'Football'}</span>` : ''}</div>
      <div class="leg__match">${esc(l.home)} <b>${score}</b> ${esc(l.away)} <span class="muted">· ${esc(dayLabel(l.date))} ${esc(l.time)}</span></div>
      ${why}
    </div>
  </li>`;
}

function betHtml(b) {
  const title = b.type === 'multi' ? `${b.legs.length} Leg Multi` : esc(b.legs[0].selection);
  const sub = b.type === 'multi' ? '' : `<div class="bet__sub">${esc(b.legs[0].market)}</div>`;
  const held =
    b.status === 'cashed_out' && typeof b.held_payout === 'number'
      ? `<div class="bet__held ${b.held_payout > b.payout ? 'bad' : 'good'}">${b.held_payout > b.payout ? `If held it would have paid ${money(b.held_payout)}` : 'It would have lost: cashing out saved ' + money(b.payout)}</div>`
      : b.status === 'cashed_out' && b.held_payout === 'won_unknown_odds'
        ? '<div class="bet__held bad">If held it would have won (original odds not shown by Stake)</div>'
        : '';
  return `<article class="bet bet--${b.status}">
    <header class="bet__head">
      <div><div class="bet__title">${title}</div>${sub}</div>
      <span class="badge badge--${b.status}">${RESULT_ICON[b.status] || ''} ${RESULT_LABEL[b.status] || esc(b.status)}</span>
    </header>
    <div class="bet__meta">${esc(dayLabel(b.date))} · ${esc(b.time)} · <span class="tag tag--${b.sport}">${esc(SPORT_LABEL[b.sport])}</span></div>
    <ul class="legs">${b.legs.map((l) => legHtml(l, b.sport === 'mixed')).join('')}</ul>
    <footer class="bet__foot">
      <div><span>Odds</span><strong>${odds(b.odds)}</strong></div>
      <div><span>Stake</span><strong>${money(b.stake)}</strong></div>
      <div><span>Payout</span><strong>${money(b.payout)}</strong></div>
      <div><span>Profit</span><strong class="${b.profit > 0 ? 'good' : b.profit < 0 ? 'bad' : ''}">${money(b.profit, { sign: true })}</strong></div>
    </footer>
    ${held}
  </article>`;
}

export function renderBets(root, ctx) {
  const list = ctx.bets.filter(matches);
  const staked = list.reduce((s, b) => s + b.stake, 0);
  const profit = list.reduce((s, b) => s + b.profit, 0);
  const won = list.filter((b) => b.status === 'won').length;
  const lost = list.filter((b) => b.status === 'lost').length;

  const byDay = new Map();
  for (const b of list) {
    if (!byDay.has(b.date)) byDay.set(b.date, []);
    byDay.get(b.date).push(b);
  }

  root.innerHTML = `
    <section class="page-head">
      <h1>My Bets</h1>
      <p class="muted">${ctx.bets.length} settled Stake bets${ctx.localCount ? `, ${ctx.localCount} added in this browser` : ''}.</p>
    </section>
    <section class="filters">
      ${chips('sport')}${chips('result')}${chips('type')}
      <input class="search" type="search" placeholder="Search team or market" value="${esc(state.q)}" aria-label="Search bets">
    </section>
    <section class="summary-row">
      <div><span>Bets</span><strong>${list.length}</strong></div>
      <div><span>Won / lost</span><strong>${won} / ${lost}</strong></div>
      <div><span>Staked</span><strong>${money(staked)}</strong></div>
      <div><span>Profit</span><strong class="${profit > 0 ? 'good' : profit < 0 ? 'bad' : ''}">${money(profit, { sign: true })}</strong></div>
    </section>
    ${
      list.length
        ? [...byDay.entries()]
            .map(([d, bs]) => {
              const p = bs.reduce((s, b) => s + b.profit, 0);
              return `<section class="day"><h2 class="day__head"><span>${esc(dayLabel(d))}</span><span class="${p > 0 ? 'good' : p < 0 ? 'bad' : 'muted'}">${money(p, { sign: true })}</span></h2><div class="bet-grid">${bs.map(betHtml).join('')}</div></section>`;
            })
            .join('')
        : '<p class="empty">No bets match these filters.</p>'
    }
    <details class="import">
      <summary>Add bets from Stake</summary>
      <p class="muted small">On Stake open My Bets → Settled, select the whole list, copy, and paste it here. Bets already on the page are skipped. Added bets stay in this browser only.</p>
      <textarea rows="8" placeholder="Paste Stake's My Bets page here"></textarea>
      <div class="import__row">
        <button type="button" class="btn btn--primary" data-act="import">Add bets</button>
        ${ctx.localCount ? '<button type="button" class="btn" data-act="clear">Remove bets added here</button>' : ''}
        <span class="import__msg" role="status"></span>
      </div>
    </details>`;

  root.querySelectorAll('[data-f]').forEach((btn) =>
    btn.addEventListener('click', () => {
      state[btn.dataset.f] = btn.dataset.v;
      renderBets(root, ctx);
    })
  );
  const search = root.querySelector('.search');
  search.addEventListener('input', () => {
    state.q = search.value.trim();
    const pos = search.selectionStart;
    renderBets(root, ctx);
    const s = root.querySelector('.search');
    s.focus();
    s.setSelectionRange(pos, pos);
  });
  root.querySelector('[data-act="import"]').addEventListener('click', () => {
    const textarea = root.querySelector('.import textarea');
    const res = ctx.addLocal(textarea.value);
    const msg = root.querySelector('.import__msg');
    msg.textContent = res.error
      ? res.error
      : `Added ${res.added} bet${res.added === 1 ? '' : 's'}${res.dup ? `, ${res.dup} already here` : ''}${res.errors ? `, ${res.errors} could not be read` : ''}.`;
    if (res.added) setTimeout(() => ctx.refresh(), 900);
  });
  root.querySelector('[data-act="clear"]')?.addEventListener('click', () => {
    ctx.clearLocal();
    ctx.refresh();
  });
}
