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

/**
 * Betting window from the analyst rules: events starting at least 90 minutes
 * from now, up to 06:00 local the next morning (so North American evening
 * games are included).
 */
export function bettingWindow(now = new Date(), tz = TIMEZONE) {
  const start = new Date(now.getTime() + 90 * 60 * 1000);
  const p = zonedParts(now, tz);
  const tomorrow = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
  const end = zonedToUtc(
    tomorrow.getUTCFullYear(),
    tomorrow.getUTCMonth() + 1,
    tomorrow.getUTCDate(),
    6,
    0,
    tz
  );
  return { start, end };
}
