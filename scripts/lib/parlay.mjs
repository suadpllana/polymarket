/**
 * Turns Polymarket game events into candidate legs and builds the day's
 * parlay, following the analyst rules:
 *   - market first: probabilities come from de-vigged Polymarket prices
 *   - core lane: in-scope football and tier-1 CS2, leg odds 1.20–2.40
 *   - high-confidence lane: other top sports, moneyline only, p >= 0.75
 *   - fewest legs that reach the target, highest EV, then highest hit chance
 */

import { parseArray, parseTime } from './polymarket.mjs';

export const TARGET = { min: 4.5, max: 5.5, target: 5.0 };
export const HC_THRESHOLD = 0.75;
const CORE_ODDS = { min: 1.2, max: 2.4 };
const MIN_ODDS = 1.2;
const MIN_LIQUIDITY = 1000;

/**
 * Polymarket sport codes we bet on. Anything not listed is ignored, which
 * keeps low-tier leagues, friendlies and youth games out by construction.
 */
export const SPORTS = {
  // Core lane: football in scope
  epl: { kind: 'football', name: 'Premier League' },
  lal: { kind: 'football', name: 'La Liga' },
  bun: { kind: 'football', name: 'Bundesliga' },
  sea: { kind: 'football', name: 'Serie A' },
  fl1: { kind: 'football', name: 'Ligue 1' },
  ucl: { kind: 'football', name: 'Champions League' },
  uel: { kind: 'football', name: 'Europa League' },
  uecl: { kind: 'football', name: 'Conference League' },
  ere: { kind: 'football', name: 'Eredivisie' },
  por: { kind: 'football', name: 'Primeira Liga' },
  unl: { kind: 'football', name: 'Nations League' },
  wcq: { kind: 'football', name: 'World Cup Qualifiers' },
  // Core lane: CS2 (tier-1 and Bo3+ checked per event)
  cs2: { kind: 'cs2', name: 'CS2' },
  csgo: { kind: 'cs2', name: 'CS2' },
  // High-confidence lane
  nba: { kind: 'basketball', name: 'NBA' },
  nfl: { kind: 'american_football', name: 'NFL' },
  cfb: { kind: 'american_football', name: 'NCAAF' },
  nhl: { kind: 'ice_hockey', name: 'NHL' },
  mlb: { kind: 'baseball', name: 'MLB' },
  atp: { kind: 'tennis', name: 'ATP' },
  wta: { kind: 'tennis', name: 'WTA' },
  ufc: { kind: 'mma', name: 'UFC' },
  lol: { kind: 'esports_other', name: 'League of Legends' },
  dota2: { kind: 'esports_other', name: 'Dota 2' },
  val: { kind: 'esports_other', name: 'Valorant' },
};

const CS2_TIER1 = /\b(major|iem|intel extreme|esl pro league|blast|pgl)\b/i;
const BEST_OF_3_PLUS = /\bbo\s?[357]\b|best of [357]/i;

function isYesNo(outcomes) {
  return (
    outcomes.length === 2 &&
    String(outcomes[0]).toLowerCase() === 'yes' &&
    String(outcomes[1]).toLowerCase() === 'no'
  );
}

function isMoneyline(m) {
  if (m.sportsMarketType) return m.sportsMarketType === 'moneyline';
  return !/(spread|handicap|o\/u|over|under|total|map \d|game \d|set \d|1st|first|half|both teams)/i.test(
    m.question || ''
  );
}

function isOpen(m) {
  return m.active !== false && m.closed !== true && m.acceptingOrders !== false;
}

function liquidity(m) {
  return Number(m.liquidityNum ?? m.liquidity) || 0;
}

/**
 * Price of outcome 0. The order-book mid is the best estimate when the book is
 * tight; Polymarket's displayed price falls back to last trade otherwise.
 */
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

/** Polymarket titles sometimes carry zero-width characters. */
export function clean(text) {
  return String(text ?? '').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '').trim();
}

function teamName(m) {
  if (m.groupItemTitle) return clean(m.groupItemTitle);
  const match = /will (.+?) win/i.exec(m.question || '');
  return clean(match ? match[1] : m.question);
}

