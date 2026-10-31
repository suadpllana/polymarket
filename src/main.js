import './style.css';
import data from '../data/stake-bets.json';
import { enrichBets } from './lib/bets.js';
import { parseStakeText } from './lib/stake-parse.js';
import { renderBets } from './views/bets.js';
import { renderStats } from './views/stats.js';
import { renderToday } from './views/today.js';
import { hideTip } from './ui/charts.js';

const LOCAL_KEY = 'stakeBets.local.v1';

// The old multi-sport model kept a slip log in the browser; it is gone.
for (const key of ['dailyParlay.log.v1', 'dailyParlay.amount']) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

function readLocal() {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeLocal(bets) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(bets));
    return true;
  } catch {
    return false;
  }
}

function loadBets() {
  const known = new Set(data.bets.map((b) => b.id));
  const local = readLocal().filter((b) => !known.has(b.id));
  const all = structuredClone([...data.bets, ...local]);
  enrichBets(all);
  all.sort((a, b) => `${b.date}T${b.time}`.localeCompare(`${a.date}T${a.time}`));
  return { all, localCount: local.length };
}

const ctx = {
  bets: [],
  localCount: 0,
  refresh: () => route(),
  addLocal(text) {
    if (!text.trim()) return { error: 'Paste your Stake bets first.' };
    const { bets, errors } = parseStakeText(text);
    if (!bets.length) return { error: errors.length ? `Could not read that: ${errors[0]}` : 'No bets found in that text.' };
    const have = new Set([...data.bets.map((b) => b.id), ...readLocal().map((b) => b.id)]);
    const fresh = bets.filter((b) => !have.has(b.id));
    if (fresh.length && !writeLocal([...readLocal(), ...fresh])) return { error: 'This browser blocks storage, so the bets could not be saved.' };
    return { added: fresh.length, dup: bets.length - fresh.length, errors: errors.length };
  },
  clearLocal() {
    writeLocal([]);
  },
};

const ROUTES = { today: renderToday, bets: renderBets, stats: renderStats };

function route() {
  hideTip();
  const name = (location.hash.replace(/^#\/?/, '') || 'today').split('?')[0];
  const view = ROUTES[name] ? name : 'today';
  document.querySelectorAll('[data-route]').forEach((a) => {
    if (a.dataset.route === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const { all, localCount } = loadBets();
  ctx.bets = all;
  ctx.localCount = localCount;
  const root = document.getElementById('app');
  root.dataset.view = view;
  ROUTES[view](root, ctx);
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
