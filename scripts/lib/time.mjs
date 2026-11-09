/**
 * Timezone helpers built on Intl, so summer/winter time is handled by the
 * IANA database instead of fixed offsets.
 */

export const TIMEZONE = 'Europe/Belgrade';

export function zonedParts(date, tz = TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  };
}

/** 'YYYY-MM-DD' for the given instant in the given zone. */
export function localDate(date = new Date(), tz = TIMEZONE) {
  const { year, month, day } = zonedParts(date, tz);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** The UTC instant at which the wall clock in `tz` reads the given time. */
export function zonedToUtc(year, month, day, hour, minute, tz = TIMEZONE) {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute);
  let guess = asUtc;
  // Two passes settle the offset even across a DST boundary.
  for (let i = 0; i < 2; i++) {
    const p = zonedParts(new Date(guess), tz);
    const shown = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += asUtc - shown;
  }
  return new Date(guess);
}

/** Every leg must start before this local time, so the slip is over before bed. */
export const LAST_KICKOFF = { hour: 23, minute: 0 };
/** Look-ahead windows (a day with nothing left) start no earlier than this. */
export const FIRST_KICKOFF_HOUR = 9;

function localDay(now, tz, addDays) {
  const p = zonedParts(now, tz);
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + addDays));
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()];
}

/**
 * Today's betting window: games starting at least 90 minutes from now and
 * before 23:00 Belgrade.
 */
export function bettingWindow(now = new Date(), tz = TIMEZONE) {
  const start = new Date(now.getTime() + 90 * 60 * 1000);
  const end = zonedToUtc(...localDay(now, tz, 0), LAST_KICKOFF.hour, LAST_KICKOFF.minute, tz);
  return { start, end };
}

/** Tomorrow from 09:00 to 23:00 Belgrade, for days with nothing usable left. */
export function tomorrowWindow(now = new Date(), tz = TIMEZONE) {
  const day = localDay(now, tz, 1);
  const start = new Date(Math.max(now.getTime() + 90 * 60 * 1000, zonedToUtc(...day, FIRST_KICKOFF_HOUR, 0, tz).getTime()));
  return { start, end: zonedToUtc(...day, LAST_KICKOFF.hour, LAST_KICKOFF.minute, tz) };
}
