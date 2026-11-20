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
const RESULT_KEYS = new Set(['home', 'away', 'home_draw', 'away_draw', 'home_dnb', 'away_dnb']);

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
      ${RESULT_KEYS.has(l.key) || !l.key ? (l.p.draw ? `<span>Home ${pct(l.p.home)} · Draw ${pct(l.p.draw)} · Away ${pct(l.p.away)}</span>` : `<span>${esc(l.home)} ${pct(l.p.home)} · ${esc(l.away)} ${pct(l.p.away)}</span>`) : ''}
      <span class="conf conf--${esc(l.confidence)}">${l.confidence === 'market' ? 'market price only' : `${esc(l.confidence)} confidence`}</span>
    </div>
    <details class="pick__more"><summary>Why this pick</summary>
      <p class="pick__why">${esc(l.reason)}</p>
      <p class="pick__risk"><strong>Main risk:</strong> ${esc(l.main_risk)}</p>
      <dl>${checks.map(([k, v]) => `<dt>${esc(CHECK_LABEL[k] || k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
      <div class="small">${(l.sources || []).map((s) => { let h = s; try { h = new URL(s).hostname.replace(/^www\./, ''); } catch {} return `<a href="${esc(s)}" target="_blank" rel="noopener noreferrer">${esc(h)}</a>`; }).join(' · ')}</div>
    </details>
  </article>`;
}

function slipHtml(e, title = 'Today’s slip') {
  if (e.no_bet) {
    return `<section class="card slip-none"><h2>No bet today</h2><p>${esc(e.reason)}</p>${e.summary ? `<p class="muted small">${esc(e.summary)}</p>` : ''}${e.skipped?.length ? `<ul class="small muted">${e.skipped.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</section>`;
  }
  const pay = e.result === 'won' || e.result === 'void' ? `<span>Paid at ${odds(e.settled_odds)}</span>` : '';
  return `<section class="slip-card">
    <header class="slip-card__head">
      <div><div class="muted small">${esc(dayLabel(e.date))} · ${e.legs.length} leg${e.legs.length === 1 ? '' : 's'}</div><h2>${esc(title)}</h2></div>
      <div class="slip-card__odds"><span>Total odds</span><strong>${odds(e.odds)}</strong></div>
    </header>
    ${e.tier_note ? `<p class="slip-card__tier small">${esc(e.tier_note)}</p>` : ''}
    ${
      e.research_stage === 'pre_kickoff'
        ? `<p class="slip-card__tier small"><strong>Final check done</strong> at ${esc(timeLabel(e.researched_at))}: lineups and late news were checked shortly before the first game.</p>`
        : e.researched_at && !e.result
          ? `<p class="slip-card__tier small"><strong>Draft: do not bet yet.</strong> This is the morning research. The final check of lineups, late news and price moves runs about 90 minutes before the first game and often changes the slip. Bet only after this note says “Final check done”.</p>`
          : ''
    }
    <div class="slip-card__legs">${e.legs.map(legCard).join('')}</div>
    <footer class="slip-card__foot">
      <span>${e.legs.length === 1 ? 'Chance it lands' : e.legs.length === 2 ? 'Chance both land' : 'Chance all land'}: <strong>${pct(e.p_hit)}</strong></span>
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
  // Extra slips the owner asked for on top of the daily slip (public/extra.json).
  // They are shown only on their own day and are not part of the model record.
  let allExtras = [];
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}extra.json?t=${Date.now()}`, { cache: 'no-store' });
    if (res.ok) allExtras = ((await res.json()).slips || []).filter((x) => x.legs?.length);
  } catch {
    /* no extra slips */
  }
  // Open extra slips sit at the top from the evening before their day until
  // they settle (late games start after midnight); settled ones join the record list.
  const extras = allExtras.filter((x) => x.date >= localDate() && !x.result);
  const settledExtras = allExtras.filter((x) => x.result);
  const entries = (history.entries || []).filter((e) => e.model === 'football-2leg');
  const todayEntry = entries.find((e) => e.date === localDate());
  // Once today's slip is settled (won, lost or void) it leaves the top of the
  // page and joins the record below.
  const today = todayEntry && !todayEntry.result ? todayEntry : null;
  const settledToday = Boolean(todayEntry && todayEntry.result);
  // Research done the evening before publishes tomorrow's slip early.
  const tomorrow = entries.find((e) => e.date === localDate(new Date(Date.now() + 24 * 3600 * 1000)));
  // Days without a bet are left out of the record.
  // Extra slips are listed next to their day and count in the win rate (owner's choice, 18 Nov).
  const past = [...entries.filter((e) => e !== today && e !== tomorrow && !e.no_bet), ...settledExtras].sort((a, b) => (a.date === b.date ? Number(Boolean(a.extra)) - Number(Boolean(b.extra)) : a.date < b.date ? 1 : -1));
  const settled = [...entries, ...settledExtras].filter((e) => e.result === 'won' || e.result === 'lost');
  const won = settled.filter((e) => e.result === 'won').length;

  root.innerHTML = `
    <section class="page-head">
      <h1>Today</h1>
      <p class="muted">One slip a day: one to three legs from different games in any sport, medium or high confidence only, total odds about 2.0, every leg starting before 23:00.</p>
    </section>
    ${
      today
        ? slipHtml(today)
        : settledToday
          ? tomorrow && !tomorrow.no_bet
            ? ''
            : `<section class="card slip-none"><h2>Today’s slip is settled</h2><p>It is in the record below. Tomorrow’s slip appears here after the research is pushed.</p></section>`
          : `<section class="card slip-none"><h2>No slip yet</h2><p>The research runs at 07:50 Belgrade time. The slip appears here a few minutes after it is pushed.</p></section>`
    }
    ${extras.map((x) => `${x.note ? `<p class="slip-card__tier small"><strong>${esc(x.note)}</strong></p>` : ''}${slipHtml(x, x.title || 'Extra slip')}`).join('')}
    ${tomorrow && !tomorrow.no_bet ? slipHtml(tomorrow, 'Tomorrow’s slip') : ''}
    <section class="card">
      <h2>Model record</h2>
      <p class="card__sub">${settled.length ? `${won} of ${settled.length} slips won (${pct(won / settled.length)}). At odds of 2.0 the break-even rate is 50%.` : 'No settled slips yet. The record starts with the first slip.'}${settledExtras.length ? ` Includes ${settledExtras.length} extra slip${settledExtras.length === 1 ? '' : 's'}.` : ''}</p>
      ${
        past.length
          ? `<ul class="record">${past
              .map(
                (e) => `<li class="record__row"><div class="record__day">${esc(dayLabel(e.date))}${e.extra ? '<div class="muted small">Extra slip</div>' : ''}</div><div class="record__legs">${e.legs
                  .map((l) => `<div>${esc(l.selection)} <span class="muted">${esc(l.label)} · ${odds(l.odds)}</span></div>`)
                  .join('')}</div><div class="record__end"><strong>${odds(e.odds)}</strong>${resultBadge(e.result)}</div></li>`
              )
              .join('')}</ul>`
          : ''
      }
    </section>`;
}
