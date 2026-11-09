/**
 * Football-only markets from Polymarket and the rules for the daily
 * 2-leg slip.
 *
 * Each game has three Yes/No markets (home win, draw, away win). From their
 * de-vigged prices we derive every leg we can bet on Stake and settle on
 * Polymarket: a straight win, double chance, and draw no bet.
 */

import { fetchEventBySlug, fetchSeriesEvents, fetchSports, parseArray, parseTime } from './polymarket.mjs';

/** Polymarket sport codes we bet on. Domestic cups are left out on purpose: rotation. */
export const LEAGUES = {
  epl: 'Premier League',
  lal: 'La Liga',
  sea: 'Serie A',
  bun: 'Bundesliga',
  fl1: 'Ligue 1',
  ucl: 'Champions League',
  uel: 'Europa League',
  col: 'Conference League',
  ere: 'Eredivisie',
  por: 'Primeira Liga',
  tur: 'Süper Lig',
  spl: 'Saudi Pro League',
  bel1: 'Belgian Pro League',
  bra: 'Brasileirão',
  unl: 'Nations League',
};

/**
 * Other sports, bet on the two-way winner market (overtime and shootouts
 * included, as Polymarket settles them). Top competitions only.
 */
export const OTHER_SPORTS = {
  nba: { name: 'NBA', kind: 'basketball' },
  euroleague: { name: 'EuroLeague', kind: 'basketball' },
  bkeurocup: { name: 'EuroCup', kind: 'basketball' },
  bkcl: { name: 'Basketball Champions League', kind: 'basketball' },
  nhl: { name: 'NHL', kind: 'ice_hockey' },
  khl: { name: 'KHL', kind: 'ice_hockey' },
  shl: { name: 'SHL', kind: 'ice_hockey' },
  liiga: { name: 'Liiga', kind: 'ice_hockey' },
  dehl: { name: 'DEL', kind: 'ice_hockey' },
  nfl: { name: 'NFL', kind: 'american_football' },
  mlb: { name: 'MLB', kind: 'baseball' },
  atp: { name: 'ATP Tour', kind: 'tennis' },
  wta: { name: 'WTA Tour', kind: 'tennis' },
  ufc: { name: 'UFC', kind: 'mma' },
  cs2: { name: 'CS2', kind: 'esports' },
  lol: { name: 'League of Legends', kind: 'esports' },
  val: { name: 'Valorant', kind: 'esports' },
  dota2: { name: 'Dota 2', kind: 'esports' },
};
// Polymarket's ATP/WTA lists mix tour events with Challengers and ITFs, which
// carry bare city names ("Monastir: A vs B", "Brisbane 3: …"). Tour-level
// events are named ("BNP Paribas Nordic Open", "WTA Finals, Group A").
const TENNIS_TOUR = /\b(open|masters|finals?|championships?|cup|classic|international|grand prix|wimbledon|roland|garros|slam|united cup|laver)\b/i;
const TENNIS_LOWER_TIER = /challenger|\bitf\b|^[^:]*\b\d+\s*:/i;
// Tier-1 esports only, best-of-three or longer.
const ESPORTS_TIER1 = /\b(blast|iem|intel extreme|esl pro league|esl one|pgl|major|esports world cup|ewc|worlds|msi|lck|lpl|lec|lcs|lta|first stand|vct|valorant champions|masters|dreamleague|the international|riyadh)\b/i;
const ESPORTS_LOWER = /challenger|cct|esea|united21|division 2|promotion|academy|qualifier|open qualifier|\bbo\s?1\b|best of 1\b/i;
// Thin European basketball and hockey books are common; below this a price means little.
const OTHER_MIN_LIQUIDITY = 1000;

/** Fair-odds range for a single leg worth researching. */
export const LEG_ODDS = { min: 1.18, max: 1.9 };
/** The slip: exactly two legs from two games, combined (Stake) odds near 2.0. */
export const SLIP = { legs: 2, min: 1.85, max: 2.25, target: 2.0 };
/** Stake's price on a favourite is roughly the fair price minus this much. */
export const BOOK_MARGIN = 0.03;
/** Every leg must land (or be refunded) at least this often. */
export const MIN_LEG_P = 0.6;
/** A straight "to win" leg needs a low draw chance; otherwise only DNB / double chance. */
export const MAX_DRAW_FOR_WIN = 0.25;
/**
 * With fewer games than this in the usual leagues (international breaks,
 * quiet Mondays), every other football competition Polymarket lists is used
 * too, so there is still a slip.
 */
