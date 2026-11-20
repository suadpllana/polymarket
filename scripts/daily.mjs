/**
 * Daily job, run by GitHub Actions before each Pages deploy:
 *   1. load the published history.json from the live site
 *   2. settle open slips from resolved Polymarket markets
 *   3. once the morning research is in, build today's slip (one to three
 *      medium/high confidence legs) from live Polymarket prices plus the research
 *   4. write public/history.json for the site to ship
 *
 * Usage: node scripts/daily.mjs                     (CI; needs SITE_URL)
 *        node scripts/daily.mjs --dry               (print today's slip, write nothing)
 *        node scripts/daily.mjs --dry --tomorrow    (print tomorrow's slip from
 *                                                    tomorrow's research)
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { SLIP, gatherGames, round } from './lib/football.mjs';
import { fetchMarket, parseArray } from './lib/polymarket.mjs';
import { BETTABLE, HIGH_ONLY, TIER_NOTE, describe, driftProblem, pickSlip } from './lib/pick.mjs';
import { loadResearch } from './lib/research.mjs';
import { buildRecord } from './lib/record.mjs';
import { TIMEZONE, bettingWindow, localDate, tomorrowWindow, zonedParts } from './lib/time.mjs';

// Until this hour the build waits for the morning research; after it, a day
// without research is "No bet" (market-only legs are never used).
const RESEARCH_DEADLINE_HOUR = 12;

// Slips taken out of the record at the owner's request (14 Nov 2026): they
// were picked by an early version of the model.
const REMOVED_DATES = new Set(['2026-10-31', '2026-11-01', '2026-11-02']);

// Slips the owner asked to show as won before their last game had finished.
// The mark is provisional: as soon as the markets resolve, the real result
// replaces it (see settleOpen), so the record cannot stay wrong.
const EARLY_WON = new Set(['2026-11-15', '2026-11-16', '2026-11-18', '2026-11-19']);

function markEarlyWon(entries) {
  for (const e of entries) {
    if (!EARLY_WON.has(e.date) || !e.legs?.length || e.result) continue;
    for (const l of e.legs) {
      if (!l.result) {
        l.result = 'won';
        l.provisional = true;
      }
    }
    e.result = 'won';
    e.provisional = true;
    e.settled_odds = round(e.legs.reduce((o, l) => o * (l.result === 'won' ? l.odds : 1), 1), 2);
    console.log(`Marked ${e.date} as won early (provisional until the markets resolve).`);
  }
}

// Slips the owner asked to show as lost before every market had closed: the
// game ids of legs already known to have lost. Provisional like EARLY_WON.
const EARLY_LOST = { '2026-11-20': ['1329693'] }; // Bayern 1-1 Köln: Bayern over 2.5 goals lost

function markEarlyLost(entries) {
  for (const e of entries) {
    const ids = EARLY_LOST[e.date];
    if (!ids || !e.legs?.length || e.result) continue;
    for (const l of e.legs) {
      if (!l.result && ids.includes(String(l.game_id))) {
        l.result = 'lost';
        l.provisional = true;
      }
    }
    e.result = 'lost';
    e.provisional = true;
    e.settled_odds = null;
    console.log(`Marked ${e.date} as lost early (provisional until the markets resolve).`);
  }
}

const OUT = new URL('../public/history.json', import.meta.url);
const RECORD_OUT = new URL('../public/research-record.json', import.meta.url);

/** The published research record, or null (a first run, or the site is unreachable). */
async function loadRecord(siteUrl) {
  if (!siteUrl) return null;
  try {
    const res = await fetch(new URL('research-record.json', siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`), { cache: 'no-store' });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
const DRY = process.argv.includes('--dry');
const TOMORROW = process.argv.includes('--tomorrow');

async function loadHistory(siteUrl) {
  if (!siteUrl) return { entries: [] };
  const url = new URL('history.json', siteUrl.endsWith('/') ? siteUrl : `${siteUrl}/`);
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status === 404) {
    console.log(`No published history at ${url}; starting fresh.`);
    return { entries: [] };
  }
  // Anything else unexpected must stop the run: overwriting history with an
  // empty list would erase the track record.
  if (!res.ok) throw new Error(`Could not load ${url}: HTTP ${res.status}`);
  const data = await res.json();
  // Slips from the old multi-sport model are not carried over.
  return { entries: (Array.isArray(data.entries) ? data.entries : []).filter((e) => e.model === 'football-2leg' && !REMOVED_DATES.has(e.date)) };
}

function settleLeg(leg, resolved) {
  // A ref is a market id (its "Yes" outcome) or "id#index" for a named outcome
  // such as Over/Under or a handicap side.
  const yes = (ref) => {
    const [id, idx = '0'] = String(ref).split('#');
    const prices = resolved.get(id);
    if (!prices) return null;
    const p = prices[Number(idx)];
    if (p >= 0.98) return true;
    if (p <= 0.02) return false;
    return null;
  };
  const any = (ids) => ids.some((id) => yes(id) === true);
  if (any(leg.settle.won)) return 'won';
  if (any(leg.settle.void)) return 'void';
  if (any(leg.settle.lost)) return 'lost';
  return null;
}

async function settleOpen(entries) {
  // A leg or slip marked early (provisional) is still open until its market resolves.
  const pending = (l) => !l.result || l.provisional;
  const open = entries.filter((e) => e.legs?.length && (!e.result || e.provisional));
  // Draft legs (earlier versions of a slip) are settled too, for the record.
  const draftLegs = entries.flatMap((e) => (e.drafts || []).flatMap((d) => d.legs)).filter((l) => !l.result && l.settle);
  const refIds = (l) => [...l.settle.won, ...l.settle.void, ...l.settle.lost].map((r) => String(r).split('#')[0]);
  const ids = new Set([...open.flatMap((e) => e.legs.filter(pending).flatMap(refIds)), ...draftLegs.flatMap(refIds)]);
  const resolved = new Map();
  for (const id of ids) {
    try {
      const m = await fetchMarket(id);
      if (m?.closed === true) resolved.set(id, parseArray(m.outcomePrices).map(Number));
    } catch (e) {
      console.warn(`Market ${id} lookup failed: ${e.message}`);
    }
  }
  for (const l of draftLegs) l.result = settleLeg(l, resolved);
  for (const e of open) {
    for (const leg of e.legs) {
      if (!pending(leg)) continue;
      const r = settleLeg(leg, resolved);
      if (r) {
        leg.result = r;
        delete leg.provisional;
      } else if (!leg.provisional) leg.result = null;
    }
    // The real result counts only legs whose market has resolved.
    const rs = e.legs.map((l) => (l.provisional ? null : l.result));
    let real;
    if (rs.includes('lost')) real = 'lost';
    else if (rs.some((r) => !r)) real = null;
    else if (rs.every((r) => r === 'void')) real = 'void';
    else real = 'won';
    if (real) {
      e.result = real;
      delete e.provisional;
      for (const leg of e.legs) {
        if (leg.provisional) {
          leg.result = null;
          delete leg.provisional;
        }
      }
      e.settled_odds = e.result === 'lost' ? 0 : round(e.legs.reduce((o, l) => o * (l.result === 'won' ? l.odds : 1), 1), 2);
      console.log(`Settled ${e.date}: ${e.result}`);
    } else if (!e.provisional) e.result = null;
  }
}

function noBet(date, reason, extra = {}) {
  return { model: 'football-2leg', date, generated_at: new Date().toISOString(), no_bet: true, reason, legs: [], result: null, ...extra };
}

async function buildToday(date, { force = false, window = bettingWindow(), lookaheadAllowed = true, games: gathered = null } = {}) {
  const research = await loadResearch(date);
  if (!research && !force && zonedParts(new Date()).hour < RESEARCH_DEADLINE_HOUR) {
    throw new Error(`no research for ${date} yet`);
  }
  let games = gathered || (await gatherGames(window));
  let { slip, tier, skipped, faded } = pickSlip(games, research);
  // Nothing usable left before 23:00 today: take tomorrow's games (09:00 to
  // 23:00), so the day still has a slip.
  let lookahead = false;
  if (!slip && lookaheadAllowed) {
    console.log('No slip before 23:00 today; using tomorrow’s games.');
    games = await gatherGames(tomorrowWindow());
    ({ slip, tier, skipped, faded } = pickSlip(games, research));
    lookahead = Boolean(slip);
  }
  skipped.forEach((x) => console.log(`Skipped: ${x}`));
  faded.forEach((x) => console.log(`Leg dropped: ${x}`));
  const kept = research ? [...research.games.values()].filter((v) => !v.exclude && !v.skipped).length : 0;
  const base = {
    summary: research?.summary || 'The morning research did not arrive, so there is no researched slip today.',
    researched_at: research?.researched_at || null,
    research_stage: research?.stage || null,
    researched_games: research?.games.size || 0,
    kept_games: kept,
    skipped,
  };
  // Only medium/high confidence legs are bet; skipping a day beats a weak slip.
  if (!slip) {
    // Any eligible leg makes a slip (see closestSlip), so this only happens
    // when no game still to start passed the research and the price checks.
    const reason = research
      ? 'No game still to start today has a researched leg rated medium or high confidence that also passed the price checks. Low-confidence and market-only legs are never used; more games are being researched.'
      : 'The research for today has not arrived yet.';
    return noBet(date, reason, base);
  }

  console.log(`Tier: ${tier}`);
  console.log(describe(slip));
  const legsOut = slip.legs
    .sort((a, b) => a.game.start.localeCompare(b.game.start))
    .map((l) => ({
      game_id: l.game.id,
      league: l.game.league,
      extended: Boolean(l.game.extended),
      event: l.game.event,
      sport: l.game.sport || null,
      home: l.game.home,
      away: l.game.away,
      start: l.game.start,
      key: l.key,
      label: l.label,
      selection: l.selection,
      p_market: l.game.p_market,
      p: { home: round(l.p.home, 4), draw: round(l.p.draw, 4), away: round(l.p.away, 4) },
      p_win: round(l.p_win, 4),
      p_void: round(l.p_void, 4),
      fair_odds: l.fair_odds,
      odds: l.odds,
      book: l.book,
      confidence: l.verdict.confidence,
      reason: l.verdict.reason,
      main_risk: l.verdict.main_risk,
      checks: l.verdict.checks,
      sources: l.verdict.sources,
      // Result legs settle on the game's 1X2 markets; the others carry their
      // own "marketId#outcome" refs.
      settle: l.settle || {
        won: l.won.map((k) => l.game.refs[k]),
        void: l.void.map((k) => l.game.refs[k]),
        lost: l.lost.map((k) => l.game.refs[k]),
      },
      result: null,
    }));
  const earliest = new Date(legsOut[0].start);
  return {
    model: 'football-2leg',
    date,
    generated_at: new Date().toISOString(),
    ...base,
    tier,
    tier_note: [
      TIER_NOTE[tier],
      legsOut.some((l) => l.extended)
        ? 'Few games in the usual leagues today (often an international break), so this slip uses games from other competitions.'
        : '',
      lookahead ? 'Nothing usable was left before 23:00 today, so this slip uses tomorrow’s games; check the kick-off times.' : '',
    ]
      .filter(Boolean)
      .join(' '),
    target_odds: SLIP.target,
    odds: round(legsOut.reduce((o, l) => o * l.odds, 1), 2),
    p_hit: round(slip.p_hit, 4),
    ev: round(slip.ev, 4),
    place_before: new Date(earliest.getTime() - 15 * 60 * 1000).toISOString(),
    legs: legsOut,
    result: null,
    settled_odds: null,
  };
}

/** A leg as kept in a draft: enough to show it and to settle it later. */
const draftLeg = (l) => ({ game_id: l.game_id, event: l.event, key: l.key, label: l.label, selection: l.selection, odds: l.odds, settle: l.settle, result: l.result || null });
const legSet = (e) => (e.legs || []).map((l) => `${l.game_id}#${l.key}`).sort().join(',');

/**
 * When a published slip is replaced, its legs are kept as a draft so the
 * record can show what was on the site before the final check and how those
 * legs would have done.
 */
function keepDrafts(existing, entry) {
  const drafts = [...(existing.drafts || [])];
  if (!existing.no_bet && existing.legs?.length && legSet(existing) !== legSet(entry)) {
    drafts.push({ built_at: existing.generated_at, stage: existing.research_stage || 'morning', legs: existing.legs.map(draftLeg) });
  }
  if (drafts.length) entry.drafts = drafts;
  if (existing.drafts_backfilled) entry.drafts_backfilled = true;
}

// Slips shown on the site before the final check, from before drafts were
// recorded (13–15 Nov 2026). Results are from the final scores: Scotland 2-1
// North Macedonia, Slovenia 0-0 Switzerland, Portugal 1-4 Denmark, Austria 1-0
// Ireland, Norway 3-1 Wales, Sweden 3-2 Bosnia, Browns 27-24 Texans,
// Raiders 13-21 Seahawks.
const BACKFILL_DRAFTS = {
  '2026-11-13': [
    { built_at: '2026-11-13T06:57:22Z', stage: 'morning', legs: [
      { game_id: '1287687', event: 'Scotland vs. North Macedonia', key: 'tt_away_0.5_under', label: 'North Macedonia goals', selection: 'Under 0.5', odds: 1.47, result: 'lost' },
      { game_id: '1287697', event: 'Slovenia vs. Switzerland', key: 'away_dnb', label: 'Draw no bet', selection: 'Switzerland', odds: 1.27, result: 'void' },
    ] },
  ],
  '2026-11-14': [
    { built_at: '2026-11-13T21:53:00Z', stage: 'morning', legs: [
      { game_id: '1294227', event: 'Portugal vs. Denmark', key: 'tt_away_0.5_over', label: 'Denmark goals', selection: 'Over 0.5', odds: 1.5, result: 'won' },
      { game_id: '1294232', event: 'Austria vs. Republic of Ireland', key: 'home_dnb', label: 'Draw no bet', selection: 'Austria', odds: 1.25, result: 'won' },
    ] },
    { built_at: '2026-11-14T06:56:20Z', stage: 'morning', legs: [
      { game_id: '1294222', event: 'Norway vs. Wales', key: 'ah_away_+2.5', label: 'Handicap', selection: 'Wales +2.5', odds: 1.52, result: 'won' },
      { game_id: '1294232', event: 'Austria vs. Republic of Ireland', key: 'home_dnb', label: 'Draw no bet', selection: 'Austria', odds: 1.25, result: 'won' },
    ] },
    { built_at: '2026-11-14T15:59:00Z', stage: 'morning', legs: [
      { game_id: '1294232', event: 'Austria vs. Republic of Ireland', key: 'home_dnb', label: 'Draw no bet', selection: 'Austria', odds: 1.25, result: 'won' },
      { game_id: '1294242', event: 'Sweden vs. Bosnia and Herzegovina', key: 'ou_3.5_under', label: 'Total goals', selection: 'Under 3.5', odds: 1.48, result: 'lost' },
    ] },
  ],
  '2026-11-15': [
    { built_at: '2026-11-14T22:22:30Z', stage: 'morning', legs: [
      { game_id: '1258842', event: 'Texans vs. Browns', key: 'home', label: 'Moneyline', selection: 'Texans', odds: 1.44, result: 'lost' },
      { game_id: '1258848', event: 'Seahawks vs. Raiders', key: 'home', label: 'Moneyline', selection: 'Seahawks', odds: 1.34, result: 'won' },
    ] },
  ],
};

function backfillDrafts(entries) {
  for (const e of entries) {
    const add = BACKFILL_DRAFTS[e.date];
    if (!add || e.drafts_backfilled) continue;
    e.drafts = [...add, ...(e.drafts || [])];
    e.drafts_backfilled = true;
  }
}

/**
 * Builds or rebuilds one day's entry. A real slip is final for the day; a
 * "No bet" is retried on every run, so games added later (or a late research
 * push) can still produce a slip.
 */
async function updateDay(history, day, opts) {
  const existing = history.entries.find((e) => e.date === day);
  const research = existing && !existing.no_bet ? await loadResearch(day) : null;
  // A slip with a leg that may not be bet (low confidence, market-only, or
  // downgraded by newer research) is always rebuilt, even into "No bet".
  const unbettable =
    existing &&
    !existing.no_bet &&
    existing.legs.some((l) => {
      if (!BETTABLE.includes(l.confidence)) return true;
      const v = research?.games.get(String(l.game_id));
      return Boolean(v && (v.exclude || v.skipped || !BETTABLE.includes(v.confidence) || (HIGH_ONLY.has(l.sport) && v.confidence !== 'high')));
    });
  // A slip that can still be placed is checked against the live prices on
  // every run: if the market has moved against one of its games (see
  // driftProblem), the slip is rebuilt without that game, even into "No bet".
  let games = null;
  let faded = null;
  if (existing && !existing.no_bet && !unbettable && research && Date.now() < new Date(existing.place_before).getTime()) {
    try {
      games = await gatherGames(opts.window || bettingWindow());
      for (const l of existing.legs) {
        const g = games.find((x) => x.id === String(l.game_id));
        const v = research.games.get(String(l.game_id));
        const problem = g && v ? driftProblem(g, v) : null;
        if (problem) faded = `${l.event}: ${problem}`;
      }
    } catch (e) {
      console.warn(`Could not re-check the ${day} slip against live prices: ${e.message}`);
      games = null;
    }
  }
  // Research pushed again after the slip was built may improve it, as long as
  // none of its games is about to start.
  const upgradable =
    existing &&
    !existing.no_bet &&
    research?.researched_at &&
    research.researched_at !== existing.researched_at &&
    Date.now() < new Date(existing.place_before).getTime() - 15 * 60 * 1000;
  if (existing && !existing.no_bet && !unbettable && !faded && !upgradable) {
    console.log(`Slip for ${day} already exists.`);
    return;
  }
  try {
    const entry = await buildToday(day, { ...opts, games });
    if (!existing) history.entries.push(entry);
    else if (!entry.no_bet || unbettable || faded) {
      keepDrafts(existing, entry);
      history.entries[history.entries.indexOf(existing)] = entry;
      if (unbettable) console.log(`Replaced a ${day} slip that had a leg below medium confidence.`);
      else if (faded) console.log(`Replaced the ${day} slip: ${faded}.`);
      else if (upgradable) console.log(`Rebuilt the ${day} slip from the newer research.`);
    } else console.log(`Still no bet for ${day}.`);
  } catch (e) {
    console.warn(`No slip for ${day} this run: ${e.message}`);
  }
}

async function main() {
  const today = localDate();
  if (DRY) {
    const window = TOMORROW ? tomorrowWindow() : bettingWindow();
    const day = TOMORROW ? localDate(window.start) : today;
    const entry = await buildToday(day, { force: true, window, lookaheadAllowed: !TOMORROW });
    if (entry.no_bet) console.log(`No bet: ${entry.reason}`);
    return;
  }
  const history = await loadHistory(process.env.SITE_URL);
  backfillDrafts(history.entries);
  markEarlyWon(history.entries);
  markEarlyLost(history.entries);
  await settleOpen(history.entries);

  // Today, and tomorrow as soon as its research is pushed (research done the
  // evening before), so the slip shows without waiting for a run after midnight.
  await updateDay(history, today, {});
  const tomorrowWin = tomorrowWindow();
  const tomorrow = localDate(tomorrowWin.start);
  if (await loadResearch(tomorrow).catch(() => null)) await updateDay(history, tomorrow, { window: tomorrowWin, lookaheadAllowed: false });

  history.entries.sort((a, b) => b.date.localeCompare(a.date));
  const out = { updated_at: new Date().toISOString(), timezone: TIMEZONE, entries: history.entries.slice(0, 400) };
  await mkdir(new URL('.', OUT), { recursive: true });
  await writeFile(OUT, `${JSON.stringify(out, null, 2)}\n`);
  console.log(`Wrote ${out.entries.length} entries.`);

  // The research record for the Stats page. A failure here must not stop the
  // slip from being published, so it is logged and skipped.
  try {
    const record = await buildRecord(await loadRecord(process.env.SITE_URL), history.entries);
    await writeFile(RECORD_OUT, `${JSON.stringify(record)}\n`);
    const settled = record.games.filter((g) => g.result && g.result !== 'not_played').length;
    console.log(`Wrote the research record: ${record.games.length} games, ${settled} settled.`);
  } catch (e) {
    console.warn(`Research record not updated: ${e.message}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
