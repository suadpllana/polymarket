/**
 * Weekly review of the research record: which groups of games (rating,
 * sport, favourite's price, kind of leg) are doing better or worse than their
 * market odds. Prints a report; changes nothing.
 *
 * Usage: node scripts/review.mjs            (the published record)
 *        node scripts/review.mjs --local    (public/research-record.json)
 */

import { readFile } from 'node:fs/promises';

const SITE = 'https://suadpllana.github.io/polymarket/research-record.json';
// A group needs this many settled games before a rule may change because of it.
const MIN_GAMES = 30;
// How far below its market odds a group must be to count as weak.
const WEAK_GAP = 0.05;

async function load() {
  if (process.argv.includes('--local')) return JSON.parse(await readFile(new URL('../public/research-record.json', import.meta.url), 'utf8'));
  const res = await fetch(`${SITE}?t=${Date.now()}`, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; daily-parlay/3.0)' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${SITE}`);
  return res.json();
}

const sportOf = (g) => {
  const s = `${g.sport || ''} ${g.league || ''} ${g.event}`;
  if (/tennis|ATP|WTA/i.test(s)) return 'tennis';
  if (/american_football|NFL/i.test(s)) return 'NFL';
  if (/basketball|NBA|EuroLeague|EuroCup/i.test(s)) return 'basketball';
  if (/ice_hockey|NHL|KHL|SHL|Liiga/i.test(s)) return 'ice hockey';
  if (/esports|Counter-Strike|LoL|Dota|Valorant/i.test(s)) return 'esports';
  return 'football';
};
const band = (p) => (p < 0.6 ? 'under 60%' : p < 0.7 ? '60-70%' : p < 0.8 ? '70-80%' : '80% or more');
const legKind = (b) => {
  const l = `${b.label} ${b.selection}`;
  if (/Draw no bet/i.test(l)) return 'draw no bet';
  if (/Double chance/i.test(l)) return 'double chance';
  if (/Handicap/i.test(l)) return 'handicap';
  if (/goals/i.test(b.label) && !/Total/i.test(b.label)) return "a team's goals";
  if (/Total goals|Over|Under/i.test(l)) return 'total goals';
  if (/both teams/i.test(l)) return 'both teams to score';
  return 'to win';
};

function line(name, rows, hit, expected) {
  const n = rows.length;
  if (!n) return null;
  const rate = rows.filter(hit).length / n;
  const exp = rows.reduce((a, r) => a + expected(r), 0) / n;
  const gap = rate - exp;
  const verdict = n < MIN_GAMES ? `too few to act on (${n}/${MIN_GAMES})` : gap <= -WEAK_GAP ? 'WEAK: tighten' : gap >= WEAK_GAP ? 'strong' : 'in line with the odds';
  return `  ${name.padEnd(22)} ${String(n).padStart(4)}   ${(rate * 100).toFixed(0).padStart(3)}%   market ${(exp * 100).toFixed(0).padStart(3)}%   ${gap >= 0 ? '+' : ''}${(gap * 100).toFixed(0)} pts   ${verdict}`;
}

function section(title, groups, hit, expected) {
  console.log(`\n${title}`);
  console.log('  group                   games   hit    expected      gap      verdict');
  for (const [name, rows] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    const l = line(name, rows, hit, expected);
    if (l) console.log(l);
  }
}

const group = (rows, key) => {
  const m = new Map();
  for (const r of rows) {
    const k = key(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};

const record = await load();
const games = record.games.filter((g) => ['fav_won', 'fav_lost', 'draw'].includes(g.result));
const favWon = (g) => g.result === 'fav_won';
const favP = (g) => g.fav_p;
const bettable = games.filter((g) => g.rating === 'high' || g.rating === 'medium');

console.log(`Research record review — ${games.length} settled games since ${record.start} (record updated ${record.updated_at})`);
console.log(`A group needs ${MIN_GAMES} settled games before a rule changes; "weak" means ${WEAK_GAP * 100} points or more below its market odds.`);

section('How the favourite did, by rating', group(games, (g) => g.rating), favWon, favP);
section('Medium/high games, by sport', group(bettable, sportOf), favWon, favP);
section('Medium/high games, by favourite price', group(bettable, (g) => band(g.fav_p)), favWon, favP);
section('All games, by sport', group(games, sportOf), favWon, favP);

const draws = games.filter((g) => g.result === 'draw');
console.log(`\nDraws: ${draws.length} of ${games.filter((g) => sportOf(g) === 'football').length} football games; by favourite price: ${[...group(draws, (g) => band(g.fav_p))].map(([k, v]) => `${k} ${v.length}`).join(', ')}`);

// The legs actually bet, and the ones dropped at a check. A leg's market
// chance is taken from its odds (an estimated price includes a 3% margin).
const legs = record.games.flatMap((g) => (g.bets || []).map((b) => ({ ...b, sport: sportOf(g) }))).filter((b) => b.result === 'won' || b.result === 'lost' || b.result === 'void');
const landed = (b) => b.result !== 'lost';
const legP = (b) => Math.min(0.99, 0.97 / b.odds);
section('Slip legs, by kind (won or refunded)', group(legs.filter((b) => b.final), legKind), landed, legP);
section('Slip legs, by sport (won or refunded)', group(legs.filter((b) => b.final), (b) => b.sport), landed, legP);
const dropped = legs.filter((b) => !b.final);
if (dropped.length) {
  const would = dropped.filter(landed).length;
  console.log(`\nLegs dropped at a check: ${dropped.length}; ${dropped.length - would} would have lost, ${would} would have won or been refunded.`);
}
