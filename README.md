# Daily Parlay

One page, one parlay a day, with a log of every slip and whether it hit.

## How it works

1. **07:50 Belgrade — research.** A scheduled Claude Code task runs
   `node scripts/candidates.mjs` to list today's candidate legs from
   Polymarket, researches each one on the web, looks up Stake and Rainbet
   prices, and pushes `research/<date>.json` to `main`. The procedure and
   rules are in [`research/INSTRUCTIONS.md`](research/INSTRUCTIONS.md).
2. **Build.** That push (and a run every 2 hours) triggers the GitHub
   Actions job. It re-reads live Polymarket probabilities, applies the
   research verdicts, and picks the slip. If no research has arrived by 12:00
   Belgrade, it builds a market-only slip.
3. **Settle.** Every run marks finished legs won or lost from resolved
   Polymarket markets. The page shows the history and keeps a copy in your
   browser's local storage.

## How the slip is picked

- Probabilities come from Polymarket, de-vigged.
- Core lane: top European football and tier-1 CS2 (Bo3+), legs at
  1.20–2.40. High-confidence lane: NBA, NFL, NCAAF, NHL, MLB, ATP/WTA, UFC and
  tier-1 esports, moneyline only, at least 75% likely.
- Research can move a probability a few points or drop the leg; it never
  sets the probability on its own.
- Odds on the slip are the best verified Stake or Rainbet price, or the fair
  Polymarket price marked “est.” when none was found.
- It picks the 2–5 legs with the best expected value and total odds aimed at
  5.0 (4.5–5.5 allowed), preferring fewer legs. If nothing fits: “No bet”.

## Local commands

`npm run candidates`, `npm run check-research`, `FORCE_GENERATE=1 npm run daily`,
`npm run dev`.
