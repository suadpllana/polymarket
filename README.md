# Daily Parlay

One page, one parlay a day. A GitHub Actions job builds the slip from live
Polymarket prices, optionally researched by Claude, and publishes it to
GitHub Pages together with a history of every slip and whether it hit.
Your browser also keeps its own copy of the log in local storage.

## How the slip is picked

- Prices come from Polymarket and are de-vigged into probabilities.
- Core lane: top European football and tier-1 CS2 (Bo3+), legs at 1.20–2.40.
- High-confidence lane: NBA, NFL, NCAAF, NHL, MLB, ATP/WTA, UFC and tier-1
  esports, moneyline only, at least 75% likely.
- With `ANTHROPIC_API_KEY` set, Claude researches each candidate on the web
  (injuries, lineups, rotation, stand-ins, goalies, pitchers) and can nudge a
  probability a few points or drop the leg. Prices are never taken from it.
- From what survives, it picks the 2–5 legs with total odds between 4.5 and
  5.5 and the best expected value, preferring fewer legs. If nothing fits, the
  slip says “No bet”.

## Setup

1. **Settings → Pages → Source: GitHub Actions.**
2. Optional, for the research pass: **Settings → Secrets and variables →
   Actions → New repository secret** named `ANTHROPIC_API_KEY`.
3. Push to `main`. The job then runs every 2 hours: it settles finished slips
   and, on the first run after 08:00 Belgrade time, builds the day's slip.

Local preview: `npm install`, `FORCE_GENERATE=1 npm run daily`, `npm run dev`.
