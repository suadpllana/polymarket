/**
 * Every number on the Stats page, computed from enriched bets
 * (see enrichBets in bets.js).
 */

import { norm, round2 } from './bets.js';

export const SPORTS = ['football', 'cs2', 'mixed'];
export const SPORT_LABEL = { football: 'Football', cs2: 'CS2', mixed: 'Football + CS2' };

function bucket() {
  return { count: 0, won: 0, lost: 0, cashed: 0, void: 0, staked: 0, returned: 0, profit: 0 };
}

function add(b, bet) {
  b.count++;
  if (bet.status === 'won') b.won++;
  else if (bet.status === 'lost') b.lost++;
  else if (bet.status === 'cashed_out') b.cashed++;
  else b.void++;
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

function legBucket() {
  return { legs: 0, won: 0, lost: 0, void: 0, unknown: 0, oddsSum: 0, impliedSum: 0, priced: 0 };
}

function addLeg(b, leg) {
  b.legs++;
  if (leg.result === 'won') b.won++;
  else if (leg.result === 'lost') b.lost++;
  else if (leg.result === 'void') b.void++;
  else b.unknown++;
  if (leg.odds && (leg.result === 'won' || leg.result === 'lost')) {
    b.oddsSum += leg.odds;
    b.impliedSum += 1 / leg.odds;
    b.priced++;
  }
}

function finishLeg(b) {
  const decided = b.won + b.lost;
  b.hitRate = decided ? b.won / decided : null;
  b.avgOdds = b.priced ? b.oddsSum / b.priced : null;
  // What the prices said these legs would hit, on average.
  b.implied = b.priced ? b.impliedSum / b.priced : null;
  b.edge = b.hitRate !== null && b.implied !== null ? b.hitRate - b.implied : null;
  return b;
}

const ODDS_BANDS = [
  { label: 'Under 1.50', max: 1.5 },
  { label: '1.50–1.99', max: 2 },
  { label: '2.00–2.99', max: 3 },
  { label: '3.00–5.99', max: 6 },
  { label: '6.00+', max: Infinity },
];

const LEG_COUNTS = [
  { label: 'Singles', test: (n) => n === 1 },
  { label: '2 legs', test: (n) => n === 2 },
  { label: '3 legs', test: (n) => n === 3 },
  { label: '4+ legs', test: (n) => n >= 4 },
];

/** The team a leg backs, or null for Yes/Over/correct-score style picks. */
function backedTeam(leg) {
  if (!/winner|1x2|match result|draw no bet|double chance/i.test(leg.market)) return null;
  const name = leg.selection.replace(/\s+or\s+draw$|^draw\s+or\s+/i, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (/^draw$/i.test(name)) return null;
  return name;
}

export function computeStats(bets) {
  const total = bucket();
  const bySport = Object.fromEntries(SPORTS.map((s) => [s, bucket()]));
  const byLegs = LEG_COUNTS.map((c) => ({ label: c.label, test: c.test, ...bucket() }));
  const byOdds = ODDS_BANDS.map((o) => ({ ...o, ...bucket() }));
  const legSport = { football: legBucket(), cs2: legBucket() };
  const legGroup = new Map();
  const teams = new Map();
  const blame = { football: { bets: 0, stake: 0 }, cs2: { bets: 0, stake: 0 }, both: { bets: 0, stake: 0 }, unknown: { bets: 0, stake: 0 } };
  const cash = { count: 0, stake: 0, got: 0, costYou: 0, savedYou: 0, wouldHaveWon: 0, wouldHaveLost: 0, unknown: 0, list: [] };
  const daily = new Map();
  let drawsKilled = 0;
  let favLegsLost = 0;

  for (const bet of bets) {
    add(total, bet);
    add(bySport[bet.sport] || bySport.mixed, bet);
    add(byLegs.find((c) => c.test(bet.legCount)), bet);
    if (bet.odds) add(byOdds.find((o) => bet.odds < o.max), bet);

    const day = daily.get(bet.date) || { date: bet.date, profit: 0, staked: 0, bets: 0 };
    day.profit += bet.payout - bet.stake;
    day.staked += bet.stake;
    day.bets++;
    daily.set(bet.date, day);

    for (const leg of bet.legs) {
      addLeg(legSport[leg.sport], leg);
      if (!legGroup.has(leg.group)) legGroup.set(leg.group, { group: leg.group, sport: leg.sport, ...legBucket() });
      addLeg(legGroup.get(leg.group), leg);

      const team = backedTeam(leg);
      if (team) {
        const key = `${leg.sport}:${norm(team)}`;
        const t = teams.get(key) || { name: team, sport: leg.sport, legs: 0, won: 0, lost: 0 };
        t.legs++;
        if (leg.result === 'won') t.won++;
        if (leg.result === 'lost') t.lost++;
        teams.set(key, t);
      }
      if (leg.sport === 'football' && leg.group === 'Win (1x2)' && leg.result === 'lost') {
        favLegsLost++;
        const level = leg.score && leg.score[0] === leg.score[1];
        if (level || leg.level_after_90) drawsKilled++;
      }
    }

    if (bet.status === 'lost') {
      const losers = bet.legs.filter((l) => l.result === 'lost');
      const sports = new Set(losers.map((l) => l.sport));
      const key = !losers.length ? 'unknown' : sports.size > 1 ? 'both' : [...sports][0];
      blame[key].bets++;
      blame[key].stake += bet.stake;
    }

    if (bet.status === 'cashed_out') {
      cash.count++;
      cash.stake += bet.stake;
      cash.got += bet.payout;
      const held = bet.held_payout;
      const row = { bet, held };
      if (held === 0) {
        cash.savedYou += bet.payout;
        cash.wouldHaveLost++;
      } else if (typeof held === 'number') {
        cash.costYou += held - bet.payout;
        cash.wouldHaveWon++;
      } else if (held === 'won_unknown_odds') {
        cash.wouldHaveWon++;
      } else cash.unknown++;
      cash.list.push(row);
    }
  }

  finish(total);
  SPORTS.forEach((s) => finish(bySport[s]));
  byLegs.forEach(finish);
  byOdds.forEach(finish);
  Object.values(legSport).forEach(finishLeg);
  const groups = [...legGroup.values()].map(finishLeg).sort((a, b) => b.legs - a.legs);
  for (const k of Object.keys(blame)) blame[k].stake = round2(blame[k].stake);
  cash.costYou = round2(cash.costYou);
  cash.savedYou = round2(cash.savedYou);

  let running = 0;
  const timeline = [...daily.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => {
      running += d.profit;
      return { ...d, profit: round2(d.profit), cumulative: round2(running) };
    });

  const teamList = [...teams.values()].filter((t) => t.won + t.lost > 0);
  const lostBets = total.lost;

  return {
    total,
    bySport,
    byLegs,
    byOdds,
    legSport,
    groups,
    blame,
    lostBets,
    cash,
    timeline,
    drawsKilled,
    favLegsLost,
    bestTeams: teamList.filter((t) => t.legs >= 2).sort((a, b) => b.won - b.lost - (a.won - a.lost) || b.legs - a.legs).slice(0, 8),
    worstTeams: teamList.filter((t) => t.lost > 0).sort((a, b) => b.lost - a.lost || a.won - b.won).slice(0, 8),
  };
}

const money = (x) => `${x < 0 ? '−' : ''}$${Math.abs(x).toFixed(2)}`;
const pct = (x) => `${Math.round(x * 100)}%`;

/** Plain-language findings, strongest first. */
export function insights(s) {
  const out = [];
  const f = s.bySport.football;
  const c = s.bySport.cs2;
  const m = s.bySport.mixed;
  if (f.count) out.push({ tone: f.profit >= 0 ? 'good' : 'bad', text: `Football-only bets: ${f.won} won, ${f.lost} lost, ${money(f.profit)} profit (${pct(f.roi)} return on ${money(f.staked)} staked).` });
  if (c.count) out.push({ tone: c.profit >= 0 ? 'good' : 'bad', text: `CS2-only bets: ${c.won} won, ${c.lost} lost, ${money(c.profit)} (${pct(c.roi)} return on ${money(c.staked)} staked).` });
  if (m.count) out.push({ tone: m.profit >= 0 ? 'good' : 'bad', text: `Bets mixing football and CS2: ${m.won} won, ${m.lost} lost, ${money(m.profit)}.` });
  if (s.lostBets) {
    const b = s.blame;
    const both = b.both.bets ? `, ${b.both.bets} by both` : '';
    out.push({ tone: 'bad', text: `Of your ${s.lostBets} lost bets, ${b.cs2.bets} (${pct(b.cs2.bets / s.lostBets)}) were lost by a CS2 leg and ${b.football.bets} (${pct(b.football.bets / s.lostBets)}) by a football leg${both}.` });
  }
  if (s.cash.costYou > 0) out.push({ tone: 'bad', text: `Cashing out cost you ${money(s.cash.costYou)}: ${s.cash.wouldHaveWon} cashed-out bets would have won if you had left them. It saved you ${money(s.cash.savedYou)} on ${s.cash.wouldHaveLost} that would have lost.` });
  if (s.favLegsLost) out.push({ tone: 'bad', text: `Draws sank ${s.drawsKilled} of your ${s.favLegsLost} losing football "to win" legs.` });
  const big = s.byLegs.find((b) => b.label === '4+ legs');
  if (big && big.count) out.push({ tone: big.profit >= 0 ? 'good' : 'bad', text: `Bets with 4 or more legs: ${big.won} won from ${big.count}, ${money(big.profit)}.` });
  const singles = s.byLegs.find((b) => b.label === 'Singles');
  if (singles && singles.count) out.push({ tone: singles.profit >= 0 ? 'good' : 'bad', text: `Singles: ${singles.won} won, ${singles.lost} lost, ${money(singles.profit)}.` });
  return out;
}
