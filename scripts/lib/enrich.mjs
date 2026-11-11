/**
 * Facts the research agents kept failing to fetch, gathered once by
 * `npm run candidates` and stored on each candidate as `data`:
 *   - odds:   DraftKings prices from ESPN's public scoreboard (football,
 *             NBA, NHL, NFL, MLB), with the opening line and a de-vigged
 *             probability per side
 *   - move:   the favourite's Polymarket price 24 hours ago and now
 *   - rating: a bookmaker-free model, Tennis Abstract Elo for tennis and
 *             eloratings.net for national football teams
 * Every source is optional: a failure leaves that field out and never stops
 * the candidates run.
 */

import { fetchMarket, parseArray } from './polymarket.mjs';

const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' };

async function get(url, as = 'json') {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return as === 'json' ? res.json() : res.text();
}

const memo = new Map();
function once(key, fn) {
  if (!memo.has(key)) memo.set(key, fn().catch(() => null));
  return memo.get(key);
}

// --- names -------------------------------------------------------------------

const STOP = new Set(['fc', 'cf', 'afc', 'sc', 'ac', 'as', 'ss', 'us', 'cd', 'club', 'de', 'the', 'sv', 'fk', 'bk', 'nk', 'hc', 'bc', 'kk', 'sk', 'calcio', 'basket', 'basketball', 'team', 'esports', 'and', 'of', 'cp', 'sl', 'ca', 'rc', 'cb', 'bv', 'vfb', 'vfl', 'tsg', 'ogc', 'osc', 'aj', 'sad']);

export function nameTokens(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&nbsp;/g, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !STOP.has(t) && !/^\d+$/.test(t));
}

/** 0..1: how alike two team or player names are. */
export function nameScore(a, b) {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  if (ta.join(' ') === tb.join(' ')) return 1;
  const sb = new Set(tb);
  const shared = ta.filter((t) => sb.has(t) || (t.length >= 5 && tb.some((u) => u.length >= 5 && (u.startsWith(t) || t.startsWith(u)))));
  return shared.length / Math.max(ta.length, tb.length);
}

// --- odds ----------------------------------------------------------------------

const ESPN_FOOTBALL = {
  'Premier League': 'eng.1',
  'La Liga': 'esp.1',
  'Serie A': 'ita.1',
  Bundesliga: 'ger.1',
  'Ligue 1': 'fra.1',
  'Champions League': 'uefa.champions',
  'Europa League': 'uefa.europa',
  'Conference League': 'uefa.europa.conf',
  Eredivisie: 'ned.1',
  'Primeira Liga': 'por.1',
  'Süper Lig': 'tur.1',
  'Saudi Pro League': 'ksa.1',
  'Belgian Pro League': 'bel.1',
  Brasileirão: 'bra.1',
  'Nations League': 'uefa.nations',
};
const ESPN_OTHER = { NBA: 'basketball/nba', NHL: 'hockey/nhl', NFL: 'football/nfl', MLB: 'baseball/mlb' };

function espnPath(g) {
  if (g.sport === 'football') return ESPN_FOOTBALL[g.league] ? `soccer/${ESPN_FOOTBALL[g.league]}` : null;
  return ESPN_OTHER[g.league] || null;
}

/** ESPN's scoreboard day follows US Eastern time. */
function espnDay(iso) {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return p.replaceAll('-', '');
}

function american(x) {
  const n = Number(String(x ?? '').replace('+', ''));
  if (!Number.isFinite(n) || n === 0 || Math.abs(n) < 100) return null;
  return n > 0 ? 1 + n / 100 : 1 + 100 / -n;
}

function devig(odds) {
  const inv = odds.map((o) => (o ? 1 / o : 0));
  const s = inv.reduce((a, b) => a + b, 0);
  return s ? inv.map((x) => Math.round((x / s) * 1000) / 1000) : null;
}

const r2 = (x) => (x == null ? null : Math.round(x * 100) / 100);

