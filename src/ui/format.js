export const TZ = 'Europe/Belgrade';

export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function money(x, { sign = false } = {}) {
  const v = Math.abs(x) < 0.005 ? 0 : x;
  const s = `$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (v < 0) return `−${s}`;
  return sign && v > 0 ? `+${s}` : s;
}

export function moneyShort(x) {
  const a = Math.abs(x);
  const s = a >= 1000 ? `$${(a / 1000).toFixed(a >= 10000 ? 0 : 1)}K` : `$${Math.round(a)}`;
  return x < 0 ? `−${s}` : s;
}

export function pct(x, digits = 0) {
  if (x === null || x === undefined || Number.isNaN(x)) return '–';
  return `${(x * 100).toFixed(digits)}%`;
}

export function signedPct(x) {
  if (x === null || x === undefined) return '–';
  const v = Math.round(x * 100);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}%`;
}

export function odds(x) {
  return x ? Number(x).toFixed(2) : '–';
}

/** 'Thu 29 Oct' from 'YYYY-MM-DD'. */
export function dayLabel(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function shortDay(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
}

export function localDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

export function timeLabel(isoInstant) {
  return new Date(isoInstant).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const RESULT_LABEL = { won: 'Won', lost: 'Lost', cashed_out: 'Cashed out', void: 'Void' };
export const RESULT_ICON = { won: '✓', lost: '✕', cashed_out: '↺', void: '–' };
