# Daily research: any sport, 1 to 3 legs, odds about 2.0, all before 23:00

Every morning a scheduled Claude Code task researches today's games in depth
and pushes `research/<date>.json`. **Any sport is allowed** — football plus
tennis (ATP/WTA tour), basketball (NBA, EuroLeague, EuroCup, Champions
League), ice hockey (NHL, KHL, SHL, Liiga, DEL), NFL, MLB, UFC and tier-1
esports (CS2, LoL, Valorant, Dota 2; no best-of-one). **Every game must start
before 23:00 Belgrade** so the slip is settled before the user goes to sleep;
the candidates list already applies that cut-off. The build then picks **one slip of
one, two or three legs from different games**, with combined Stake odds between
1.85 and 2.25 (target 2.0), and publishes it on the site. **Only legs the
research rates medium or high confidence are ever bet.** The user places
low-confidence bets themselves, so a low-confidence or market-only leg never
appears on the slip. **The user wants a slip every day: no "No bet" days.**
The site shows a slip whenever at least one medium or high leg is still open,
so the only way a day ends without one is when no game passes the research
and the price checks. Your job is to make sure that never happens: research
more games until some do (see "Never leave the day without a slip").

For football, legs can come from any market Polymarket prices: match winner,
double chance, draw no bet, **total goals over/under, both teams to score,
handicaps and each team's goals**. Corners and cards are not available: there
is no market to price them or settle them, so never propose them. Other
sports use the two-way winner market (overtime, shootouts and tie-breaks
included, as Polymarket settles it); their candidates have `p_market.draw`
of 0, and your `p.draw` must stay 0.

## Daily steps

1. `npm run candidates` writes `research/<date>.candidates.json`: up to 16 of
   today's games starting before 23:00 Belgrade, from every sport above (each
   has a `sport` field). For football (top European leagues, European cups, Süper Lig,
   Saudi Pro League, Belgian Pro League, Brasileirão, Nations League) that
   have a leg between 1.18 and 1.90. Each game lists `legs_in_range`: every
   result, goals, both-teams-to-score, handicap and team-goals leg in range,
   with its `key` and market probability `p_market`. Domestic cups are not
   listed on normal days. On thin days (fewer than 6 games in those leagues,
   e.g. an international break) the list also includes every other football
   competition on Polymarket (second divisions, cups, South American and
   other leagues); research them the same way, and check rotation in cups
   with extra care. Always commit the research, even on a thin day.
   To research the evening before, add `--tomorrow` (to `npm run candidates`
   and `npm run pick`) and pass the date to `npm run check-research -- <date>`;
   the morning run then finds the file and stops, so re-check the kept games
   in the morning (`npm run candidates -- --live <ids>`, overnight news, the
   price move since first listing) and re-push the research (the slip is
   rebuilt before its first game).
2. Research the games in **batches of 4**, one subagent per game (use the
   Sonnet model for subagents), following "How to research cheaply without
   losing quality" below. Every *kept* game still gets every checklist item
   filled in from sources read today. **Do not stop until `npm run pick`
   shows a slip of medium or high confidence legs** (high preferred), and
   ideally at least 4 games are kept at medium or high; low-confidence games
   do not count. The user expects a medium/high slip near 2.0 **every day**.
   - When a game ends up low only because a key fact was missing, a second,
     deeper pass on it (more searches, other-language press, odds comparison
     sites) is worth it before moving on.
   - When the first 16 games are used up, run `npm run candidates -- --more`:
     it adds every other game still in the window (every sport Polymarket
     prices: football in all competitions, tennis, basketball, ice hockey,
     NFL, MLB, UFC, esports), keeping the games already listed. Research
     those in further batches of 4.
   - Spend tokens sensibly: up to about 30 games a day is fine, but stop
     launching new batches once a medium/high slip exists and 4 medium/high
     games are kept.
   - Research early: games that start before the research is done are lost.
   Games not reached get the minimal verdict
   `{ "id": "…", "exclude": true, "skipped": true }`, which `check-research`
   accepts. Never use `skipped` for a game that was actually researched.
3. Write `research/<date>.json` (format below) and run
   `npm run check-research` until it prints OK. It refuses kept games with a
   thin checklist or fewer than 4 source sites.
