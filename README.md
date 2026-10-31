# Daily Parlay

A small site with three pages:

- **Today**: one football slip a day. Exactly two legs from two different
  games, total odds about 2.0, every game researched in depth first.
- **My Bets**: every settled Stake bet, filterable by sport, result and type.
  New bets can be pasted straight from Stake's My Bets page.
- **Stats**: profit by sport, what lost your bets, hit rate by pick type,
  cash-outs, odds bands, and the teams you read well or badly.

## How the daily slip is made

1. **07:50 Belgrade: research.** A scheduled Claude Code task runs
   `npm run candidates` to list up to 12 of today's football games from
   Polymarket. It researches each game in depth (team news, lineups,
   rotation, motivation, form and xG, head-to-head, odds, models, venue) and
   pushes `research/<date>.json`. The procedure and rules are in
   [`research/INSTRUCTIONS.md`](research/INSTRUCTIONS.md).
2. **Build.** That push (and a run every 2 hours) triggers GitHub Actions. It
   applies the research to live Polymarket prices and picks the best pair of
   legs with combined odds of 1.85–2.25, or "No bet" if no pair qualifies.
3. **Settle.** Every run marks finished legs won, lost or void from resolved
   Polymarket markets.

The rules come from October's real bets: football only, no domestic cups, no
derbies, draw no bet or double chance when the draw is likely, two legs only,
and no cashing out.

## Your bets

Bets live in `data/stake-bets.json`. To add more, copy Stake's My Bets →
Settled page into a text file and run:

```
npm run import-bets -- pasted.txt
```

Or paste it into "Add bets from Stake" on the My Bets page (those stay in
that browser only).

## Local commands

`npm run candidates`, `npm run check-research`, `npm run pick`,
`npm run import-bets -- file.txt`, `npm run dev`.
