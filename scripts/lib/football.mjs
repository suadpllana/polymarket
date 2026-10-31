/**
 * Football-only markets from Polymarket and the rules for the daily
 * 2-leg slip.
 *
 * Each game has three Yes/No markets (home win, draw, away win). From their
 * de-vigged prices we derive every leg we can bet on Stake and settle on
 * Polymarket: a straight win, double chance, and draw no bet.
 */

import { fetchSeriesEvents, fetchSports, parseArray, parseTime } from './polymarket.mjs';

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
/** Games researched per day, strongest favourites first. */
export const POOL_SIZE = 12;
const MIN_LIQUIDITY = 1000;

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
export function gameFromEvent(event, code) {
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
    league: LEAGUES[code],
    event: clean(event.title),
    home: teamName(home),
    away: teamName(away),
    start: start.toISOString(),
    p_market: { home: round(ph, 4), draw: round(pd, 4), away: round(pa, 4) },
    refs: { home: String(home.id), draw: String(draw.id), away: String(away.id) },
  };
}

/**
 * Every leg of a game, given 1X2 probabilities p = {home, draw, away}.
 * p_win pays the odds, p_void returns the stake (draw no bet on a draw).
 */
export function legsFor(game, p) {
  const { home, away } = game;
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

export function inRange(leg) {
  return leg.fair_odds_exact >= LEG_ODDS.min && leg.fair_odds_exact <= LEG_ODDS.max;
}

/** Football games starting inside the window, from every league we cover. */
export async function gatherGames(window) {
  const sports = await fetchSports();
  if (!sports.length) throw new Error('Polymarket returned no sports list');
  const games = [];
  for (const s of sports) {
    if (!LEAGUES[s.sport] || !s.series) continue;
    try {
      const events = await fetchSeriesEvents(s.series, window.start);
      let n = 0;
      for (const ev of events) {
        const g = gameFromEvent(ev, s.sport);
        if (!g) continue;
        const t = new Date(g.start);
        if (t < window.start || t > window.end) continue;
        games.push(g);
        n++;
      }
      console.error(`${s.sport}: ${events.length} open events, ${n} games in window`);
    } catch (e) {
      console.error(`${s.sport}: ${e.message}`);
    }
  }
  return games;
}

/** The games worth a deep look: a leg in range, strongest favourite first. */
export function researchPool(games, size = POOL_SIZE) {
  return games
    .filter((g) => legsFor(g, g.p_market).some(inRange))
    .sort((a, b) => Math.max(b.p_market.home, b.p_market.away) - Math.max(a.p_market.home, a.p_market.away))
    .slice(0, size);
}