4. `npm run pick` prints the slip the site will publish. If it prints "No
   bet", or a slip marked `Tier: closest` (the legs cannot reach odds near
   2.0), research more games before you push.
5. Commit only the two research files and push to `main`.
   Then **schedule the pre-kickoff check** (see below) with `send_later`
   (Claude Code Remote) for about 100 minutes before the first leg of the slip
   `npm run pick` printed, in Europe/Belgrade time. The user asked for this
   check on every slip. **Always push**,
   even when there are 0 games or nothing could be researched (write
   `"games": []` or `skipped` verdicts and say why in `summary`): the push is
   what triggers today's build. "No bet" should only happen when every game
   in the window has been researched and none can make a medium/high slip;
   say so in `summary`.

### Check the research record first

Before choosing games, run `npm run review` (or look at the Stats page): it
shows how each rating, sport, price band and kind of leg has done against its
market odds. Favour the groups that are working (so far: football rated
medium/high, favourites at 70% or more) and be stricter where they are not.

### Weekly review (every Monday, without being asked)

The owner wants weak links found and removed before they cost a bet.

1. `npm run review`. It flags a group as **WEAK** when it has at least 30
   settled games and is 5 or more points below its market odds.
2. A **WEAK** group gets a stricter rule the same day: for example its legs
   need high confidence (as tennis already does), or it is excluded, or a
   kind of leg is no longer used. Make the change in this file and in
   `scripts/lib/pick.mjs` if the code must enforce it, test it, push, and tell
   the owner in a few lines what changed and the numbers behind it.
3. A group 10 or more points below its odds with 12 to 29 games goes on a
   watch list in the summary: research it more strictly (an honest "low" when
   anything is unverified) but do not change a rule yet.
4. Never loosen a rule on your own. If a restricted group has recovered over
   30 games or more, propose lifting the restriction and wait for the owner.
5. The tennis rule (high confidence only) was made early, at 12 games, with
   the owner's approval; review it once tennis has 30 settled games.

### Never leave the day without a slip

The user's rule (14 Nov 2026): always show the best slip, no "No bet" days.
The safety rules stay as they are (never a low-confidence or market-only
leg, never a game the price checks dropped), so a slip every day comes from
researching enough games, not from loosening a rule.

- Morning: keep researching (`--more`, every sport) until `npm run pick`
  shows a slip in the 1.85–2.25 or 1.70–2.50 range. A `Tier: closest` slip is
  a stopgap, not a finish.
- Midday backup check: if today's research is missing, do the research then.
  A file of `skipped` verdicts only produces "No bet".
- Final check: if a re-check or a price move drops a leg, the slip shrinks to
  the legs that passed; no new legs are added after the morning check (the
  20 Nov lesson below, which the owner saw cost a winning slip). If nothing
  passes, say plainly that it is a no-bet day rather than building a
  last-hour slip.
- A slip the research itself rates weak is still shown; say plainly in the
  summary to the user that it is weak and why.

## Pre-kickoff check (about 100 minutes before the first leg)

Morning research cannot see confirmed lineups, starting goalies or the order
of play; they come out an hour or two before the start. This check is where
a leg can honestly reach **high** confidence, or be dropped.

1. `git checkout main && git pull origin main`. Read today's slip from the
   live site (`https://suadpllana.github.io/polymarket/history.json`). If its
   first leg starts more than 2.5 hours from now, `send_later` this check
   again for about 100 minutes before that leg and stop. If it has already
   started, stop.
2. `npm run candidates -- --live <id>,<id>,…` with the ids you will re-check.
   Like `--more`, it refreshes `data` (odds, 24h move, ratings) and adds any
   new games (give new ones a `skipped` verdict unless you research them). It
   also sets `p_market` and `legs_in_range` of the listed ids to the live
   prices and prints how far each favourite has moved since it was first
   listed. **Never edit `p_first`**: it is the price at first listing, and the
   pick drops any game whose favourite has fallen more than 4% from it.
