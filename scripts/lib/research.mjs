/**
 * The morning research (research/<date>.json, written by the Claude Code
 * research task, see research/INSTRUCTIONS.md) and how it changes the
 * market's probabilities.
 *
 * Research gives its own 1X2 probabilities for each game. They may differ
 * from the morning market by at most 5 points per outcome; at build time the
 * same shift is applied to the live market price.
 */

import { readFile } from 'node:fs/promises';

export const BOOKS = ['Stake', 'Rainbet'];
export const MAX_SHIFT = 0.05;
export const CONFIDENCE = ['high', 'medium', 'low'];
export const CHECKS = {
  team_news: 'Injuries, suspensions and doubts for both teams, from club or press-conference sources',
  lineups: 'Predicted XIs from at least two lineup sources, and whether they agree',
  rotation: 'Last and next fixture for both teams, midweek Europe or cup games, and how many changes are expected',
  motivation: 'Table position, what the game is worth, derby or rivalry, manager situation',
  form: 'Last 6–10 games for both teams: results, goals, and xG for and against; home and away split',
  h2h: 'Recent head-to-head and style matchup, especially how often it ends level',
  odds: 'Prices from at least two bookmakers or exchanges, de-vigged, and how they moved',
  models: 'Model forecasts (e.g. Opta, ClubElo, FiveThirtyEight-style, bookmaker-free models)',
  venue_weather: 'Venue, travel, pitch and weather',
};
export const LEG_KEYS = ['home', 'away', 'home_draw', 'away_draw', 'home_dnb', 'away_dnb'];
/** Result legs plus the keys extraMarkets() gives goals, BTTS, handicap and team-goals legs. */
export const isLegKey = (k) => LEG_KEYS.includes(k) || /^(ou_[\d.]+_(over|under)|btts_(yes|no)|ah_(home|away)_[+-][\d.]+|tt_(home|away)_[\d.]+_(over|under))$/.test(String(k));

export function researchPath(date) {
  return new URL(`../../research/${date}.json`, import.meta.url);
}

export function candidatesPath(date) {
  return new URL(`../../research/${date}.candidates.json`, import.meta.url);
}

async function readJson(url) {
  try {
    return JSON.parse(await readFile(url, 'utf8'));
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw new Error(`${url.pathname} is unreadable: ${e.message}`);
  }
}

function clampShift(researched, morning) {
  const out = {};
  for (const k of ['home', 'draw', 'away']) {
    const d = Number(researched?.[k]) - morning[k];
    out[k] = Number.isFinite(d) ? Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, d)) : 0;
  }
  return out;
}

/** Live probabilities plus the research shift, renormalised. */
export function applyShift(live, shift) {
  const raw = {};
  // Two-way sports have no draw; keep it at zero.
  for (const k of ['home', 'draw', 'away']) raw[k] = live[k] === 0 ? 0 : Math.min(0.97, Math.max(0.01, live[k] + shift[k]));
  const sum = raw.home + raw.draw + raw.away;
  return { home: raw.home / sum, draw: raw.draw / sum, away: raw.away / sum };
}

/**
 * { summary, researched_at, games: Map<id, verdict> } or null if there is no
 * research for the date. A game with no verdict was not researched and is
 * never bet.
 */
export async function loadResearch(date) {
  const research = await readJson(researchPath(date));
  if (!research) return null;
  const candidates = await readJson(candidatesPath(date));
  if (!candidates) throw new Error(`research/${date}.json exists but its candidates file does not`);
  if (research.date !== date || !Array.isArray(research.games)) throw new Error(`research/${date}.json has the wrong date or no games`);

  const morning = new Map(candidates.games.map((g) => [g.id, g]));
  // Research views on non-result legs ("ou_2.5_over": 0.66), each held within
  // MAX_SHIFT of that leg's morning market probability.
  const views = (v, g) => {
    const out = {};
    const legs = new Map((g.legs_in_range || []).map((l) => [l.key, l]));
    for (const [k, val] of Object.entries(v?.views || {})) {
      const leg = legs.get(k);
      const p = Number(val);
      if (!leg || LEG_KEYS.includes(k) || !Number.isFinite(p) || !Number.isFinite(leg.p_market)) continue;
      out[k] = Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, p - leg.p_market));
    }
    return out;
  };
  const games = new Map();
  for (const v of research.games) {
    const g = morning.get(String(v?.id));
    if (!g || typeof v.exclude !== 'boolean') continue;
    games.set(g.id, {
      // Only hard problems exclude a game. Low-confidence games stay in the
      // research but are never bet (see BETTABLE in pick.mjs).
      exclude: v.exclude && v.skipped !== true,
      skipped: v.skipped === true,
      confidence: CONFIDENCE.includes(v.confidence) ? v.confidence : 'low',
      morning: g.p_market,
      shift: v.exclude ? { home: 0, draw: 0, away: 0 } : clampShift(v.p, g.p_market),
      view_shift: v.exclude ? {} : views(v, g),
      reason: String(v.reason || '').slice(0, 700),
      main_risk: String(v.main_risk || '').slice(0, 300),
      checks: Object.fromEntries(Object.keys(CHECKS).map((k) => [k, String(v.checks?.[k] || '').slice(0, 400)])),
      sources: (Array.isArray(v.sources) ? v.sources : []).filter((s) => /^https?:\/\//.test(s)).slice(0, 15),
      prices: (Array.isArray(v.prices) ? v.prices : []).filter((p) => BOOKS.includes(p?.book) && isLegKey(p?.market) && Number(p.odds) >= 1.01),
    });
  }
  // "morning" (or the evening before) and "pre_kickoff" for the final check
  // about 90 minutes before the slip's first game.
  const stage = research.stage === 'pre_kickoff' ? 'pre_kickoff' : 'morning';
  return { summary: String(research.summary || '').slice(0, 800), researched_at: research.researched_at || null, stage, games };
}