async function espnOdds(g) {
  const path = espnPath(g);
  if (!path) return null;
  const day = espnDay(g.start);
  const board = await once(`espn:${path}:${day}`, () => get(`https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${day}`));
  if (!board?.events) return null;
  let best = null;
  for (const e of board.events) {
    const comp = e.competitions?.[0];
    const teams = comp?.competitors || [];
    const h = teams.find((c) => c.homeAway === 'home');
    const a = teams.find((c) => c.homeAway === 'away');
    if (!h || !a) continue;
    const hn = h.team?.displayName || h.team?.name;
    const an = a.team?.displayName || a.team?.name;
    // Polymarket's home side is sometimes ESPN's away side (neutral venues).
    const same = Math.min(nameScore(g.home, hn), nameScore(g.away, an));
    const swapped = Math.min(nameScore(g.home, an), nameScore(g.away, hn));
    const score = Math.max(same, swapped);
    if (score >= 0.5 && (!best || score > best.score)) best = { score, comp, swapped: swapped > same, espnHome: hn, espnAway: an };
  }
  const o = best?.comp?.odds?.[0];
  if (!o) return null;
  const ml = o.moneyline || {};
  const side = (k, when) => american(ml[k]?.[when]?.odds ?? (when === 'close' ? o[`${k}TeamOdds`]?.moneyLine : null));
  const drawClose = american(ml.draw?.close?.odds ?? o.drawOdds?.moneyLine);
  const drawOpen = american(ml.draw?.open?.odds);
  let close = { home: side('home', 'close'), draw: drawClose, away: side('away', 'close') };
  let open = { home: side('home', 'open'), draw: drawOpen, away: side('away', 'open') };
  if (best.swapped) {
    close = { home: close.away, draw: close.draw, away: close.home };
    open = { home: open.away, draw: open.draw, away: open.home };
  }
  if (!close.home || !close.away) return null;
  const twoWay = g.p_market.draw === 0;
  const p = devig(twoWay ? [close.home, close.away] : [close.home, close.draw, close.away]);
  return {
    book: o.provider?.name || 'DraftKings',
    source: `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${day}`,
    espn_match: `${best.espnAway} at ${best.espnHome}`,
    decimal: { home: r2(close.home), draw: twoWay ? null : r2(close.draw), away: r2(close.away) },
    opening: open.home ? { home: r2(open.home), draw: twoWay ? null : r2(open.draw), away: r2(open.away) } : null,
    p_devig: p ? (twoWay ? { home: p[0], draw: 0, away: p[1] } : { home: p[0], draw: p[1], away: p[2] }) : null,
    total: o.overUnder ?? null,
  };
}

// --- Polymarket 24h move ----------------------------------------------------------

async function move24h(g) {
  const fav = g.p_market.home >= g.p_market.away ? 'home' : 'away';
  const ref = g.twoWay ? g.refs?.market : g.refs?.[fav];
  if (!ref) return null;
  const m = await fetchMarket(ref);
  const tokens = parseArray(m?.clobTokenIds);
  const token = g.twoWay ? tokens[fav === 'home' ? 0 : 1] : tokens[0];
  if (!token) return null;
  const h = await get(`https://clob.polymarket.com/prices-history?market=${encodeURIComponent(token)}&interval=1d&fidelity=60`);
  const pts = (h?.history || []).filter((x) => Number.isFinite(Number(x.p)));
  if (pts.length < 2) return null;
  const from = Number(pts[0].p);
  const to = Number(pts[pts.length - 1].p);
  return { side: fav, from: r2(from * 100) / 100, to: r2(to * 100) / 100, relative_change: from ? Math.round(((to - from) / from) * 1000) / 1000 : null };
}

// --- ratings ---------------------------------------------------------------------

const elo = (a, b) => Math.round((1 / (1 + 10 ** (-(a - b) / 400))) * 1000) / 1000;

