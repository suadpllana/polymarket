/**
 * Turns parsed Stake bets into analysable records: which sport each leg is,
 * whether each leg won (from the final score, or from the bet's own result),
 * and the bet's profit.
 */

const CS2_MARKET = /twoway|map\s*\d|maps|round handicap|round winner|pistol/i;
const FOOTBALL_MARKET = /1x2|match result|both teams|double chance|draw no bet|asian|total goals|goals|corners|cards|half/i;
// Fallback for markets both sports use (e.g. Correct Score).
const CS2_NAMES = /\b(team vitality|vitality|natus vincere|navi|furia|spirit|mouz|liquid|faze|g2|falcons|aurora|betboom|mongolz|tyloo|9z|jijiehao|eternal fire|parivision|k27|metizport|m80|nemiga|fut esports|fut|alliance|dendele|envy|1win|astralis|heroic|virtus|complexity|3dmax|gamerlegion|pain|imperial|mibr|saw|b8|bc\.game|lynn vision|the huns|esports|gaming)\b/i;

const ALIASES = [
  ['internazionale', 'inter'],
  ['paris saint germain', 'psg'],
  ['natus vincere', 'navi'],
  ['olympique lyonnais', 'lyon'],
  ['olympique marseille', 'marseille'],
  ['manchester united', 'man united'],
  ['manchester city', 'man city'],
];

export function norm(name) {
  let s = String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(fc|cf|afc|sc|ac|as|ss|team|esports|gaming|club|calcio)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const [a, b] of ALIASES) if (s === a || s === b) s = b;
  return s;
}