export const MIN_MAIN_GAMES = 6;
/** Polymarket's tag on every football competition. */
const SOCCER_TAG = '100350';
/** Games researched per day, strongest favourites first. */
export const POOL_SIZE = 16;
const MIN_LIQUIDITY = 1000;
/** Goals, BTTS and handicap markets need a real two-sided book to be trusted. */
const EXTRA_MIN_LIQUIDITY = 5000;
const EXTRA_MAX_SPREAD = 0.04;

function isYesNo(outcomes) {
  return outcomes.length === 2 && String(outcomes[0]).toLowerCase() === 'yes' && String(outcomes[1]).toLowerCase() === 'no';
}

function isMoneyline(m) {
  if (m.sportsMarketType) return m.sportsMarketType === 'moneyline';
  return !/(spread|handicap|o\/u|over|under|total|1st|first|half|both teams|corner|card)/i.test(m.question || '');
}

function isOpen(m) {
  return m.active !== false && m.closed !== true && m.acceptingOrders !== false;
}

function liquidity(m) {
  return Number(m.liquidityNum ?? m.liquidity) || 0;
}

/** Order-book mid when the book is tight, otherwise the displayed price. */
function price0(m) {
  const bid = Number(m.bestBid);
  const ask = Number(m.bestAsk);
  if (bid > 0 && ask > 0 && ask - bid <= 0.04) return (bid + ask) / 2;
  const prices = parseArray(m.outcomePrices).map(Number);
  return prices.length ? prices[0] : NaN;
}

/** Power-method de-vig: find k so that sum(p_i^k) = 1. */
export function devigPower(raw) {
  const sum = (k) => raw.reduce((s, p) => s + p ** k, 0);
  let lo = 0.5;
  let hi = 2;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (sum(mid) > 1) lo = mid;
    else hi = mid;
  }
  const k = (lo + hi) / 2;
  return raw.map((p) => p ** k);
}

export function clean(text) {
  return String(text ?? '').replace(/[​-‍⁠﻿]/g, '').trim();
}

function teamName(m) {
  if (m.groupItemTitle) return clean(m.groupItemTitle);
  const match = /will (.+?) win/i.exec(m.question || '');
  return clean(match ? match[1] : m.question);
}

function eventStart(event) {
  for (const m of event.markets || []) {
    const t = parseTime(m.gameStartTime);
    if (t) return t;
  }
  return parseTime(event.startTime) || parseTime(event.eventDate) || null;
}

