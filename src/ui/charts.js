/**
 * Small SVG charts for the Stats page. Marks follow one spec: 2px lines,
 * bars at most 24px thick with a 4px rounded data end, hairline gridlines,
 * a 2px surface ring on markers, and a hover layer on everything.
 * Labels go in with textContent, never as HTML.
 */

import { moneyShort, money, shortDay } from './format.js';

const NS = 'http://www.w3.org/2000/svg';

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

function text(parent, x, y, value, attrs = {}) {
  const t = el('text', { x, y, ...attrs }, parent);
  t.textContent = value;
  return t;
}

// ---------- tooltip ----------

let tip;
function tooltip() {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}

/** rows: [{ value, label, color? }] — the value leads, the label follows. */
export function showTip(clientX, clientY, title, rows) {
  const t = tooltip();
  t.replaceChildren();
  if (title) {
    const h = document.createElement('div');
    h.className = 'tip__title';
    h.textContent = title;
    t.appendChild(h);
  }
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'tip__row';
    if (r.color) {
      const key = document.createElement('span');
      key.className = 'tip__key';
      key.style.background = r.color;
      row.appendChild(key);
    }
    const v = document.createElement('strong');
    v.textContent = r.value;
    row.appendChild(v);
    const l = document.createElement('span');
    l.textContent = r.label;
    row.appendChild(l);
    t.appendChild(row);
  }
  t.style.display = 'block';
  const { width, height } = t.getBoundingClientRect();
  let x = clientX + 14;
  let y = clientY + 14;
  if (x + width > window.innerWidth - 8) x = clientX - width - 14;
  if (y + height > window.innerHeight - 8) y = clientY - height - 14;
  t.style.left = `${Math.max(8, x)}px`;
  t.style.top = `${Math.max(8, y)}px`;
}

export function hideTip() {
  if (tip) tip.style.display = 'none';
}

function niceTicks(min, max, count = 4) {
  const span = max - min || 1;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || raw;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

/** Bar path: square at the baseline, 4px rounded at the data end. */
function hBarPath(x0, x1, y, h) {
  const r = Math.min(4, Math.abs(x1 - x0), h / 2);
  if (x1 >= x0) {
    return `M${x0},${y}H${x1 - r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 - r},${y + h}H${x0}Z`;
  }
  return `M${x0},${y}H${x1 + r}Q${x1},${y} ${x1},${y + r}V${y + h - r}Q${x1},${y + h} ${x1 + r},${y + h}H${x0}Z`;
}

/**
 * Multi-series line chart over dates with a crosshair.
 * series: [{ key, label, color, values: number[] }], dates: string[]
 */
export function lineChart(container, { dates, series, height = 260 }) {
  const draw = () => {
    container.replaceChildren();
    const width = Math.max(280, container.clientWidth);
    const m = { top: 14, right: 118, bottom: 28, left: 52 };
    if (width < 420) m.right = 92;
    const w = width - m.left - m.right;
    const h = height - m.top - m.bottom;
    const all = series.flatMap((s) => s.values).concat(0);
    const ticks = niceTicks(Math.min(...all), Math.max(...all));
    const yMin = ticks[0];
    const yMax = ticks[ticks.length - 1];
    const x = (i) => m.left + (dates.length < 2 ? w / 2 : (i / (dates.length - 1)) * w);
    const y = (v) => m.top + h - ((v - yMin) / (yMax - yMin || 1)) * h;

    const svg = el('svg', { width, height, viewBox: `0 0 ${width} ${height}`, class: 'chart', role: 'img', 'aria-label': 'Cumulative profit by sport' }, container);
    for (const t of ticks) {
      el('line', { x1: m.left, x2: m.left + w, y1: y(t), y2: y(t), class: t === 0 ? 'chart__base' : 'chart__grid' }, svg);
      text(svg, m.left - 8, y(t) + 4, moneyShort(t), { class: 'chart__tick', 'text-anchor': 'end' });
    }
    const every = Math.max(1, Math.ceil(dates.length / Math.max(2, Math.floor(w / 70))));
    dates.forEach((d, i) => {
      const last = dates.length - 1;
      // Skip a label that would run into the last one.
      if (i !== last && (i % every !== 0 || x(last) - x(i) < 52)) return;
      text(svg, x(i), height - 8, shortDay(d), { class: 'chart__tick', 'text-anchor': i === 0 ? 'start' : i === dates.length - 1 ? 'end' : 'middle' });
    });

    // End labels: spread apart when they would collide, with a leader line.
    const ends = series.map((s) => ({ s, yv: y(s.values[s.values.length - 1]) })).sort((a, b) => a.yv - b.yv);
    for (let i = 1; i < ends.length; i++) if (ends[i].yv - ends[i - 1].yv < 28) ends[i].ly = (ends[i - 1].ly ?? ends[i - 1].yv) + 28;
    for (const e of ends) e.ly = e.ly ?? e.yv;

    for (const s of series) {
      const d = s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
      el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }, svg);
    }
    for (const e of ends) {
      const i = e.s.values.length - 1;
      el('circle', { cx: x(i), cy: e.yv, r: 4, fill: e.s.color, stroke: '#1a2c38', 'stroke-width': 2 }, svg);
      if (Math.abs(e.ly - e.yv) > 2) el('line', { x1: x(i) + 6, y1: e.yv, x2: x(i) + 12, y2: e.ly - 4, class: 'chart__leader' }, svg);
      text(svg, x(i) + 14, e.ly - 4, e.s.label, { class: 'chart__label' });
      text(svg, x(i) + 14, e.ly + 10, money(e.s.values[i], { sign: true }), { class: 'chart__value' });
    }

    const cross = el('line', { y1: m.top, y2: m.top + h, class: 'chart__cross', visibility: 'hidden' }, svg);
    const hit = el('rect', { x: m.left, y: m.top, width: w, height: h, fill: 'transparent', tabindex: 0 }, svg);
    let focusIndex = dates.length - 1;
    const show = (i, cx, cy) => {
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      showTip(cx, cy, shortDay(dates[i]), series.map((s) => ({ value: money(s.values[i], { sign: true }), label: s.label, color: s.color })));
    };
    hit.addEventListener('pointermove', (ev) => {
      const box = svg.getBoundingClientRect();
      const px = ev.clientX - box.left;
      const i = Math.max(0, Math.min(dates.length - 1, Math.round(((px - m.left) / w) * (dates.length - 1))));
      focusIndex = i;
      show(i, ev.clientX, ev.clientY);
    });
    hit.addEventListener('pointerleave', () => {
      cross.setAttribute('visibility', 'hidden');
      hideTip();
    });
    hit.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      focusIndex = Math.max(0, Math.min(dates.length - 1, focusIndex + (ev.key === 'ArrowRight' ? 1 : -1)));
      const box = svg.getBoundingClientRect();
      show(focusIndex, box.left + x(focusIndex), box.top + m.top);
    });
    hit.addEventListener('blur', () => {
      cross.setAttribute('visibility', 'hidden');
      hideTip();
    });
  };
  draw();
  observe(container, draw);
}

const observers = new WeakMap();
function observe(container, draw) {
  if (observers.has(container)) observers.get(container).disconnect();
  let last = container.clientWidth;
  const ro = new ResizeObserver(() => {
    if (Math.abs(container.clientWidth - last) < 4) return;
    last = container.clientWidth;
    draw();
  });
  ro.observe(container);
  observers.set(container, ro);
}
