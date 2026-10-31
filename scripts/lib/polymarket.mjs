/**
 * Polymarket Gamma API access: the sports catalogue, upcoming game events,
 * and single-market lookups for settlement.
 *
 * Polymarket is the sharp reference price the analyst rules call for, and it
 * is free to read without a key.
 */

const GAMMA = 'https://gamma-api.polymarket.com';

async function getJson(url, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.json();
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
    }
  }
  throw lastError;
}

export function parseArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Gamma sends "2026-10-04 19:00:00+00"; Date wants ISO 8601. */
export function parseTime(value) {
  if (!value) return null;
  let s = String(value).trim().replace(' ', 'T');
  if (/[+-]\d{2}$/.test(s)) s += ':00';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** List of sports with their series ids, e.g. { sport: 'epl', series: '10188', tags: '1,82,...' }. */
export async function fetchSports() {
  const data = await getJson(`${GAMMA}/sports`);
  return Array.isArray(data) ? data : [];
}

/** All open events of one series that end after `endMin`. */
export async function fetchSeriesEvents(seriesId, endMin) {
  const out = [];
  const pageSize = 100;
  for (let offset = 0; offset < 500; offset += pageSize) {
    const params = new URLSearchParams({
      series_id: String(seriesId),
      active: 'true',
      closed: 'false',
      limit: String(pageSize),
      offset: String(offset),
      end_date_min: endMin.toISOString(),
    });
    const page = await getJson(`${GAMMA}/events?${params}`);
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    if (page.length < pageSize) break;
  }
  return out;
}

export async function fetchMarket(id) {
  return getJson(`${GAMMA}/markets/${encodeURIComponent(id)}`);
}
