import { dayLabel, esc, localDate, odds, pct, timeLabel } from '../ui/format.js';

const CHECK_LABEL = {
  team_news: 'Team news',
  lineups: 'Lineups',
  rotation: 'Rotation',
  motivation: 'Motivation',
  form: 'Form & xG',
  h2h: 'Head to head',
  odds: 'Odds',
  models: 'Models',
  venue_weather: 'Venue & weather',
};

const RESULT = { won: ['Won', '✓'], lost: ['Lost', '✕'], void: ['Void', '–'] };

function resultBadge(r) {
  if (!r) return '<span class="badge badge--open">Open</span>';
  const [l, i] = RESULT[r] || [r, ''];
  return `<span class="badge badge--${r}">${i} ${l}</span>`;
}

function legCard(l, i) {
  const checks = Object.entries(l.checks || {}).filter(([, v]) => v);
  return `<article class="pick">
    <header class="pick__head">
      <span class="pick__n">${i + 1}</span>
      <div class="pick__event"><div class="muted small">${esc(l.league)} · ${esc(dayLabel(l.start.slice(0, 10)))} ${esc(timeLabel(l.start))}</div><div>${esc(l.home)} vs ${esc(l.away)}</div></div>
      ${resultBadge(l.result)}
    </header>
    <div class="pick__bet">
      <div><strong>${esc(l.selection)}</strong><div class="muted small">${esc(l.label)}</div></div>
      <div class="pick__odds">${odds(l.odds)}<span>${l.book ? esc(l.book) : 'est. Stake'}</span></div>
    </div>
    <div class="pick__probs">
      <span>Chance it lands ${pct(l.p_win + (l.p_void || 0))}</span>
      <span>Home ${pct(l.p.home)} · Draw ${pct(l.p.draw)} · Away ${pct(l.p.away)}</span>
      <span class="conf conf--${esc(l.confidence)}">${esc(l.confidence)} confidence</span>
    </div>
    <p class="pick__why">${esc(l.reason)}</p>
    <p class="pick__risk"><strong>Main risk:</strong> ${esc(l.main_risk)}</p>
    <details class="pick__more"><summary>Full research</summary>
      <dl>${checks.map(([k, v]) => `<dt>${esc(CHECK_LABEL[k] || k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <div class="small">${(l.sources || []).map((s) => { let h = s; try { h = new URL(s).hostname.replace(/^www\./, ''); } catch {} return `<a href="${esc(s)}" target="_blank" rel="noopener noreferrer">${esc(h)}</a>`; }).join(' · ')}</div>
    </details>
  </article>`;
}

function slipHtml(e) {
  if (e.no_bet) {
    return `<section class="card slip-none"><h2>No bet today</h2><p>${esc(e.reason)}</p>${e.summary ? `<p class="muted small">${esc(e.summary)}</p>` : ''}${e.skipped?.length ? `<ul class="small muted">${e.skipped.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</section>`;
  }
  const pay = e.result === 'won' || e.result === 'void' ? `<span>Paid at ${odds(e.settled_odds)}</span>` : '';
  return `<section class="slip-card">
    <header class="slip-card__head">
      <div><div class="muted small">${esc(dayLabel(e.date))} · ${e.legs.length} legs</div><h2>Today's slip</h2></div>
      <div class="slip-card__odds"><span>Total odds</span><strong>${odds(e.odds)}</strong></div>
    </header>
    <div class="slip-card__legs">${e.legs.map(legCard).join('')}</div>
    <footer class="slip-card__foot">
      <span>Chance both land: <strong>${pct(e.p_hit)}</strong></span>
      <span>Place before ${esc(timeLabel(e.place_before))}</span>
      ${resultBadge(e.result)} ${pay}
    </footer>
    <p class="small muted slip-card__note">Odds marked “est.” are the fair Polymarket price minus 3%; check the real price on Stake before placing. Hold the slip to the end: cashing out cost you $757 in October.</p>
  </section>`;
}

export async function renderToday(root) {
  root.innerHTML = '<p class="muted">Loading today’s slip…</p>';
  let history = { entries: [] };
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}history.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) history = await res.json();
  } catch {
    /* offline */
  }
  const entries = (history.entries || []).filter((e) => e.model === 'football-2leg');
  const today = entries.find((e) => e.date === localDate());
  const past = entries.filter((e) => e !== today);
  const settled = entries.filter((e) => e.result === 'won' || e.result === 'lost');
  const won = settled.filter((e) => e.result === 'won').length;

  root.innerHTML = `
    <section class="page-head">
      <h1>Today</h1>
      <p class="muted">One football slip a day: two legs from two games, total odds about 2.0, every game researched in depth before it is picked.</p>
    </section>
    ${
      today
        ? slipHtml(today)
        : `<section class="card slip-none"><h2>No slip yet</h2><p>The research runs at 07:50 Belgrade time. The slip appears here a few minutes after it is pushed.</p></section>`
    }
    <section class="card">
      <h2>Model record</h2>
      <p class="card__sub">${settled.length ? `${won} of ${settled.length} slips won (${pct(won / settled.length)}). At odds of 2.0 the break-even rate is 50%.` : 'No settled slips yet. The record starts with the first slip.'}</p>
      ${
        past.length
          ? `<ul class="record">${past
              .map(
                (e) => `<li class="record__row"><div class="record__day">${esc(dayLabel(e.date))}</div><div class="record__legs">${
                  e.no_bet ? `<span class="muted">No bet: ${esc(e.reason)}</span>` : e.legs.map((l) => `<div>${esc(l.selection)} <span class="muted">${esc(l.label)} · ${odds(l.odds)}</span></div>`).join('')
                }</div><div class="record__end">${e.no_bet ? '' : `<strong>${odds(e.odds)}</strong>${resultBadge(e.result)}`}</div></li>`
              )
              .join('')}</ul>`
          : ''
      }
    </section>`;
}
