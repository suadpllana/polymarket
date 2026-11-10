/**
 * Bankroll tracker logic: a flat stake of 4% of the balance, reset each
 * Monday, one logged bet per day, and a stop line. State lives in this
 * browser's localStorage; nothing is sent anywhere.
 */

const KEY = 'bankroll.v1';
export const STAKE_PCT = 0.04;
/** The stop line sits at about two thirds of the starting balance ($266 → $180). */
const FLOOR_RATIO = 0.68;

export function loadBankroll() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    return s && typeof s.balance === 'number' ? s : null;
  } catch {
    return null;
  }
}

export function saveBankroll(state) {
  try {
    if (state) localStorage.setItem(KEY, JSON.stringify(state));
    else localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

/** Monday of the week containing 'YYYY-MM-DD'. */
export function weekStart(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const back = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - back);
  return date.toISOString().slice(0, 10);
}

export function stakeFor(balance) {
  return Math.max(1, Math.floor(balance * STAKE_PCT));
}

const cents = (x) => Math.round(x * 100) / 100;

export function createBankroll(start, today) {
  return {
    start: cents(start),
    floor: Math.round((start * FLOOR_RATIO) / 10) * 10,
    balance: cents(start),
    started: today,
    week: weekStart(today),
    weekStake: stakeFor(start),
    bets: {},
  };
}

/** Money on bets that have not settled yet (already taken off the balance). */
export function inPlay(state) {
  return cents(Object.values(state.bets).reduce((s, b) => s + (b.result ? 0 : b.stake), 0));
}

/** A new week resets the stake to 4% of what the bankroll is worth now. */
export function rollWeek(state, today) {
  const week = weekStart(today);
  if (week !== state.week) {
    state.week = week;
    state.weekStake = stakeFor(state.balance + inPlay(state));
  }
  return state;
}

/** Like the bookmaker's account: the stake leaves the balance when the bet is placed. */
export function placeBet(state, date, stake, odds) {
  if (state.bets[date] || !(stake > 0) || !(odds > 1) || stake > state.balance) return false;
  state.bets[date] = { stake: cents(stake), odds: Number(odds), result: null, delta: null };
  state.balance = cents(state.balance - stake);
  return true;
}

/** result: 'won' | 'lost' | 'void'. `paidOdds` overrides the odds (a multi with a void leg). */
export function settleBet(state, date, result, paidOdds) {
  const b = state.bets[date];
  if (!b || b.result) return false;
  const payout = result === 'won' ? b.stake * (paidOdds || b.odds) : result === 'void' ? b.stake : 0;
  b.result = result;
  b.delta = cents(payout - b.stake);
  state.balance = cents(state.balance + payout);
  return true;
}

/** Removes a logged bet and puts the balance back as if it was never placed. */
export function undoBet(state, date) {
  const b = state.bets[date];
  if (!b) return false;
  state.balance = cents(state.balance + (b.result ? -b.delta : b.stake));
  delete state.bets[date];
  return true;
}

/**
 * Settles logged bets from the site's own slip results. A slip that won with
 * a void leg pays less than its listed odds; the same ratio is applied.
 */
export function settleFromSite(state, entries) {
  let changed = false;
  for (const [date, b] of Object.entries(state.bets)) {
    if (b.result) continue;
    const e = entries.find((x) => x.date === date);
    if (!e || !e.result) continue;
    const ratio = e.result === 'won' && e.settled_odds && e.odds && e.settled_odds < e.odds - 0.005 ? e.settled_odds / e.odds : 1;
    changed = settleBet(state, date, e.result, Math.max(1, b.odds * ratio)) || changed;
  }
  return changed;
}

export function summary(state, today) {
  const week = weekStart(today);
  const settled = Object.entries(state.bets).filter(([, b]) => b.result);
  const sum = (rows) => cents(rows.reduce((s, [, b]) => s + b.delta, 0));
  const worth = cents(state.balance + inPlay(state));
  return {
    worth,
    inPlay: inPlay(state),
    weekProfit: sum(settled.filter(([d]) => d >= week)),
    totalProfit: sum(settled),
    won: settled.filter(([, b]) => b.result === 'won').length,
    lost: settled.filter(([, b]) => b.result === 'lost').length,
    stopped: worth <= state.floor,
  };
}