function ref(market, outcomeIndex) {
  return { marketId: String(market.id), outcomeIndex };
}

function footballLegs(event, base) {
  const markets = (event.markets || []).filter(
    (m) => isOpen(m) && isMoneyline(m) && isYesNo(parseArray(m.outcomes))
  );
  if (markets.length !== 3) return [];
  const draw = markets.find((m) => /draw/i.test(`${m.groupItemTitle || ''} ${m.question || ''}`));
  if (!draw) return [];
  const teams = markets.filter((m) => m !== draw);
  // Gamma lists the home side first; keep that order to match the title.
  const [home, away] = teams;
  if ([home, draw, away].some((m) => liquidity(m) < MIN_LIQUIDITY)) return [];

  const raw = [home, draw, away].map(price0);
  if (raw.some((p) => !(p > 0 && p < 1))) return [];
  const [ph, pd, pa] = devigPower(raw);
  const names = { home: teamName(home), away: teamName(away) };

  const legs = [
    {
      key: 'home',
      market: '1x2',
      label: 'Match Winner',
      selection: names.home,
      p: ph,
      settle: { won: [ref(home, 0)], lost: [ref(draw, 0), ref(away, 0)] },
    },
    {
      key: 'away',
      market: '1x2',
      label: 'Match Winner',
      selection: names.away,
      p: pa,
      settle: { won: [ref(away, 0)], lost: [ref(draw, 0), ref(home, 0)] },
    },
    {
      key: 'home_draw',
      market: 'double_chance',
      label: 'Double Chance',
      selection: `${names.home} or Draw`,
      p: ph + pd,
      settle: { won: [ref(home, 0), ref(draw, 0)], lost: [ref(away, 0)] },
    },
    {
      key: 'away_draw',
      market: 'double_chance',
      label: 'Double Chance',
      selection: `${names.away} or Draw`,
      p: pa + pd,
      settle: { won: [ref(away, 0), ref(draw, 0)], lost: [ref(home, 0)] },
    },
  ];
  return legs.map((l) => ({ ...base, ...l }));
}

function twoWayLegs(event, base) {
  const m = (event.markets || []).find((mk) => {
    const outcomes = parseArray(mk.outcomes);
    return isOpen(mk) && isMoneyline(mk) && outcomes.length === 2 && !isYesNo(outcomes);
  });
  if (!m || liquidity(m) < MIN_LIQUIDITY) return [];
  const outcomes = parseArray(m.outcomes);
  const p0raw = price0(m);
  if (!(p0raw > 0 && p0raw < 1)) return [];
  // Binary market: the two sides are one book, so there is no overround to remove.
  const ps = [p0raw, 1 - p0raw];
  const label = base.sport === 'cs2' || base.sport === 'esports_other' ? 'Match Winner' : 'Moneyline';
  return outcomes.map((name, i) => ({
    ...base,
    key: `side${i}`,
    market: 'moneyline',
    label,
    selection: clean(name),
    p: ps[i],
    settle: { won: [ref(m, i)], lost: [ref(m, 1 - i)] },
  }));
}

function eventStart(event) {
  for (const m of event.markets || []) {
    const t = parseTime(m.gameStartTime);
    if (t) return t;
  }
  return parseTime(event.startTime) || parseTime(event.eventDate) || null;
}

/**
 * Candidate legs for every event in the window, already filtered by lane
 * rules. Each leg carries p_market and fair decimal odds.
 */
