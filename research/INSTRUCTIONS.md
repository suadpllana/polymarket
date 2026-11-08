# Daily research: football only, 2 legs, odds about 2.0

Every morning a scheduled Claude Code task researches today's football games
in depth and pushes `research/<date>.json`. The build then picks **one slip of
exactly two legs from two different games**, with combined Stake odds between
1.85 and 2.25 (target 2.0), and publishes it on the site. **There is a slip
every day**: if too few games pass the research, the build widens the range
and, last, uses market-priced legs (see "How the slip is picked").

Legs can come from any market Polymarket prices for the game: match winner,
double chance, draw no bet, **total goals over/under, both teams to score,
handicaps and each team's goals**. Corners and cards are not available: there
is no market to price them or settle them, so never propose them.

## Daily steps

1. `npm run candidates` writes `research/<date>.candidates.json`: up to 16 of
   today's football games (top European leagues, European cups, Süper Lig,
   Saudi Pro League, Belgian Pro League, Brasileirão, Nations League) that
   have a leg between 1.18 and 1.90. Each game lists `legs_in_range`: every
   result, goals, both-teams-to-score, handicap and team-goals leg in range,
   with its `key` and market probability `p_market`. Domestic cups are never
   listed.
2. Research the games in **batches of 4**, one subagent per game (use the
   Sonnet model for subagents), following "How to research cheaply without
   losing quality" below. Every *kept* game still gets every checklist item
   filled in from sources read today. **Keep going until at least 6 games are
   kept** (any confidence) or the list runs out; most days that is every game.
   Games not reached get the minimal verdict
   `{ "id": "…", "exclude": true, "skipped": true }`, which `check-research`
   accepts. Never use `skipped` for a game that was actually researched.
3. Write `research/<date>.json` (format below) and run
   `npm run check-research` until it prints OK. It refuses kept games with a
   thin checklist or fewer than 4 source sites.
4. `npm run pick` prints the slip the site will publish, or "No bet".
5. Commit only the two research files and push to `main`.

## What October's real bets taught us

From the 60 Stake bets in `data/stake-bets.json` (see the Stats page):

- **Football made money, CS2 lost it.** Football-only bets: +$529. CS2-only
  bets: −$156. So: football only.
- **Draws are the main killer.** 8 of the 12 losing football "to win" legs
  ended level (Juventus–Rennes 2-2, Brighton at Jablonec 0-0, Fenerbahçe–Slavia
  2-2, Bayern at Augsburg 2-2, Dortmund–Bremen 2-2, Cagliari–Juventus 1-1,
  Getafe–Rayo 1-1, Man City–Brighton level after 90). Estimate the draw chance
  explicitly for every game. A straight win is only allowed when the draw is
  25% or less; otherwise the leg must be draw no bet or double chance.
- **Rotation loses favourites.** Man City lost a 1x2 leg in the EFL Cup with a
  rotated side. Domestic cups are out, and every game needs a rotation check
  against the previous and next fixtures.
- **Derbies are coin flips.** Chelsea lost 0-2 to Tottenham. Exclude derbies
  and fierce rivalries.
- **Long multis rarely land.** 4+ leg bets won 1 of 8; correct-score and
  map-winner legs lost most often. Two legs only, result markets only (to win,
  draw no bet, double chance).
- **Cashing out cost $757.** Six cashed-out bets would have won. The slip is
  meant to be held to the end.

## How to research cheaply without losing quality

Excluded games used to get the same depth as kept ones, yet they produced
about half the research output and never reach the slip. The kept games'
standard below is unchanged; the savings come from not over-researching games
that get excluded.

1. **Order the candidates** by how close their best leg's `fair_odds` is to
   1.40 (two legs near 1.40 multiply to about 2.0). Research the closest first.
2. **Stage 1: the hard-exclusion gate** (cheap). For each game check only
   the **hard** exclusion rules below. Stop at the first one that applies:
   write the short excluded verdict (`id`, `exclude`, `reason`, `main_risk`,
   1-3 sources) and do nothing more for that game. Do not fill `checks` for
   excluded games. Soft risks never stop a game at this stage.
3. **Stage 2: full depth, only for games that pass stage 1.** Fill all nine
   checks, the pre-mortem, the 5-point-limit probabilities and 4+ sources
   exactly as the checklist requires.
