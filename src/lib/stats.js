/**
 * The numbers on the Stats page, computed from enriched bets
 * (see enrichBets in bets.js).
 */

import { norm, round2 } from './bets.js';

export const SPORTS = ['football', 'cs2', 'other', 'mixed'];
export const SPORT_LABEL = { football: 'Football', cs2: 'CS2', other: 'Other sports', mixed: 'Mixed sports' };

function bucket(label) {
  return { label, count: 0, won: 0, lost: 0, cashed: 0, staked: 0, returned: 0, profit: 0 };
}

function add(b, bet) {
  b.count++;
  if (bet.status === 'won') b.won++;
  else if (bet.status === 'lost') b.lost++;
  else if (bet.status === 'cashed_out') b.cashed++;
  b.staked += bet.stake;
  b.returned += bet.payout;
  b.profit += bet.payout - bet.stake;
}

function finish(b) {
  b.staked = round2(b.staked);
  b.returned = round2(b.returned);
  b.profit = round2(b.profit);
  b.roi = b.staked ? b.profit / b.staked : 0;
  b.winRate = b.won + b.lost ? b.won / (b.won + b.lost) : null;
  return b;
}

const LEG_COUNTS = [
  { label: 'Singles', test: (n) => n === 1 },
  { label: '2–3 legs', test: (n) => n === 2 || n === 3 },
  { label: '4+ legs', test: (n) => n >= 4 },
];

/** The team or player a leg backs, or null for Yes/Over/correct-score style picks. */
function backedTeam(leg) {
  if (!/winner|1x2|match result|draw no bet|double chance|handicap/i.test(leg.market)) return null;
  const name = leg.selection
    .replace(/\s+or\s+draw$|^draw\s+or\s+/i, '')
    .replace(/\s*\([^)]*\)\s*$/, '')
    .trim();
  if (!name || /^(draw|over|under|yes|no)\b/i.test(name) || /^\d+\s*[:-]\s*\d+$/.test(name)) return null;
  return name;
}

function tally(map, key, label, leg) {
  const t = map.get(key) || { label, won: 0, lost: 0 };
  if (leg.result === 'won') t.won++;
  else if (leg.result === 'lost') t.lost++;
  map.set(key, t);
}

export function computeStats(bets) {
  const total = bucket('All bets');
  const bySport = Object.fromEntries(SPORTS.map((s) => [s, bucket(SPORT_LABEL[s])]));
  const byLegs = LEG_COUNTS.map((c) => ({ test: c.test, ...bucket(c.label) }));
  // What cashing out cost on bets that would have won, and saved on ones that would have lost.
  const cash = { count: 0, costYou: 0, savedYou: 0, wouldHaveWon: 0 };
  const daily = new Map();
  // Every pick (leg) counted once per bet it was in.
  const teams = new Map();
  const picks = new Map();

  for (const bet of bets) {
    add(total, bet);
    add(bySport[bet.sport] || bySport.mixed, bet);
    add(byLegs.find((c) => c.test(bet.legCount)), bet);

    const day = daily.get(bet.date) || { date: bet.date, profit: 0 };
    day.profit += bet.payout - bet.stake;
    daily.set(bet.date, day);

    for (const leg of bet.legs) {
      const team = backedTeam(leg);
      if (team) tally(teams, norm(team), team, leg);
      if (leg.group) tally(picks, leg.group, leg.group, leg);
    }

    if (bet.status === 'cashed_out') {
      cash.count++;
      const held = bet.held_payout;
      if (held === 0) cash.savedYou += bet.payout;
      else if (typeof held === 'number') {
        cash.costYou += held - bet.payout;
        cash.wouldHaveWon++;
      } else if (held === 'won_unknown_odds') cash.wouldHaveWon++;
    }
  }

  finish(total);
  SPORTS.forEach((s) => finish(bySport[s]));
  byLegs.forEach(finish);
  cash.costYou = round2(cash.costYou);
  cash.savedYou = round2(cash.savedYou);

  let running = 0;
  const timeline = [...daily.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => {
      running += d.profit;
      return { date: d.date, profit: round2(d.profit), cumulative: round2(running) };
    });

  const decided = (m) => [...m.values()].filter((t) => t.won + t.lost > 0);
  const teamList = decided(teams);
  return {
    total,
    bySport,
    byLegs,
    cash,
    timeline,
    // Most wins over losses first; at least two picks so one lucky bet doesn't top the list.
    bestTeams: teamList
      .filter((t) => t.won + t.lost >= 2 && t.won > t.lost)
      .sort((a, b) => b.won - b.lost - (a.won - a.lost) || b.won - a.won)
      .slice(0, 8),
    worstTeams: teamList
      .filter((t) => t.lost >= t.won)
      .sort((a, b) => b.lost - b.won - (a.lost - a.won) || b.lost - a.lost)
      .slice(0, 8),
    pickTypes: decided(picks)
      .filter((t) => t.won + t.lost >= 3)
      .sort((a, b) => b.won + b.lost - (a.won + a.lost)),
  };
}