export function candidateLegs(events, sportCode, window) {
  const sport = SPORTS[sportCode];
  if (!sport) return [];
  const legs = [];

  for (const event of events) {
    const start = eventStart(event);
    if (!start || start < window.start || start > window.end) continue;
    const title = event.title || '';

    if (sport.kind === 'cs2') {
      const where = `${title} ${event.seriesSlug || ''} ${event.description || ''}`;
      if (!BEST_OF_3_PLUS.test(where) || !CS2_TIER1.test(where)) continue;
    }

    const base = {
      eventId: String(event.id),
      eventSlug: event.slug || '',
      event: clean(title),
      sport: sport.kind,
      league: sport.name,
      start: start.toISOString(),
      lane: sport.kind === 'football' || sport.kind === 'cs2' ? 'core' : 'high_confidence',
    };
    const raw = sport.kind === 'football' ? footballLegs(event, base) : twoWayLegs(event, base);

    for (const leg of raw) {
      const odds = 1 / leg.p;
      const ok =
        leg.lane === 'core'
          ? odds >= CORE_ODDS.min && odds <= CORE_ODDS.max
          : leg.market === 'moneyline' && leg.p >= HC_THRESHOLD && odds >= MIN_ODDS;
      if (!ok) continue;
      legs.push({
        id: `${leg.eventId}-${leg.key}`,
        ...leg,
        p_market: round(leg.p, 4),
        // Exact fair odds drive the maths; the rounded figure is for display,
        // so rounding never shows up as a fake edge.
        odds_exact: odds,
        odds: round(odds, 2),
      });
    }
  }
  return legs;
}

export function round(x, digits = 2) {
  const f = 10 ** digits;
  return Math.round(x * f) / f;
}

function* combinations(items, size, start = 0, picked = []) {
  if (picked.length === size) {
    yield picked;
    return;
  }
  for (let i = start; i < items.length; i++) {
    picked.push(items[i]);
    yield* combinations(items, size, i + 1, picked);
    picked.pop();
  }
}

/**
 * Best combination of 2–5 legs from different events whose combined odds land
 * in the target range. Highest EV wins; within 1 point of EV, fewer legs, then
 * the higher chance of hitting.
 */
export function bestParlay(legs, range = TARGET, sizes = [2, 3, 4, 5]) {
  const pool = [...legs]
    .sort((a, b) => b.edge - a.edge || b.p_final - a.p_final)
    .slice(0, 40);

  let best = null;
  for (const size of sizes) {
    for (const combo of combinations(pool, size)) {
      if (new Set(combo.map((l) => l.eventId)).size !== combo.length) continue;
      const odds = combo.reduce((o, l) => o * l.odds_exact, 1);
      if (odds < range.min || odds > range.max) continue;
      const p = combo.reduce((q, l) => q * l.p_final, 1);
      const ev = p * odds - 1;
      const candidate = { legs: [...combo], odds, p, ev };
      if (!best || better(candidate, best)) best = candidate;
    }
  }
  return best;
}

function better(a, b) {
  if (Math.abs(a.ev - b.ev) > 0.01) return a.ev > b.ev;
  if (a.legs.length !== b.legs.length) return a.legs.length < b.legs.length;
  return a.p > b.p;
}

/** Grade and stake from the analyst rules. */
export function grade(ev) {
  if (ev >= 0) return { grade: 'VALUE', stake_units: 1 };
  if (ev >= -0.15) return { grade: 'STANDARD', stake_units: 0.5 };
  return { grade: 'WEAK', stake_units: 0 };
}

/**
 * Settles one leg from resolved markets. `resolved` maps marketId to the
 * array of final outcome prices (or null if the market is still open).
 */
export function settleLeg(leg, resolved) {
  const state = (r) => {
    const prices = resolved.get(r.marketId);
    if (!prices) return 'open';
    const p = prices[r.outcomeIndex];
    if (p >= 0.98) return 'yes';
    if (p <= 0.02) return 'no';
    if (prices.every((x) => Math.abs(x - 0.5) < 0.02)) return 'void';
    return 'open';
  };
  const won = leg.settle.won.map(state);
  const lost = leg.settle.lost.map(state);
  if (won.includes('yes')) return 'won';
  if (lost.includes('yes')) return 'lost';
  if ([...won, ...lost].includes('void')) return 'void';
  if (won.every((s) => s === 'no') && lost.every((s) => s === 'no')) return 'void';
  return null;
}

export function settleParlay(entry) {
  const results = entry.legs.map((l) => l.result);
  if (results.includes('lost')) return 'lost';
  if (results.some((r) => r === null || r === undefined)) return null;
  if (results.every((r) => r === 'void')) return 'void';
  return 'won';
}