async function tennisTable(tour) {
  return once(`ta:${tour}`, async () => {
    const html = await get(`https://tennisabstract.com/reports/${tour}_elo_ratings.html`, 'text');
    const rows = new Map();
    for (const tr of html.split('<tr').slice(1)) {
      const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim());
      if (cells.length < 11 || !cells[1]) continue;
      const overall = Number(cells[3]);
      const hard = Number(cells[6]);
      if (Number.isFinite(overall)) rows.set(cells[1], { overall, hard: Number.isFinite(hard) ? hard : null, clay: Number(cells[8]) || null, grass: Number(cells[10]) || null });
    }
    return rows;
  });
}

function findPlayer(rows, name) {
  let best = null;
  for (const [n, r] of rows) {
    const s = nameScore(name, n);
    if (s > (best?.s || 0)) best = { s, n, r };
  }
  return best && best.s >= 0.66 ? best : null;
}

async function tennisRating(g) {
  const tour = /WTA/i.test(g.league) ? 'wta' : 'atp';
  const rows = await tennisTable(tour);
  if (!rows) return null;
  const a = findPlayer(rows, g.home);
  const b = findPlayer(rows, g.away);
  if (!a || !b) return null;
  // Tennis Abstract blends surface and overall Elo half and half; November is the hard-court season.
  const blend = (x) => (x.r.hard ? (x.r.overall + x.r.hard) / 2 : x.r.overall);
  return {
    model: 'Tennis Abstract Elo',
    source: `https://tennisabstract.com/reports/${tour}_elo_ratings.html`,
    home: { name: a.n, elo: a.r.overall, hard_elo: a.r.hard },
    away: { name: b.n, elo: b.r.overall, hard_elo: b.r.hard },
    p_home: { overall: elo(a.r.overall, b.r.overall), hard: a.r.hard && b.r.hard ? elo(a.r.hard, b.r.hard) : null, blend_hard: elo(blend(a), blend(b)) },
  };
}

async function nationsTable() {
  return once('eloratings', async () => {
    const [world, names] = await Promise.all([get('https://www.eloratings.net/World.tsv', 'text'), get('https://www.eloratings.net/en.teams.tsv', 'text')]);
    const byCode = new Map();
    for (const line of world.split('\n')) {
      const c = line.split('\t');
      if (c.length > 3 && Number(c[3])) byCode.set(c[2], Number(c[3]));
    }
    const out = [];
    for (const line of names.split('\n')) {
      const [code, ...alias] = line.split('\t').map((x) => x.trim());
      if (byCode.has(code)) out.push({ code, names: alias.filter(Boolean), rating: byCode.get(code) });
    }
    return out;
  });
}

async function nationsRating(g) {
  const table = await nationsTable();
  if (!table) return null;
  const find = (n) => {
    let best = null;
    for (const t of table) for (const alias of t.names) {
      const s = nameScore(n, alias);
      if (s > (best?.s || 0)) best = { s, t };
    }
    return best && best.s >= 0.99 ? best.t : null;
  };
  const a = find(g.home);
  const b = find(g.away);
  if (!a || !b) return null;
  // eloratings.net gives the home side 100 points; the result is an expected score (a draw counts half), not a win chance.
  return {
    model: 'World Football Elo (eloratings.net)',
    source: 'https://www.eloratings.net/',
    home: { name: a.names[0], elo: a.rating },
    away: { name: b.names[0], elo: b.rating },
    expected_score_home: elo(a.rating + 100, b.rating),
  };
}

async function rating(g) {
  if (g.sport === 'tennis') return tennisRating(g);
  if (g.sport === 'football' && g.league === 'Nations League') return nationsRating(g);
  return null;
}

// --- public ----------------------------------------------------------------------

/** Everything we could gather for one game; missing sources are left out. */
export async function gameData(g) {
  const [odds, move, model] = await Promise.all([espnOdds(g).catch(() => null), move24h(g).catch(() => null), rating(g).catch(() => null)]);
  const out = {};
  if (odds) out.odds = odds;
  if (move) out.move_24h = move;
  if (model) out.rating = model;
  return out;
}