3. One subagent per slip leg, plus the two or three best medium/high
   alternatives starting in the next three hours. Each one re-checks only
   what changes late: the confirmed or expected XI, starting goalie or order
   of play, late injury or illness news, and the price move since the
   morning. It returns the full updated game object (same id), keeping the
   morning findings that still hold.
   - **high** only when the lineup is confirmed (or announced by the coach),
     nothing new is wrong, the price has not moved against the leg, and the
     odds and rating sources agree.
   - **low** (so the leg is dropped) when late news hurts the favourite: a
     key starter or the goalkeeper out, heavy rotation confirmed, or a price
     move against it with no explanation. "A price move against it" means the
     favourite's chance is down **3% or more (relative) since it was first
     listed** (`p_first`), or its bookmaker price has lengthened the same way.
     If no news explains the move, the answer is low. No exceptions: a clean
     lineup does not cancel an unexplained move.
   - **You check the agent's answer before merging.** If an agent reports
     such a move and still says medium or high, set it to low yourself. If it
     could not find the official XI, the game cannot be high. `check-research`
     fails when a medium/high game's favourite is down more than 4%.
4. Merge the updated objects into `research/<date>.json`, set
   `"stage": "pre_kickoff"` and a new `researched_at`, add a sentence to
   `summary` on what changed, run `npm run check-research` and `npm run pick`,
   then commit as `Pre-kickoff check for <date>` and push. The build rebuilds
   the slip when it still has at least 30 minutes before its first game.
5. Keep it quick: 1-5 subagents, about 10 tool calls each.
6. In the summary to the user, name **one** slip: the one the site shows. Do
   not offer a second "alternative" slip in chat; the user bets from the site.

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
  map-winner legs lost most often. Three legs at most, result markets only (to win,
  draw no bet, double chance).
- **Cashing out cost $757.** Six cashed-out bets would have won. The slip is
  meant to be held to the end.

### 14 Nov 2026: Portugal 1-4 Denmark (lost slip)

The slip had "Portugal over 1.5 goals". Portugal were already through with
nothing to play for, missing four regulars, against a Denmark side that needed
the result, and their price slid from 64.7% to 60.7% during the day with no
news. Every one of those was written in the research, and the leg was still
offered. What changed afterwards:

- **A favourite with nothing to play for against an opponent that needs the
  result is a hard exclusion** (see Rules).
- **The price slide is measured from the first listing** (`p_first`), not
  from the latest price refresh, and more than 4% against the favourite drops
  the game in code.
- **Confidence ranks first in the pick.** That day an all-high slip existed
  and a slip with a medium leg was shown because its expected return was a
  fraction higher.
- **Research no longer lifts a leg.** The day before, "North Macedonia under
  0.5 goals" was on the morning slip at 64% and by the evening its own market
  price was 59.5%, under the 60% bar; only a research view kept it eligible.
  It would have lost. Odds and the bar now come from the market, a leg that
  loses more than 5% of its market chance is dropped, and research can only
  lower a leg.

### 17 Nov 2026: Panathinaikos lost at Virtus (lost slip)

The rules left a 1-leg slip (Hapoel @1.36, which won). To reach 1.8,
Panathinaikos was upgraded from low to medium in a 5-minute check an hour
before tip-off. The injury report and a second price agreed, but the game had
swung 0.71 → 0.79 → 0.725 that day with no news, and no form or season record
was confirmed. It lost and took the slip with it. The original afternoon slip
(Hapoel + Hungary draw no bet) would have paid, since Hungary drew 1-1. What
changed afterwards:

- **A game rated low stays low on the day.** It may only go back to medium
  after a full re-research (every checklist item, 4+ sources), never in a
  last-hour check to reach the odds target. If the rules leave a short slip,
  show it and say so plainly; the owner decides whether to bet it or skip.
