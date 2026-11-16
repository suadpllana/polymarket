/**
 * The research record: every game the daily research looked at, its final
 * rating, the market's favourite and whether the favourite won. It is built
 * on every run of scripts/daily.mjs and published as research-record.json for
 * the Stats page. Results already known are carried over from the published
 * file, so each run only looks up games that are still open.
 */

import { readdir, readFile } from 'node:fs/promises';
import { parseArray } from './polymarket.mjs';

// The record starts with the first slip the current model kept in its record.
export const RECORD_START = '2026-11-03';
// Days the owner removed from the model record (see daily.mjs).
const SKIP_DAYS = new Set(['2026-10-31', '2026-11-01', '2026-11-02']);

const RESEARCH_DIR = new URL('../../research/', import.meta.url);
const GAMMA = 'https://gamma-api.polymarket.com';
const UA = { 'User-Agent': 'Mozilla/5.0 (compatible; daily-parlay/3.0)' };

async function readJson(url) {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch {
    return null;
  }
}

async function fetchEvent(id) {
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${GAMMA}/events?id=${encodeURIComponent(id)}`, { headers: UA, signal: AbortSignal.timeout(15000) });
      if (res.ok) return (await res.json())[0] || null;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  return null;
}

function prices(m) {
  try {
    return { outcomes: parseArray(m.outcomes), p: parseArray(m.outcomePrices).map(Number) };
  } catch {
    return null;
  }
}

const SIDE_MARKET = /O\/U|Over|Under|Set |Handicap|Spread|Total|Map |Game |Completed|Half|Quarter|Period|Points|Rebounds|Assists/i;

/** 'home' | 'away' | 'draw' | 'not_played' | null (still open), from the game's resolved markets. */
export function resultFromEvent(ev, game) {
  if (!ev) return null;
  const markets = ev.markets || [];
  if (game.p_market.draw === 0) {
    const m = markets.find((x) => {
      const y = prices(x);
      return y && y.outcomes.length === 2 && !/^(Yes|No)$/i.test(y.outcomes[0]) && !SIDE_MARKET.test(x.question || '');
    });
    const y = m && prices(m);
    if (!y || m.closed !== true) return null;
    if (y.p.every((v) => v > 0.02 && v < 0.98)) return 'not_played'; // resolved 50/50: not played or not completed
    const i = y.p.findIndex((v) => v >= 0.98);
    return i === 0 ? 'home' : i === 1 ? 'away' : null;
  }
  const draw = markets.find((x) => /draw/i.test(x.question || ''));
  const wins = markets.filter((x) => /\bwin\b/i.test(x.question || '') && !/draw/i.test(x.question || ''));
  const all = [draw, ...wins].filter(Boolean);
  if (!all.length || all.some((x) => x.closed !== true)) return null;
  if (draw && prices(draw)?.p[0] >= 0.98) return 'draw';
  for (const m of wins) {
    if (!(prices(m)?.p[0] >= 0.98)) continue;
    const title = m.groupItemTitle || '';
    if (title && game.home.includes(title)) return 'home';
    if (title && game.away.includes(title)) return 'away';
    return (m.question || '').includes(game.home) ? 'home' : 'away';
  }
  if (all.every((m) => { const y = prices(m); return y && y.p[0] > 0.02 && y.p[0] < 0.98; })) return 'not_played';
  return null;
}

/** Research dates on disk, oldest first. */
async function researchDays() {
  const files = await readdir(RESEARCH_DIR).catch(() => []);
  return files
    .map((f) => /^(\d{4}-\d{2}-\d{2})\.json$/.exec(f)?.[1])
    .filter((d) => d && d >= RECORD_START && !SKIP_DAYS.has(d))
    .sort();
}

/**
 * Builds the record. `previous` is the published research-record.json (or
 * null), `history` the slip entries (for which games were on a slip and how
 * the slip legs did).
 */
export async function buildRecord(previous, history) {
  const known = new Map((previous?.games || []).filter((g) => g.result).map((g) => [`${g.date}#${g.id}`, g]));
  const slips = new Map((history || []).filter((e) => e.legs?.length).map((e) => [e.date, e]));
  const games = [];
  const todo = [];
  for (const date of await researchDays()) {
    const research = await readJson(new URL(`${date}.json`, RESEARCH_DIR));
    const candidates = await readJson(new URL(`${date}.candidates.json`, RESEARCH_DIR));
    if (!research?.games || !candidates?.games) continue;
    const byId = new Map(candidates.games.map((g) => [String(g.id), g]));
    const slip = slips.get(date);
    const onSlip = new Set((slip?.legs || []).map((l) => String(l.game_id)));
    // What was actually bet on each game: the final slip's leg, plus legs that
    // were on an earlier version of the slip and dropped at a check.
    const betsFor = (id) => {
      const finalLegs = (slip?.legs || []).filter((l) => String(l.game_id) === id);
      const finalKeys = new Set(finalLegs.map((l) => l.key));
      const out = finalLegs.map((l) => ({ selection: l.selection, label: l.label, odds: l.odds, result: l.provisional ? null : l.result || null, final: true }));
      const seen = new Set();
      for (const d of slip?.drafts || []) {
        for (const l of d.legs) {
          if (String(l.game_id) !== id || finalKeys.has(l.key) || seen.has(l.key)) continue;
          seen.add(l.key);
          out.push({ selection: l.selection, label: l.label, odds: l.odds, result: l.result || null, final: false });
        }
      }
      return out;
    };
    for (const v of research.games) {
      if (v.skipped) continue;
      const g = byId.get(String(v.id));
      if (!g?.p_market) continue;
      const fav = g.p_market.home >= g.p_market.away ? 'home' : 'away';
      const row = {
        date,
        id: String(g.id),
        event: g.event,
        sport: g.sport || null,
        league: g.league || null,
        start: g.start,
        favourite: fav === 'home' ? g.home : g.away,
        fav_side: fav,
        fav_p: Math.round(g.p_market[fav] * 1000) / 1000,
        rating: v.exclude ? 'excluded' : ['high', 'medium', 'low'].includes(v.confidence) ? v.confidence : 'low',
        on_slip: onSlip.has(String(g.id)),
        bets: betsFor(String(g.id)),
        result: null,
        winner: null,
      };
      const prev = known.get(`${date}#${row.id}`);
      if (prev) {
        row.result = prev.result;
        row.winner = prev.winner;
      } else if (new Date(g.start).getTime() < Date.now()) todo.push({ row, game: g });
      games.push(row);
    }
  }
  // Look up the games that have started and are not settled yet, four at a time.
  for (let i = 0; i < todo.length; i += 4) {
    await Promise.all(
      todo.slice(i, i + 4).map(async ({ row, game }) => {
        const side = resultFromEvent(await fetchEvent(game.id), game);
        if (!side) return;
        if (side === 'not_played') row.result = 'not_played';
        else if (side === 'draw') row.result = 'draw';
        else row.result = side === row.fav_side ? 'fav_won' : 'fav_lost';
        row.winner = side === 'home' ? game.home : side === 'away' ? game.away : null;
      })
    );
  }
  // Slip legs: how the legs actually bet did (a leg is not always the favourite
  // to win), and how the legs dropped at a check would have done.
  const legs = { won: 0, void: 0, lost: 0 };
  const dropped = { won: 0, void: 0, lost: 0 };
  for (const [date, e] of slips) {
    if (date < RECORD_START || SKIP_DAYS.has(date)) continue;
    for (const l of e.legs) if (l.result && !l.provisional && legs[l.result] !== undefined) legs[l.result]++;
  }
  for (const g of games) for (const b of g.bets) if (!b.final && b.result && dropped[b.result] !== undefined) dropped[b.result]++;
  return { updated_at: new Date().toISOString(), start: RECORD_START, legs, dropped, games };
}