4. **Search before fetching.** Use WebSearch snippets first and WebFetch only
   the specific pages that answer an open question. Reuse league-wide
   preview pages across games of the same matchday instead of re-fetching.
   Budget about 8 tool calls per game for stage 1 and 12 more for stage 2.
   If a fact is still missing after that, say what was tried and exclude, as
   the "unknown after real attempts" rule already says.
5. **Subagents return only the finished game object** (the JSON in the
   format below), not notes or a narrative. The main task merges them,
   writes the summary, and runs `npm run check-research`.

## Rules

- **Market first.** The de-vigged Polymarket 1X2 price is the starting
  estimate. Research gives its own home/draw/away probabilities, and each may
  move **at most 5 points** from the market (`check-research` enforces it).
  When sources disagree, stay closer to the market.
- **Every move needs a specific, cited reason** from a source read today.
- **Hard exclusions** (`"exclude": true`). Only these remove a game:
  - you cannot verify the fixture (date, teams, competition; not a youth, B
    or women's side), or it is postponed or not being played today;
  - the favourite is **confirmed** to field a heavily rotated side: an
    official or near-official XI, or the manager saying so, with 5 or more
    changes;
  - it is a derby or a fierce rivalry;
  - the manager of either side was sacked or appointed in the last 7 days;
  - extreme weather, a pitch problem, or a neutral or unusual venue.
- **Soft risks keep the game.** A doubtful or conflicting starter, a
  goalkeeper doubt, possible rotation, little to play for, a manager change
  8–30 days ago, or a 5%+ price move with no news: keep the game, put the risk
  in `main_risk`, lower `confidence`, and move the probabilities to reflect it
  (within the 5-point limit). These used to exclude games and left whole
  days without a slip; almost every game has some doubt.
- **Unknown after real attempts** (two different searches plus the club's or
  league's own pages): keep the game with `low` confidence and leave the
  probabilities at the market. Say what you tried.
- **Choose the market that fits the game.** Look at every leg in
  `legs_in_range`, not just the result legs. When the draw is likely, prefer
  draw no bet, double chance, or a goals market; when two leaky defences
  meet, both teams to score or over goals; when a strong side faces a
  low-scoring opponent, under goals or the favourite's team goals. For each
  goals, both-teams-to-score, handicap or team-goals leg you have a view on,
  give your probability in `views` (within 5 points of its `p_market`). The
  build applies the views to the live prices and picks the best pair.
- **Confidence.** `high`: every check is clean and the sources agree.
  `medium`: small doubts that the probabilities already reflect. `low`:
  real doubts or missing facts; used only when nothing better qualifies.
- **Pre-mortem.** Write the single most likely way the favourite fails to win
  (usually a draw or a late equaliser), then look for evidence of exactly
  that: low xG on both sides, an opponent that sits deep and draws often, the
  favourite's poor home or away form, fatigue. If you find it, raise the draw
  probability or exclude.
- **Never invent** injuries, lineups, results, xG, odds or quotes. Unverified
  means excluded, or no move from the market. Never call a pick a lock.

## Deep-research checklist (every kept game, all required)

Fill each `checks` field with what you found, in a sentence or two:

| Field | What to find |
|---|---|
| `team_news` | Injuries, suspensions and doubts for **both** teams, from the club, the manager's press conference, or a reliable reporter |
| `lineups` | Predicted XIs from at least two lineup sources, and whether they agree |
| `rotation` | Each team's last and next fixture, any midweek Europe or cup game, and how many changes are expected |
| `motivation` | Table position, what the game is worth, derby or rivalry, manager situation |
| `form` | Last 6–10 games for both sides: results, goals, xG for and against, home and away split |
| `h2h` | Recent head-to-head and the style matchup, especially how often it ends level |
| `odds` | Prices from at least two bookmakers or exchanges, de-vigged, and how they moved |
| `models` | Model forecasts: Opta, ClubElo, FiveThirtyEight-style or other bookmaker-free models |
| `venue_weather` | Venue, travel, pitch and weather |

Use sources from **at least 4 different sites** per kept game. Good ones:

- **All leagues:** club sites and press conferences; Sports Mole;
  SportsGambler; FotMob; FBref; Understat; ClubElo; Opta Analyst.
- **Odds:** the ESPN scoreboard API (DraftKings odds in
  `competitions[0].odds`) and odds comparison sites. For Polymarket history,
  look up the market's `clobTokenIds` at
  `gamma-api.polymarket.com/events?id=<game id>`, then fetch
  `clob.polymarket.com/prices-history?market=<token>&interval=1d&fidelity=60`.
- **League press:**
  - Serie A: Fantacalcio, Sky Sport Italia.
  - Bundesliga: Ligainsider, Kicker.
  - La Liga: Marca, AS, Mundo Deportivo, Comuniate.
  - Ligue 1: L'Équipe, Foot Mercato.
  - Eredivisie: VoetbalPrimeur, Voetbal International.
  - Portugal: Record, A Bola, O Jogo.
  - Turkey: Fotomaç, Fanatik.

Privacy: send only a generic browser User-Agent and never put personal data
in request headers. If a site rate-limits you or shows a CAPTCHA, stop
querying it.

## Bookmaker prices

For each kept game, try to find the **Stake** and **Rainbet** prices for the
legs in `legs_in_range` (the book's own event page first, then searches like
`<home> vs <away> odds stake`). Both often block automated visitors. Record
only a price you actually saw today for the exact same market. If you find
none, leave `prices` empty and the slip shows an estimate: the fair price
minus 3%.

## How the slip is picked (scripts/lib/pick.mjs)

1. For each kept game, take the live market and apply the research's shift
   (1X2 `p` and `views`). If the favourite's price moved 5% or more since the
   research, the game is dropped.
2. Every leg must land or be refunded at least 60% of the time. A straight
   win also needs a draw chance of 25% or less.
3. Of all pairs of legs from two different games, take the one with the
   highest expected return; on a near-tie, the one with more research, then
   the more likely one.
4. **There is always a slip.** The pick tries these steps in order and the
   site labels which one it used:
   1. kept games with medium or high confidence, combined odds 1.85–2.25;
   2. kept games of any confidence, combined odds 1.70–2.50;
   3. adds games the research skipped or never reached, priced from the
      market alone, combined odds 1.70–2.50;
   4. every game that was not hard-excluded, legs landing at least 50% of the
      time, combined odds 1.50–3.00.
   Hard-excluded games are never used. Only a day with fewer than two games
   on is "No bet".
5. If the research has not arrived by 12:00 Belgrade, the slip is built from
   market prices alone (steps 3–4).

At combined odds of 2.0 the bookmaker's own price says a slip lands about
48% of the time. Good research aims to push that a few points higher. No
research can make a 2.0 slip land 4 times in 5.

## Format: `research/<date>.json`

```json
{
  "date": "2026-11-01",
  "researched_at": "2026-11-01T06:40:00Z",
  "summary": "One paragraph: games kept and excluded, the main reasons.",
  "games": [
    {
      "id": "1209203",
      "exclude": false,
      "confidence": "high",
      "p": { "home": 0.6, "draw": 0.22, "away": 0.18 },
      "checks": {
        "team_news": "…", "lineups": "…", "rotation": "…", "motivation": "…",
        "form": "…", "h2h": "…", "odds": "…", "models": "…", "venue_weather": "…"
      },
      "reason": "Why these probabilities, citing the key facts.",
      "main_risk": "The single most likely way the favourite fails.",
      "sources": ["https://…", "https://…", "https://…", "https://…"],
      "views": { "ou_2.5_over": 0.66, "btts_yes": 0.58 },
      "prices": [{ "book": "Stake", "market": "home", "odds": 1.62 }]
    }
  ]
}
```

- `id`: the game id from the candidates file.
- `p`: home, draw and away must sum to 1, each within 5 points of the
  candidate's `p_market`.
- `views` (optional): your probability for goals, both-teams-to-score,
  handicap or team-goals legs, keyed by the `key` in `legs_in_range`, each
  within 5 points of that leg's `p_market`.
- `prices[].market` is a leg `key`: `home`, `away`, `home_draw`, `away_draw`,
  `home_dnb`, `away_dnb`, or any key from `legs_in_range`.
- An excluded game needs only `id`, `exclude`, `reason`, `main_risk` and at
  least one source.
