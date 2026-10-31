/**
 * Parses the text you get by selecting and copying Stake's "My Bets → Settled"
 * page. Works in the browser (paste box) and in Node (scripts/import-bets.mjs).
 *
 * A single looks like:
 *   Natus Vincere / Match Winner - Twoway / Loss / Thu, Oct 29 / 11:22 AM /
 *   Team Vitality / Natus Vincere / 2 / 1 / Odds / 1.75 / Stake / $1.00 / Payout / $0.00
 * A multi starts with "2 Leg Multi" and its status, then per leg:
 *   selection / market / odds / date / time / home / away / score / score
 */

const MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
const NOISE = new Set(['My Bets', 'Settled', 'Hide Legs', 'Show Legs', 'Active']);
const DATE_RE = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), ([A-Z][a-z]{2}) (\d{1,2})$/;
const TIME_RE = /^(\d{1,2}):(\d{2}) ?(AM|PM)$/i;
const MULTI_RE = /^(\d+) Leg Multi$/i;
const INT_RE = /^\d+$/;
const NUM_RE = /^\d+(\.\d+)?$/;
const MONEY_RE = /^-?[$€£]?\s?-?([\d,]+(\.\d+)?)$/;

function money(s) {
  const m = MONEY_RE.exec(String(s).trim());
  if (!m) throw new Error(`expected an amount, got "${s}"`);
  return Number(m[1].replace(/,/g, ''));
}

function isoDate(dayText, year) {
  const m = DATE_RE.exec(dayText);
  if (!m) throw new Error(`expected a date like "Thu, Oct 29", got "${dayText}"`);
  return `${year}-${String(MONTHS[m[2]]).padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function time24(text) {
  const m = TIME_RE.exec(text);
  if (!m) throw new Error(`expected a time like "7:00 PM", got "${text}"`);
  let h = Number(m[1]) % 12;
  if (m[3].toUpperCase() === 'PM') h += 12;
  return `${String(h).padStart(2, '0')}:${m[2]}`;
}

/** Stake shows no year; use the latest year that does not put the bet in the future. */
function guessYear(dayText, now) {
  const m = DATE_RE.exec(dayText);
  if (!m) return now.getFullYear();
  const y = now.getFullYear();
  const d = new Date(Date.UTC(y, MONTHS[m[2]] - 1, Number(m[3])));
  return d.getTime() > now.getTime() + 2 * 86400000 ? y - 1 : y;
}

function normStatus(s) {
  const t = s.trim().toLowerCase();
  if (t === 'win' || t === 'won') return 'won';
  if (t === 'loss' || t === 'lost') return 'lost';
  if (t.startsWith('cash')) return 'cashed_out';
  if (t === 'push' || t === 'void' || t === 'refund' || t === 'refunded') return 'void';
  return t;
}

const STATUS_WORDS = /^(win|won|loss|lost|cashed out|push|void|refund|refunded)$/i;

export function parseStakeText(text, { now = new Date(), year } = {}) {
  const start = text.indexOf('My Bets');
  const body = start >= 0 ? text.slice(start) : text;
  const t = body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !NOISE.has(l));

  let i = 0;
  const next = () => {
    if (i >= t.length) throw new Error('unexpected end of text');
    return t[i++];
  };
  const expect = (word) => {
    const got = next();
    if (got.toLowerCase() !== word.toLowerCase()) throw new Error(`expected "${word}", got "${got}" (line ${i})`);
  };
  const readEvent = () => {
    const day = next();
    const y = year || guessYear(day, now);
    const date = isoDate(day, y);
    const time = time24(next());
    const home = next();
    const away = next();
    const score = [];
    while (score.length < 2 && i < t.length && INT_RE.test(t[i])) score.push(Number(t[i++]));
    return { date, time, home, away, score: score.length === 2 ? score : null };
  };
  const readTotals = () => {
    expect('Odds');
    const shownOdds = Number(next());
    expect('Stake');
    const stake = money(next());
    expect('Payout');
    const payout = money(next());
    return { shownOdds, stake, payout };
  };

  const bets = [];
  const errors = [];
  while (i < t.length) {
    const startAt = i;
    try {
      const first = next();
      const multi = MULTI_RE.exec(first);
      if (multi) {
        const n = Number(multi[1]);
        const status = normStatus(next());
        const legs = [];
        for (let k = 0; k < n; k++) {
          const selection = next();
          const market = next();
          const oddsText = next();
          if (!NUM_RE.test(oddsText)) throw new Error(`expected leg odds, got "${oddsText}"`);
          legs.push({ selection, market, odds: Number(oddsText), ...readEvent() });
        }
        const totals = readTotals();
        bets.push({ type: 'multi', status, legs, ...totals });
      } else {
        const selection = first;
        const market = next();
        const statusText = next();
        if (!STATUS_WORDS.test(statusText)) throw new Error(`expected a result word, got "${statusText}"`);
        const ev = readEvent();
        const totals = readTotals();
        // A cashed-out single shows payout/stake as its "odds", not the price taken.
        const odds = normStatus(statusText) === 'cashed_out' ? null : totals.shownOdds;
        bets.push({ type: 'single', status: normStatus(statusText), legs: [{ selection, market, odds, ...ev }], ...totals });
      }
    } catch (e) {
      errors.push(`${e.message} (near "${t[startAt]}")`);
      // Skip to the next thing that looks like the start of a bet.
      i = startAt + 1;
      while (i < t.length && !(MULTI_RE.test(t[i]) || (i + 2 < t.length && STATUS_WORDS.test(t[i + 2]) && DATE_RE.test(t[i + 3] || '')))) i++;
    }
  }

  for (const b of bets) {
    b.date = b.legs.reduce((d, l) => (l.date < d ? l.date : d), b.legs[0].date);
    b.time = b.legs.find((l) => l.date === b.date).time;
    if (b.type === 'multi') b.odds = Math.round(b.legs.reduce((o, l) => o * l.odds, 1) * 100) / 100;
    else b.odds = b.legs[0].odds;
    b.id = betId(b);
  }
  return { bets, errors };
}

/** Same bet → same id, so pasting the same page twice adds nothing. */
export function betId(b) {
  const s = [b.type, b.stake.toFixed(2), b.payout.toFixed(2), ...b.legs.map((l) => `${l.date}T${l.time}|${l.selection}|${l.market}|${l.home}|${l.away}`)].join('#');
  let h = 2166136261;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}
