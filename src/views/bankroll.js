import { STAKE_PCT, createBankroll, loadBankroll, placeBet, rollWeek, saveBankroll, settleBet, settleFromSite, stakeFor, summary, undoBet } from '../lib/bankroll.js';
import { dayLabel, esc, localDate, money, odds } from '../ui/format.js';

const RESULT_TEXT = { won: 'Won', lost: 'Lost', void: 'Void' };

function setupHtml() {
  return `<h2>Bankroll tracker</h2>
    <p class="card__sub">Enter what you have for betting. The tracker gives you one flat stake a week (${STAKE_PCT * 100}% of the balance) and a stop line, and keeps count as slips settle. It is saved in this browser only.</p>
    <form class="bank__form" data-act="start">
      <label>Starting balance ($)<input name="start" type="number" min="20" step="0.01" value="266" inputmode="decimal" required></label>
      <button class="btn btn--primary" type="submit">Start tracking</button>
    </form>`;
}

function betRow(date, b) {
  const state = b.result
    ? `<span class="badge badge--${b.result}">${RESULT_TEXT[b.result]}</span><strong class="${b.delta > 0 ? 'good' : b.delta < 0 ? 'bad' : ''}">${money(b.delta, { sign: true })}</strong>`
    : `<span class="badge badge--open">Open</span>
       <span class="bank__settle">
         <button type="button" class="btn btn--small" data-act="settle" data-date="${date}" data-result="won">Won</button>
         <button type="button" class="btn btn--small" data-act="settle" data-date="${date}" data-result="lost">Lost</button>
         <button type="button" class="btn btn--small" data-act="settle" data-date="${date}" data-result="void">Void</button>
       </span>`;
  return `<li class="bank__bet">
    <span class="bank__bet-day">${esc(dayLabel(date))}</span>
    <span class="muted">${money(b.stake)} @ ${odds(b.odds)}</span>
    <span class="bank__bet-end">${state}<button type="button" class="bank__undo" data-act="undo" data-date="${date}" aria-label="Remove the bet of ${esc(dayLabel(date))}">Remove</button></span>
  </li>`;
}

function trackerHtml(state, slip, today) {
  const s = summary(state, today);
  const logged = state.bets[today];
  const canPlace = slip && !slip.no_bet && !logged && !slip.result && Date.now() < new Date(slip.place_before).getTime();
  const recent = Object.entries(state.bets)
    .sort(([a], [b]) => b.localeCompare(a))
    .slice(0, 7);

  let action = '';
  if (s.stopped) {
    action = `<p class="bank__stop"><strong>Stop line reached.</strong> Your bankroll is at or below ${money(state.floor)}. Take two weeks off and look at the record before betting again. Don't top up to chase it.</p>`;
  } else if (canPlace) {
    const stake = Math.min(state.weekStake, state.balance);
    action = `<form class="bank__form" data-act="place">
        <label>Stake ($)<input name="stake" type="number" min="1" max="${state.balance}" step="0.01" value="${stake}" inputmode="decimal" required></label>
        <label>Odds you got<input name="odds" type="number" min="1.01" step="0.01" value="${odds(slip.odds)}" inputmode="decimal" required></label>
        <button class="btn btn--primary" type="submit">I placed today's slip</button>
      </form>
      <p class="small muted">Use the total odds your betting site actually gave you. One slip a day, same stake win or lose.</p>`;
  } else if (!logged) {
    action = `<p class="small muted">${slip && !slip.no_bet ? 'Today’s slip can no longer be placed.' : 'No slip to place right now.'} This week’s stake is ${money(state.weekStake)}.</p>`;
  }

  return `<div class="bank__head"><h2>Bankroll tracker</h2><span class="muted small">Stop line ${money(state.floor)}</span></div>
    <div class="summary-row bank__stats">
      <div><span>Balance</span><strong>${money(state.balance)}</strong>${s.inPlay ? `<span>${money(s.inPlay)} in play</span>` : ''}</div>
      <div><span>Stake this week</span><strong>${money(state.weekStake)}</strong></div>
      <div><span>This week</span><strong class="${s.weekProfit > 0 ? 'good' : s.weekProfit < 0 ? 'bad' : ''}">${money(s.weekProfit, { sign: true })}</strong></div>
      <div><span>Since start</span><strong class="${s.totalProfit > 0 ? 'good' : s.totalProfit < 0 ? 'bad' : ''}">${money(s.totalProfit, { sign: true })}</strong><span>${s.won} won · ${s.lost} lost</span></div>
    </div>
    ${action}
    ${recent.length ? `<ul class="bank__bets">${recent.map(([d, b]) => betRow(d, b)).join('')}</ul>` : ''}
    <details class="bank__more">
      <summary>Adjust balance or reset</summary>
      <form class="bank__form" data-act="adjust">
        <label>Balance now ($)<input name="balance" type="number" min="0" step="0.01" value="${state.balance}" inputmode="decimal" required></label>
        <button class="btn" type="submit">Save balance</button>
        <button class="btn" type="button" data-act="reset">Reset tracker</button>
      </form>
      <p class="small muted">Saving a new balance (a deposit, a withdrawal, or a correction) also resets this week’s stake to ${STAKE_PCT * 100}% of it. Open bets settle on their own when the site marks the slip won or lost; use the buttons if you bet something different.</p>
    </details>`;
}

/**
 * Renders the tracker into `el`. `entries` are the site's slips (used to
 * settle logged bets); `slip` is today's.
 */
export function renderBankroll(el, entries, slip) {
  const today = localDate();
  let state = loadBankroll();
  if (state) {
    rollWeek(state, today);
    settleFromSite(state, entries);
    saveBankroll(state);
  }
  const draw = () => {
    el.innerHTML = state ? trackerHtml(state, slip, today) : setupHtml();
  };
  draw();

  const commit = () => {
    saveBankroll(state);
    draw();
  };
  el.onsubmit = (ev) => {
    ev.preventDefault();
    const form = ev.target;
    const data = new FormData(form);
    if (form.dataset.act === 'start') {
      const start = Number(data.get('start'));
      if (start > 0) state = createBankroll(start, today);
    } else if (form.dataset.act === 'place') {
      placeBet(state, today, Number(data.get('stake')), Number(data.get('odds')));
    } else if (form.dataset.act === 'adjust') {
      const balance = Number(data.get('balance'));
      if (balance >= 0) {
        state.balance = Math.round(balance * 100) / 100;
        state.weekStake = stakeFor(state.balance + summary(state, today).inPlay);
      }
    }
    commit();
  };
  el.onclick = (ev) => {
    const btn = ev.target.closest('button[data-act]');
    if (!btn) return;
    const { act, date, result } = btn.dataset;
    if (act === 'settle') settleBet(state, date, result);
    else if (act === 'undo') undoBet(state, date);
    else if (act === 'reset') {
      if (!window.confirm('Remove the tracker and its history from this browser?')) return;
      state = null;
    } else return;
    commit();
  };
}