function sameTeam(a, b) {
  const x = norm(a);
  const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/** 'home' | 'away' | 'draw' | null for a selection string. */
function sideOf(selection, leg) {
  if (/^draw$/i.test(selection.trim())) return 'draw';
  const h = sameTeam(selection, leg.home);
  const a = sameTeam(selection, leg.away);
  if (h && !a) return 'home';
  if (a && !h) return 'away';
  return null;
}

export function legSport(leg, cs2Teams = new Set()) {
  if (CS2_MARKET.test(leg.market)) return 'cs2';
  if (FOOTBALL_MARKET.test(leg.market)) return 'football';
  if (cs2Teams.has(norm(leg.home)) || cs2Teams.has(norm(leg.away))) return 'cs2';
  if (CS2_NAMES.test(`${leg.home} ${leg.away}`)) return 'cs2';
  return 'football';
}

export function marketGroup(leg) {
  const m = leg.market.toLowerCase();
  if (leg.sport === 'cs2') {
    if (m.includes('match winner')) return 'CS2 match winner';
    if (/map \d winner/.test(m)) return 'CS2 map winner';
    if (m.includes('correct score')) return 'CS2 correct score';
    if (m.includes('total maps')) return 'CS2 total maps';
    if (m.includes('handicap')) return 'CS2 handicap';
    return 'CS2 other';
  }
  if (m.includes('2up')) return 'Win (2-up)';
  if (m === '1x2' || m.includes('match result')) return 'Win (1x2)';
  if (m.includes('double chance')) return 'Double chance';
  if (m.includes('draw no bet')) return 'Draw no bet';
  if (m.includes('both teams')) return 'Both teams to score';
  if (m.includes('total') || m.includes('over') || m.includes('under')) return 'Goals over/under';
  if (m.includes('correct score')) return 'Correct score';
  return 'Other';
}

/** Result of one leg from its final score, or null when the score can't tell. */
export function legFromScore(leg) {
  if (!leg.score) return null;
  const [h, a] = leg.score;
  const sel = leg.selection.trim();
  const market = leg.market.toLowerCase();
  const winner = h > a ? 'home' : a > h ? 'away' : 'draw';

  if (/correct score/.test(market)) {
    const m = /^(\d+)\s*[:-]\s*(\d+)$/.exec(sel);
    return m ? (Number(m[1]) === h && Number(m[2]) === a ? 'won' : 'lost') : null;
  }
  const ou = /^(over|under)\s+(\d+(\.\d+)?)$/i.exec(sel);
  if (ou) {
    const line = Number(ou[2]);
    const total = h + a;
    if (line % 0.5 !== 0 || line % 1 === 0.25 || line % 1 === 0.75) return null;
    if (total === line) return 'void';
    return (ou[1].toLowerCase() === 'over') === total > line ? 'won' : 'lost';
  }
  if (/both teams/.test(market)) {
    const both = h > 0 && a > 0;
    if (/^yes$/i.test(sel)) return both ? 'won' : 'lost';
    if (/^no$/i.test(sel)) return both ? 'lost' : 'won';
    return null;
  }
  if (/double chance/.test(market)) {
    const parts = sel.split(/\s+or\s+/i);
    if (parts.length !== 2) return null;
    const sides = parts.map((p) => sideOf(p, leg));
    if (sides.includes(null)) return null;
    return sides.includes(winner) ? 'won' : 'lost';
  }
  if (/map\s*(\d)/.test(market)) {
    // Only the decider is known from a series score: in a 2-0 every map went to the winner.
    const n = Number(/map\s*(\d)/.exec(market)[1]);
    if (!/winner/.test(market)) return null;
    const side = sideOf(sel, leg);
    if (!side || winner === 'draw') return null;
    const played = h + a;
    const loserMaps = Math.min(h, a);
    if (n > played) return 'void';
    if (loserMaps === 0 || n === played) return side === winner ? 'won' : 'lost';
    return null;
  }
  if (/handicap/.test(market) || /2up/.test(market)) {
    if (/2up/.test(market) && sideOf(sel, leg) === winner) return 'won';
    return null;
  }
  const side = sideOf(sel, leg);
  if (!side) return null;
  if (/draw no bet/.test(market)) return winner === 'draw' ? 'void' : side === winner ? 'won' : 'lost';
  if (/1x2|match result|winner/.test(market)) return side === winner ? 'won' : 'lost';
  return null;
}

/**
 * Fills sport, group and result on every leg, and sport/profit on the bet.
 * A result already stored on a leg (from data/stake-bets.json) is kept.
 */
export function enrichBets(bets) {
  const cs2Teams = new Set();
  for (const b of bets)
    for (const l of b.legs)
      if (CS2_MARKET.test(l.market)) {
        cs2Teams.add(norm(l.home));
        cs2Teams.add(norm(l.away));
      }

  for (const b of bets) {
    for (const l of b.legs) {
      l.sport = l.sport || legSport(l, cs2Teams);
      l.group = marketGroup(l);
      if (!l.result) {
        l.result = legFromScore(l);
        l.result_from = l.result ? 'score' : null;
      }
    }
    // The bet's own result fills what the score can't tell.
    if (b.type === 'single' && (b.status === 'won' || b.status === 'lost') && !b.legs[0].result_from?.startsWith('manual')) {
      b.legs[0].result = b.status;
      b.legs[0].result_from = 'bet';
    }
    if (b.type === 'multi' && b.status === 'won') {
      for (const l of b.legs) if (l.result !== 'void') {
        l.result = 'won';
        l.result_from = l.result_from || 'bet';
      }
    }
    if (b.type === 'multi' && b.status === 'lost') {
      const unknown = b.legs.filter((l) => !l.result);
      const lost = b.legs.filter((l) => l.result === 'lost');
      if (!lost.length && unknown.length === 1) {
        unknown[0].result = 'lost';
        unknown[0].result_from = 'bet';
      }
    }

    const sports = new Set(b.legs.map((l) => l.sport));
    b.sport = sports.size > 1 ? 'mixed' : [...sports][0];
    b.profit = round2(b.payout - b.stake);
    b.legCount = b.legs.length;

    // What a cashed-out bet would have paid if left alone.
    if (b.status === 'cashed_out') {
      const rs = b.legs.map((l) => l.result);
      if (rs.includes('lost')) b.held_payout = 0;
      else if (rs.every((r) => r === 'won' || r === 'void') && b.legs.every((l) => l.odds))
        b.held_payout = round2(b.stake * b.legs.reduce((o, l) => o * (l.result === 'void' ? 1 : l.odds), 1));
      else if (rs.every((r) => r === 'won' || r === 'void')) b.held_payout = 'won_unknown_odds';
      else b.held_payout = null;
    }
  }
  return bets;
}

/** Legs that decided a lost bet. */
export function losingLegs(b) {
  return b.legs.filter((l) => l.result === 'lost');
}

export function round2(x) {
  return Math.round(x * 100) / 100;
}