export function round(x, digits = 2) {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

/** One football game with de-vigged 1X2 probabilities, or null. */
export function gameFromEvent(event, code, name) {
  const markets = (event.markets || []).filter((m) => isOpen(m) && isMoneyline(m) && isYesNo(parseArray(m.outcomes)));
  if (markets.length !== 3) return null;
  const draw = markets.find((m) => /draw/i.test(`${m.groupItemTitle || ''} ${m.question || ''}`));
  if (!draw) return null;
  // Gamma lists the home side first, matching the "Home vs. Away" title.
  const [home, away] = markets.filter((m) => m !== draw);
  if ([home, draw, away].some((m) => liquidity(m) < MIN_LIQUIDITY)) return null;
  const raw = [home, draw, away].map(price0);
  if (raw.some((p) => !(p > 0 && p < 1))) return null;
  const [ph, pd, pa] = devigPower(raw);
  const start = eventStart(event);
  if (!start) return null;
  return {
    id: String(event.id),
    slug: event.slug || '',
    league: LEAGUES[code] || name || code,
    sport: 'football',
    extended: !LEAGUES[code],
    event: clean(event.title),
    home: teamName(home),
    away: teamName(away),
    start: start.toISOString(),
    p_market: { home: round(ph, 4), draw: round(pd, 4), away: round(pa, 4) },
    refs: { home: String(home.id), draw: String(draw.id), away: String(away.id) },
  };
}

/** One two-way game (tennis, basketball, hockey, esports...), or null. */
export function twoWayGameFromEvent(event, code) {
  const sport = OTHER_SPORTS[code];
  if (!sport) return null;
  const title = clean(event.title);
  if (sport.kind === 'tennis') {
    const event = title.split(':')[0];
    if (TENNIS_LOWER_TIER.test(event) || !TENNIS_TOUR.test(event)) return null;
  }
  if (sport.kind === 'esports' && (ESPORTS_LOWER.test(title) || !ESPORTS_TIER1.test(title))) return null;
  const m = (event.markets || []).find((mk) => {
    const outcomes = parseArray(mk.outcomes);
    return isOpen(mk) && isMoneyline(mk) && outcomes.length === 2 && !isYesNo(outcomes);
  });
  if (!m || liquidity(m) < OTHER_MIN_LIQUIDITY) return null;
  const p0 = price0(m);
  if (!(p0 > 0 && p0 < 1)) return null;
  const start = eventStart(event);
  if (!start) return null;
  const [home, away] = parseArray(m.outcomes).map(clean);
  return {
    id: String(event.id),
    slug: event.slug || '',
    league: sport.name,
    sport: sport.kind,
    twoWay: true,
    extended: false,
    event: title,
    home,
    away,
    start: start.toISOString(),
    // A binary book: the two sides are one market, so there is no margin to remove.
    p_market: { home: round(p0, 4), draw: 0, away: round(1 - p0, 4) },
    refs: { market: String(m.id) },
    extras: [],
  };
}

/**
 * Every leg of a game, given 1X2 probabilities p = {home, draw, away}.
 * p_win pays the odds, p_void returns the stake (draw no bet on a draw).
 */
export function legsFor(game, p) {
  const { home, away } = game;
  if (game.twoWay) {
    const label = game.sport === 'esports' || game.sport === 'tennis' || game.sport === 'mma' ? 'Match winner' : 'Moneyline';
    return [
      { key: 'home', selection: home, p_win: p.home, settle: { won: [`${game.refs.market}#0`], void: [], lost: [`${game.refs.market}#1`] } },
      { key: 'away', selection: away, p_win: p.away, settle: { won: [`${game.refs.market}#1`], void: [], lost: [`${game.refs.market}#0`] } },
    ].map((l) => {
      const fair = 1 / l.p_win;
      return { ...l, label, p_void: 0, fair_odds_exact: fair, fair_odds: round(fair, 2), est_odds: round(fair * (1 - BOOK_MARGIN), 2) };
    });
  }
  const legs = [
    { key: 'home', label: 'Match winner', selection: home, p_win: p.home, p_void: 0, won: ['home'], void: [], lost: ['draw', 'away'] },
    { key: 'away', label: 'Match winner', selection: away, p_win: p.away, p_void: 0, won: ['away'], void: [], lost: ['draw', 'home'] },
    { key: 'home_draw', label: 'Double chance', selection: `${home} or Draw`, p_win: p.home + p.draw, p_void: 0, won: ['home', 'draw'], void: [], lost: ['away'] },
    { key: 'away_draw', label: 'Double chance', selection: `${away} or Draw`, p_win: p.away + p.draw, p_void: 0, won: ['away', 'draw'], void: [], lost: ['home'] },
    { key: 'home_dnb', label: 'Draw no bet', selection: home, p_win: p.home, p_void: p.draw, won: ['home'], void: ['draw'], lost: ['away'] },
    { key: 'away_dnb', label: 'Draw no bet', selection: away, p_win: p.away, p_void: p.draw, won: ['away'], void: ['draw'], lost: ['home'] },
  ];
  return legs.map((l) => {
    // Fair odds: the price at which the leg breaks even.
    const fair = (1 - l.p_void) / l.p_win;
    return { ...l, fair_odds_exact: fair, fair_odds: round(fair, 2), est_odds: round(fair * (1 - BOOK_MARGIN), 2) };
  });
}

/**
 * Full-game goals, both-teams-to-score, handicap and team-goals markets from
 * the game's "more markets" event on Polymarket. Each binary market gives two
 * legs. Prices are the order-book mid, so only tight, liquid books are used.
 */
export function extraMarkets(game, event) {
  const out = [];
  for (const m of event?.markets || []) {
    if (!isOpen(m) || liquidity(m) < EXTRA_MIN_LIQUIDITY) continue;
    const bid = Number(m.bestBid);
    const ask = Number(m.bestAsk);
    if (!(bid > 0 && ask > 0 && ask - bid <= EXTRA_MAX_SPREAD)) continue;
    const mid = (bid + ask) / 2;
    const outcomes = parseArray(m.outcomes).map(clean);
    if (outcomes.length !== 2) continue;
    const q = clean(m.question);
    const line = (/(-?\d+(?:\.\d+)?)\)?\s*$/.exec(q) || [])[1];
    let sides;
    switch (m.sportsMarketType) {
      case 'totals':
        sides = [['Total goals', `Over ${line}`, `ou_${line}_over`], ['Total goals', `Under ${line}`, `ou_${line}_under`]];
        break;
      case 'both_teams_to_score':
        sides = [['Both teams to score', 'Yes', 'btts_yes'], ['Both teams to score', 'No', 'btts_no']];
        break;
      case 'spreads': {
        // "Spread: PSV (-1.5)": outcome 0 is that team covering, outcome 1 the other side.
        const n = Number(line);
        const side = outcomes[0] === game.home ? 'home' : outcomes[0] === game.away ? 'away' : null;
        if (!side || !Number.isFinite(n)) continue;
        const other = side === 'home' ? 'away' : 'home';
        sides = [
          ['Handicap', `${outcomes[0]} ${n}`, `ah_${side}_${n}`],
          ['Handicap', `${outcomes[1]} +${Math.abs(n)}`, `ah_${other}_+${Math.abs(n)}`],
        ];
        break;
      }
      case 'soccer_team_totals': {
        const team = q.includes(`: ${game.home} O/U`) ? 'home' : q.includes(`: ${game.away} O/U`) ? 'away' : null;
        if (!team) continue;
        const name = game[team];
        sides = [[`${name} goals`, `Over ${line}`, `tt_${team}_${line}_over`], [`${name} goals`, `Under ${line}`, `tt_${team}_${line}_under`]];
        break;
      }
      default:
        continue;
    }
    if (!line && m.sportsMarketType !== 'both_teams_to_score') continue;
    sides.forEach(([label, selection, key], i) => {
      out.push({
        key,
        label,
        selection,
        p_market: round(i === 0 ? mid : 1 - mid, 4),
        settle: { won: [`${m.id}#${i}`], void: [], lost: [`${m.id}#${1 - i}`] },
      });
    });
  }
  return out;
}

