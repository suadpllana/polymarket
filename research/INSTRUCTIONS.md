# Daily research: football only, 2 legs, odds about 2.0

Every morning a scheduled Claude Code task researches today's football games
in depth and pushes `research/<date>.json`. The build then picks **one slip of
exactly two legs from two different games**, with combined Stake odds between
1.85 and 2.25 (target 2.0), and publishes it on the site.

## Daily steps

1. `npm run candidates` writes `research/<date>.candidates.json`: up to 12 of
   today's football games (top European leagues, European cups, Süper Lig,
   Saudi Pro League, Belgian Pro League, Brasileirão, Nations League) that
   have a leg between 1.18 and 1.90. Domestic cups are never listed.
2. Research **every** game in depth: one subagent per game, with every
   checklist item below filled in from sources read today.
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

## Rules

- **Market first.** The de-vigged Polymarket 1X2 price is the starting
  estimate. Research gives its own home/draw/away probabilities, and each may
  move **at most 5 points** from the market (`check-research` enforces it).
  When sources disagree, stay closer to the market.
- **Every move needs a specific, cited reason** from a source read today.
- **Exclude a game** (`"exclude": true`) when any of these is true:
  - a likely starter on either side is doubtful, a game-time decision, or
    reported differently by different sources; or the starting goalkeeper is
    in doubt;
  - the favourite is expected to make 5 or more changes, or the manager has
    talked about rotating, usually around a European night or a bigger game
    within 4 days;
  - it is a derby or a fierce rivalry;
  - one side has nothing to play for, or the favourite has already qualified
    or won what it needed;
  - the manager of either side was sacked or appointed in the last 14 days;
  - the price moved 5% or more (relative) in the last 24 hours with no news
    to explain it;
  - extreme weather, a pitch problem, or a neutral or unusual venue;
  - you cannot verify the fixture (date, teams, competition; not a youth, B
    or women's side);
  - anything critical is still unknown after real attempts: at least two
    different searches plus the club's or league's own pages. Say what you
    tried.
- **Confidence.** `high`: every check is clean and the sources agree.
  `medium`: small doubts that the probabilities already reflect. `low`:
  never bet (treated as excluded).
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

1. For each kept game with medium or high confidence, take the live market
   and apply the research's shift. If the favourite's price moved 5% or more
   since the research, the game is dropped.
2. Every leg must land or be refunded at least 60% of the time. A straight
   win also needs a draw chance of 25% or less.
3. Of all pairs of legs from two different games whose combined odds are
   between 1.85 and 2.25, take the one with the highest expected return; on
   a near-tie, the more likely one.
4. If no pair qualifies, the day is **No bet**. Skipping a day is better than
   forcing a weak slip.

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
      "prices": [{ "book": "Stake", "market": "home", "odds": 1.62 }]
    }
  ]
}
```

- `id`: the game id from the candidates file.
- `p`: home, draw and away must sum to 1, each within 5 points of the
  candidate's `p_market`.
- `prices[].market` is one of `home`, `away`, `home_draw`, `away_draw`,
  `home_dnb`, `away_dnb`.
- An excluded game needs only `id`, `exclude`, `reason`, `main_risk` and at
  least one source.