- **A thin market needs a second price.** A basketball or hockey game is
  medium only if an independent price (a bookmaker, Kalshi, a dated preview
  with this game's moneyline) agrees with Polymarket within about 5 points.
- **Do not swap the slip in the last hour.** A slip that changes several
  times in a day (as on 17 Nov: three drafts, then a single, then a rushed
  double) is a warning sign, not a feature.

### 20 Nov 2026: the final check swapped out two winning legs (lost slip)

The morning slip was Troyes draw no bet + Espanyol under 1.5 goals. At the
pre-kickoff check Troyes went to low on a price drift with no news, and the
Espanyol under view was dropped on a drift toward goals. The rebuild then
brought in two new legs, Bayern over 2.5 goals and Athletic to win, and both
lost (Bayern 1-1 Köln, Athletic 0-1 Espanyol). Troyes won 3-1 and Espanyol
scored once, so the morning slip would have paid. This is the second
last-hour change in four days (after 17 Nov) that turned a winning slip into
a loss. What changed afterwards:

- **The final check may only remove legs, never add new ones.** If a morning
  leg fails the final check, the slip shrinks to the legs that passed, even if
  the odds fall under the target. Say so plainly; the owner decides whether
  to bet it. No game or view that was not in the morning slip may enter it
  after the morning check.
- **The drift rule above still stands.** One result does not prove that
  dropping Troyes on an unexplained move was wrong; the damage came from the
  rebuild adding fresh legs that had not been through the morning check.
  Until the build itself refuses new legs at the final check, look at the
  rebuilt slip after pushing: if it holds any leg that was not in the morning
  slip, tell the owner plainly that it is a new, last-hour leg and recommend
  betting only the morning legs that passed, or skipping.

## How to research cheaply without losing quality

Excluded games used to get the same depth as kept ones, yet they produced
about half the research output and never reach the slip. The kept games'
standard below is unchanged; the savings come from not over-researching games
that get excluded.

1. **Order the candidates by `coverage` first** (1 = best covered: top-5
   leagues, Champions/Europa League, Nations League, NBA, EuroLeague, NFL,
   NHL, MLB, UFC, CS2/LoL, tennis Slams, Masters and Finals; 2 = smaller top
   divisions, Conference League, EuroCup, Basketball Champions League,
   European hockey, smaller tennis events; 3 = second divisions and other
   competitions). Well-covered games are the ones that can reach medium or
   high. Within the same coverage, research first the games whose best leg's
   `fair_odds` is closest to 1.40 (two legs near 1.40, or three near 1.26,
   multiply to about 2.0).
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
  - extreme weather, a pitch problem, or a neutral or unusual venue;
  - **the favourite has nothing left to play for and the opponent does**: the
    favourite has already secured its aim (qualified, group or title won, or
    cannot be caught or relegated), while the opponent still needs the
    result. Check the table before anything else in `motivation`. When both
    sides have nothing at stake, or the favourite still needs a point, it is
    a soft risk, not an exclusion.
- **Soft risks keep the game.** A doubtful or conflicting starter, a
  goalkeeper doubt, possible rotation, little to play for on both sides, or a
  manager change 8–30 days ago: keep the game, put the risk
  in `main_risk`, lower `confidence`, and move the probabilities to reflect it
  (within the 5-point limit). These used to exclude games and left whole
  days without a slip; almost every game has some doubt. One thing is not a
  soft risk: a price move against the favourite of 3% or more since first
  listing with no news to explain it makes the game `low`.
- **Unknown after real attempts** (two different searches plus the club's or
  league's own pages): keep the game with `low` confidence and leave the
  probabilities at the market. Say what you tried.
- **Choose the market that fits the game.** Look at every leg in
  `legs_in_range`, not just the result legs. When the draw is likely, prefer
  draw no bet, double chance, or a goals market; when two leaky defences
  meet, both teams to score or over goals; when a strong side faces a
  low-scoring opponent, under goals or the favourite's team goals. For each
  goals, both-teams-to-score, handicap or team-goals leg you have a view on,
  give your probability in `views` (within 5 points of its `p_market`). **A
  goals, handicap or team-goals leg without a view is never bet**, so give a
  view for every such leg you have checked against the game's risks, and
  leave out the ones you would not back. A view below the market lowers that
  leg's chance in the pick; a view above the market changes nothing, so spend
  the effort on finding what could go wrong with a leg, not on arguing it up.
- **No basketball, ever (the owner's permanent rule, 19 Nov 2026).** No
  basketball leg of any kind: NBA, EuroLeague, EuroCup, Basketball
  Champions League or any other league or market. Basketball games are not
  listed as candidates and are never researched; the pick drops them too.
  Never suggest one in chat either, not even as an "extra" slip.
- **Tennis needs high.** A tennis leg goes on a slip only at `high`
  confidence: fitness and recent results checked, the order of play
  confirmed, and a second bookmaker price found. Medium tennis is never bet
  (the research record had tennis favourites winning 7 of 12 against 71%
  expected). Research tennis only when the slip still needs a leg.
- **Confidence.** `high`: every check is clean and the sources agree.
  `medium`: small doubts that the probabilities already reflect. `low`:
  real doubts or missing facts; **never bet**. Never raise a game to medium
  just to get a slip: an honest "low" is a valid answer. High is usually only
  reachable in the pre-kickoff check, once lineups are confirmed.
- **Pre-mortem.** Write the single most likely way the favourite fails to win
  (usually a draw or a late equaliser), then look for evidence of exactly
  that: low xG on both sides, an opponent that sits deep and draws often, the
  favourite's poor home or away form, fatigue. If you find it, raise the draw
  probability or exclude.
- **Never invent** injuries, lineups, results, xG, odds or quotes. Unverified
  means excluded, or no move from the market. Never call a pick a lock.

### Other sports: what each `checks` field means

Fill the same nine fields; read them like this:

- **Tennis:** `team_news` fitness, injuries, retirements and withdrawals;
  `lineups` confirmed in the draw / order of play; `rotation` fatigue from
  the previous round and schedule; `motivation` event level, ranking points,
  home crowd; `form` last 10 matches and surface record; `h2h` meetings, on
  this surface especially; `venue_weather` surface, indoor/outdoor, conditions.
  Best-of-five favours the favourite. Retirement rules vary by book.
- **Basketball:** official injury report, rest/load management, back-to-backs
  and travel, starting five, pace and efficiency.
- **Ice hockey:** confirmed starting goalie (the biggest single factor),
  back-to-backs, line combinations, special teams.
- **NFL / MLB:** quarterback and key injuries / confirmed starting pitchers
  and bullpen usage; weather for outdoor games.
- **MMA:** weigh-in results, short-notice replacements, style matchup.
- **Esports:** roster and stand-ins, map pool and likely veto, recent form,
  LAN vs online, patch changes.

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

**Built-in data.** Each candidate may carry a `data` object, fetched by
`npm run candidates`; use it first and cite its `source` URLs:
- `data.odds`: DraftKings decimal prices from ESPN (football, NBA, NHL, NFL,
  MLB), the opening line, and `p_devig` (the margin removed). This is a
  second price source for the `odds` check.
- `data.move_24h`: the favourite's Polymarket price 24 hours ago and now,
  and the relative change.
- `data.rating`: a bookmaker-free model, Tennis Abstract Elo for tennis
  (`p_home` overall, hard and blended) or World Football Elo for national
  teams (`expected_score_home`, where a draw counts half). This is the
  `models` check.

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

1. Only kept games with **medium or high** confidence are used. The game is
   dropped if the favourite's price moved 5% or more either way since the
   latest research, or fell more than 4% since the game was first listed
   (`p_first`; re-checks and price refreshes never reset it). A single leg is
   dropped when its own market chance fell more than 5% since it was first
   listed (`legs_first`).
2. **The market is the starting point and research is a filter.** Odds, the
   odds range and the 60% bar come from the live market price. Research (1X2
   `p` and `views`) can lower a leg's chance, and with it rule the leg out,
   but never raises a leg above the market's own number. A goals, handicap
   or team-goals leg needs a research view to be used at all. Every leg must land
   or be refunded at least 60% of the time on both numbers. A straight win
   also needs a draw chance of 25% or less on both.
3. Of all slips of one, two or three legs from different games, confidence
   decides first: the slip with the fewest medium legs wins, so an all-high
   slip always beats one with a medium leg. Between slips of equal
   confidence, the one most likely to land or refund; on a near-tie, the
   higher expected return.
4. The pick tries combined odds 1.85–2.25 first, then 1.70–2.50. If neither
   has a slip, it takes the slip nearest to that range that the eligible legs
   can make (`Tier: closest`; shorter odds are preferred to longer), so any
   eligible leg gives a slip. The site labels which tier it used.
   Low-confidence legs, unresearched (market-only) legs and hard-excluded
   games are never used; only a day with no eligible leg at all is **No bet**.
5. Until the research arrives there is no slip (no market-only slips).
6. A published slip is rebuilt if one of its legs is no longer bettable (for
   example, newer research downgraded it), when research is pushed again
   before its first game starts, and when a build finds that the price has
   moved against one of its games as in step 1 (that game is dropped; if no
   eligible leg is left the day shows "No bet" until more games are
   researched).

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