/** An extra-market leg at probability p, in the same shape as legsFor's. */
export function extraLeg(x, p) {
  const fair = 1 / p;
  return { ...x, p_win: p, p_void: 0, fair_odds_exact: fair, fair_odds: round(fair, 2), est_odds: round(fair * (1 - BOOK_MARGIN), 2) };
}

/** Every leg of a game at its live market prices: result legs and extras. */
export function marketLegs(game) {
  return [...legsFor(game, game.p_market), ...(game.extras || []).map((x) => extraLeg(x, x.p_market))];
}

export function inRange(leg) {
  return leg.fair_odds_exact >= LEG_ODDS.min && leg.fair_odds_exact <= LEG_ODDS.max;
}

async function gamesFromSeries(s, window) {
  const out = [];
  const events = await fetchSeriesEvents(s.series, window.start);
  for (const ev of events) {
    const g = OTHER_SPORTS[s.sport] ? twoWayGameFromEvent(ev, s.sport) : gameFromEvent(ev, s.sport, s.name);
    if (!g) continue;
    const t = new Date(g.start);
    if (t < window.start || t > window.end) continue;
    if (g.twoWay) {
      out.push(g);
      continue;
    }
    try {
      g.extras = extraMarkets(g, await fetchEventBySlug(`${ev.slug}-more-markets`));
    } catch (e) {
      g.extras = [];
      console.error(`${g.event}: no extra markets (${e.message})`);
    }
    out.push(g);
  }
  console.error(`${s.sport}: ${events.length} open events, ${out.length} games in window`);
  return out;
}

/**
 * Football games starting inside the window from the usual leagues; when
 * those have fewer than MIN_MAIN_GAMES, from every football competition on
 * Polymarket (flagged `extended`).
 */
export async function gatherGames(window) {
  const sports = await fetchSports();
  if (!sports.length) throw new Error('Polymarket returned no sports list');
  const games = [];
  // Football's usual leagues and every other sport we cover.
  for (const s of sports.filter((x) => (LEAGUES[x.sport] || OTHER_SPORTS[x.sport]) && x.series)) {
    try {
      games.push(...(await gamesFromSeries(s, window)));
    } catch (e) {
      console.error(`${s.sport}: ${e.message}`);
    }
  }
  const football = games.filter((g) => g.sport === 'football').length;
  if (football >= MIN_MAIN_GAMES) return games;

  console.error(`Only ${football} football games in the usual leagues; adding every other football competition.`);
  const others = sports.filter((x) => !LEAGUES[x.sport] && !OTHER_SPORTS[x.sport] && x.series && String(x.tags || '').split(',').includes(SOCCER_TAG));
  // A few at a time: there are dozens of competitions.
  for (let i = 0; i < others.length; i += 6) {
    const batch = await Promise.all(
      others.slice(i, i + 6).map((s) =>
        gamesFromSeries(s, window).catch((e) => {
          console.error(`${s.sport}: ${e.message}`);
          return [];
        })
      )
    );
    games.push(...batch.flat());
  }
  return games;
}

/** The games worth a deep look: a leg in range, strongest favourite first. */
export function researchPool(games, size = POOL_SIZE) {
  return games
    .filter((g) => marketLegs(g).some(inRange))
    // Usual football leagues and other top sports first, then the strongest favourites.
    .sort((a, b) => Number(a.extended) - Number(b.extended) || Math.max(b.p_market.home, b.p_market.away) - Math.max(a.p_market.home, a.p_market.away))
    .slice(0, size);
}
