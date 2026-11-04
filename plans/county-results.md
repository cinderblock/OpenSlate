# County results on Live (election night 2026-11-03)

> Plan path: `plans/county-results.md`. Read this first when resuming. Builds on
> `plans/live-race-tracker.md` (the Live page and the Secretary of State relay).

## Goal

Live results show local races (city, county, school, special district, local
measures) from each county's own election-night feed, which can lead the
Secretary of State. California only.

## Decisions (from the user, don't re-ask)

- Through our relay by default (a crowd costs a county one request per minute);
  Settings may pick a direct connection (`routing.ts` PROVIDERS, `county-ca`).
- **No automatic fallback** relay → direct.
- Gentle on county servers: cache, coalesce, honest User-Agent
  (`OpenSlate election-results relay (+https://openslate.us)`), no aggressive polling.
- Ship the first working county early, add more after.

## Design

- `packages/core/src/countyResults.ts`: the county feed registry
  (`CA_COUNTY_FEEDS`: slug → kind, upstream base, results page, `cors`), the
  relay's allowlist (`feedPathTtl`), parsers (`parseClaritySummary`,
  `parseLvtCsv`), and `isStateContest` (what the Secretary of State already
  reports). Exported from core's index (see "Things not to do").
- `apps/poll-cache/src/countyCa.ts`: `/api/county-ca/<slug>/<file>`. Same
  pattern as `sosCa.ts`: coalesced, Clarity's version pointer and the LVT CSV
  kept 60 s, Clarity's versioned files an hour, errors 15 s, expired entries
  pruned. Mounted by the worker and apps/server.
- Web `lib/countyCa.ts`: fetch, normalize to `ContestResult`. Watch-list ids
  `county-ca/<slug>/<key>`. One query per county (`["sos-ca","county-ca",slug]`,
  so the Live refresh bar covers it); cards pick their contest.
- Live: a place with a county that has a feed shows "+ Local races": a picker
  of the county's local contests, and "Add all N local races for <place>"
  (`contestsForPlace`: the place's city/district names found anywhere in a
  title; the county's own contests; judges; another council district of the
  place's city left out when its council district is known). Places store the
  area they were added from (`WatchGroup.area`).

## County survey (checked 7:00–7:35 PM PST, 03:00–03:35Z)

Wired up (11 counties):

| County | Feed | Format | CORS |
| --- | --- | --- | --- |
| Santa Clara | Clarity `CA/Santa_Clara/127570` | `current_ver.txt` → `<ver>/json/en/summary.json` | `*` |
| Contra Costa | Clarity `CA/Contra_Costa/127405` | same | `*` |
| Marin | Clarity `CA/Marin/127071` (settings say 8/3/2026; it's "November General 2026") | same | `*` |
| Sonoma | Clarity `CA/Sonoma/127275` | same | `*` |
| Ventura | Clarity `CA/Ventura/127362` | same | `*` |
| San Diego | `livevoterturnout.com/ENR/sandiegocaenr/25/summary_25.csv` | CSV | none |
| Orange | `…/orangecaenr/24/summary_24.csv` | CSV | none |
| Riverside | `…/riversidecaenr/12/summary_12.csv` | CSV | none |
| San Bernardino | `…/sanbernardinocaenr/3/summary_3.csv` | CSV | none |
| San Mateo | `…/sanmateocaenr/20/summary_20.csv` | CSV | none |
| Solano | `…/solanocaenr/21/summary_21.csv` | CSV | none |

| Sacramento | `results.saccounty.gov/results/public/api/elections/sacramento-county-ca/69/data` | own JSON (`ballotItems[]`, `election.asOf`), 374 KB | none |
| Los Angeles | `results.lavote.gov/electionresults/json?electionid=4348` | own JSON (`Election.ContestGroups[].Contests[]`, top-level `Timestamp` in California time with no zone), 193 KB, no ids/precincts | none |

(13 counties. LA answered our honest User-Agent at 7:39 PM PST, despite the
survey's Imperva note; Sacramento's `/data` has no CORS header, though the
survey thought so.)

Not yet (by value):

- **San Francisco**: Dominion `summary.xml` in a new folder per report under
  `sfelections.org/results/20261103/data/<folder>/`; site blocks non-browser UAs.
  Rechecked 12:13 PM PST 11/4 (20:13Z): CloudFront 403 ("Request blocked") for
  our honest UA on `/results/20261103/` and `/data/`, for curl's default UA, and
  for headless Chromium (`HeadlessChrome/156`). So the folder discovery couldn't
  be seen without posing as a regular browser; stopped there (user's rule).
- **San Joaquin**: election 22 is right (`<input id="electid" value="22">` on
  `livevoterturnout.com/ENR/sanjoaquincaenr/22/en/Index_22.html`, linked from
  sjgov.org/department/rov/results; page "updated 11/4/2026 1:11 AM"). But this
  county turned LVT's downloads off: its page has no Reports tab (San Diego's has
  `DownloadReport('summary','csv')` etc.), and `summary_22.csv` is a 404 now
  (12:10 PM PST 11/4). LVT's `DownloadReport` (`/ENR/shared/scripts/LiveResultsScripts_v4.2.js`)
  builds `../summary_<id>.csv`, `../contests_<id>.csv`, … so there's no other
  name to try. Only the HTML index (407 KB) carries the counts.
- **Alameda**: `alamedacountyca.gov/rovresults/260/` (linked from acvote's
  elections page, election id 260) is server-rendered HTML, 341 KB, 148 race
  panels (`racePanelHeading`, `resultsRow`/`resultsCol`), "Last Updated:
  Wednesday, November 04, 2026; 2:07 AM". Its scripts (`js/results.js`,
  `refresh.js`) load no data. Only the ranked-choice races (Albany, Berkeley,
  Oakland, …) have XML: `loadrcv.js` fetches `<race>/RcvDetailedReport.xml`
  (race like `Oakland/001-Mayor`; base path not confirmed),
  one file per race. No feed for the whole count.
- Kern (HTML app), Fresno / Placer / Santa Cruz / Monterey (PDF).

Formats:

- Clarity `summary.json`: `K` key, `C` title, `CAT` category (differs by county:
  "State and Federal", "Federal", "State", "Results"…), `VF`, `TP`/`PR`
  precincts, `CH` choices, `P` parties, `V` votes, `PCT` percents. Time: the
  versioned file's `Last-Modified`.
- livevoterturnout CSV: title line, county, header, a "Total Precincts Reported"
  row, then one row per choice. Columns differ by county; read by name
  (`Contest Name`, `Candidate Name`, `Party`, `Total Votes`, `Number Of
  Precincts`, `Precincts Reported`, optional `Vote For`). `*` before a name =
  incumbent; Orange appends " (DEM)". No contest id: keyed by name. Upstream
  sends `no-cache`; time from `Last-Modified`.

## Findings / gotchas

- A push can fail to start Workers Builds (8:30 PM PST, `a1c7349`): check
  that the commit has "Workers Builds: openslate-web" check runs
  (`gh api repos/{owner}/{repo}/commits/<sha>/check-runs`). If none after a
  few minutes, an empty commit starts one; don't touch the Cloudflare dashboard.

- Clarity's `elections.json` lists nothing for CA counties: election ids come
  from each ROV's results link.
- County titles vary wildly ("CITY OF ANTIOCH  MEMBER  CITY COUNCIL  DISTRICT 1",
  "State of California Governor", "San Bernardino County PROPOSITION 42",
  "11th Assembly District"). The first matcher (entity before the first comma)
  broke on them; replaced by finding names anywhere in the title. Checked
  against all 11 real feeds: no state contest left among the local ones (only
  city treasurers, which are local).
- Ventura files appellate judges under "State": judges are always local here
  (the Secretary of State's results don't carry them).
- Several ROV websites (contracostavote.gov, sfelections.org, voteinfo.net,
  kernvote.com, countyofmonterey.gov) 403 our honest UA; the feed hosts don't.
- Recheck of the 9 late counties, 12:12 PM PST 2026-11-04 (20:12Z), one pass
  through the relay, parsed with core's parsers: every one carries votes in
  every local contest (the only zeros: Ventura's Antelope Valley-East Kern
  Water Division 1 and Sacramento's El Dorado Irrigation Division 4, both 0
  registered voters in that county). No feed URL or election id changed.
  Latest reports then: Contra Costa 12:11 AM, Marin 12:35 AM, Sonoma 12:39 AM,
  Ventura 4:39 AM, Riverside 4:22 AM, San Mateo 2:03 AM, Solano 12:07 AM,
  Sacramento 1:36 AM, LA 3:11 AM PST (Nov 4).
- **Sacramento's `election.asOf` does move** (Oct 30 at the zero report → 1:36
  AM PST, 09:36Z). Its `Last-Modified` is just the response time (20:12:06Z on
  a 20:12Z fetch), so it "moved" on election night without a new report. Keep
  `asOf`. The election also has `lastUpdated` (1:35 AM), `publishDate` (1:36
  AM), and a `customPublicMessages` note "Next Update on 11/6/2026 @ 4:15 p.m."
  (possible later idea: show a county's next-update note).
- **LA has a time after all**: top-level `Timestamp` beside `Election`,
  `"2026-11-04T03:11:55.89"`, no zone. It's California's clock (3:11 AM PST);
  read as UTC it would be 7:11 PM election night, before the polls closed.
  `parseLaVote` returns `{ contests, asOf }` (`californiaTime`, real zone
  rules): `4b306c7`. The hand-made fixture had no `Timestamp`, which is how it
  was missed.
- **Riverside's `Precincts Reported` is the county's** (1206 on every row,
  beside a ward's 11 precincts): "10963.6% of precincts" on the live site. Read
  as countywide when any row exceeds its contest's total: `44bf816`. San Mateo
  and Solano report per contest. Contra Costa (Clarity `PR` 0) and Solano still
  say 0 precincts reporting with all votes in: the cards leave precincts out
  then (`8fca2b0`), which is right.
- Solano lists "Unassigned write-ins" and "Rejected write-ins" as choices (0
  rejected so far). Left alone; rejected ones would count toward percents if
  they ever have votes.

## Progress log

- [x] core registry + Clarity parser + tests
- [x] relay route (worker + server) + tests
- [x] web adapter + routing provider (`county-ca`)
- [x] Live UI: "+ Local races" per place: picker, and "Add all N local races" (name match)
- [x] Santa Clara: `4d4ebc9`, pushed 7:15 PM PST (03:15Z); relay live 7:16 PM
- [x] CI lint was already red from a peer's `sosCa.ts` formatting: fixed in `4f988fc`
- [x] live check 7:25 PM PST: headless Chromium on openslate.us, a Sunnyvale place → "Add all" added 16 local races through api.openslate.us, no page errors
- [x] county measure cards don't repeat the title: `1095a34`
- [x] Contra Costa, Marin, Sonoma, Ventura + title-based matching: `2775d2f`, pushed 7:31 PM PST
- [x] San Diego, Orange, Riverside, San Bernardino, San Mateo, Solano (CSV): `63583f0`, pushed 7:35 PM PST
- [x] live check 7:37 PM PST: all 11 county paths 200 through api.openslate.us (`max-age=60`, upstream `Last-Modified`)
- [x] Irvine place on the live site: found "NORTH ORANGE COUNTY COMMUNITY COLLEGE DISTRICT" taken as the county's own; fixed `63ce4bc`
- [x] Sacramento: `a850540`; Los Angeles: `63f24e7` (relay adds `?electionid=4348`; client can't change it)
- [x] LA place on the live site: own council district only (3rd), city measures/offices, courts; county measures and sheriff were missing, fixed `f918124`
- [x] README: `1dd52d1`
- [x] catalog link: `catalogRaceFor` (same people, or measure letter + place) and a "endorsements for this race" link on county cards when the catalog is already on the device: `a260890` (also carried peers' `b2bd99d`, `3b71dfb` to origin)
- [x] headless check of the catalog link on the live site (7:52 PM PST): Sunnyvale place, 8 links, all to the right races (council 3, school boards, Measures G/H/I)
- [x] first real counts through the relay at 8:07 PM PST (04:07Z): Santa Clara (version 384997), San Diego, Orange and San Bernardino carry votes in every local contest; parsed with the same code the site runs
- [x] still at their zero report at 8:07 PM: Contra Costa, Marin, Sonoma, Ventura, Riverside, San Mateo, Solano, Sacramento, Los Angeles. Rechecked 12:12 PM PST Nov 4 (20:12Z): all carry real votes (see Findings). Sacramento's `asOf` moves; its `Last-Modified` is the response time, so `asOf` stays. LA's `Timestamp`: `4b306c7`. Riverside's countywide precincts: `44bf816`. Headless on openslate.us 12:29 PM PST (20:29Z), after both deployed: a place per county (Antioch, San Rafael, Santa Rosa, Oxnard, Riverside, East Palo Alto, Vallejo, Elk Grove, Pasadena) had its local races added on their own and every card counted (e.g. Antioch D1 Motts 1,795 / Torres-Walker 1,519; Elk Grove D4 Robles 3,777; EPA Measure O 1,949 / 741); one or two relay requests per county, no page errors; LA cards say "Source updated: 3:11 AM PST"; Riverside's Ward 2 "100% of precincts". Over-inclusion found (Sonoma's and Ventura's `County` category): logged in ISSUES.md, `3cb93c6`
- [x] User report 8:12 PM PST: East Palo Alto voter saw only propositions, no Measure O. Cause: local races appeared only after "+ Local races" → "Add all" (a small link). Fixed `d34a609`: a place's local races and measures are added on their own once its county count is in (once: removed ones stay removed); legacy "Where I vote" places use the voter's area and county; a place with no county is prompted to pick one. Checked live 8:16 PM: an EPA place shows Measure O with no clicks
- [x] San Mateo's first report 8:15 PM PST: EPA Measure O Yes 1,171 (73.7%), No 418
- [x] Two-thirds / 55% measures were called "Passing" past 50%: `b0778c0` reads the threshold from the title, shows "(needs two-thirds)"
- [x] "0% of precincts" beside counted mail ballots: `8fca2b0` leaves precincts out until one reports
- [x] User report 8:19 PM PST: "Add one race" didn't offer local measures. `3310cbc`: a county picker (starts on a watched place's county, else the voter's), that county's local races and measures first in the list. Checked live 8:23 PM: "Measure O" → East Palo Alto Measure O added
- [x] User ask 8:25 PM PST: show both the last check time and the source's last change time. `a1c7349`: "Changed <source's time> · Checked <last fetch>", local first with UTC smaller beside it; LA (no time in its feed) says "New by <first seen>"; the reporting line's `title=` removed (no hover tooltips). Workers Builds never started for `a1c7349` (no Cloudflare check run on it; GitHub's ran); empty commit `4a086f9` triggered it. Live 8:42 PM PST, checked on Governor, EPA Measure O, LA County Measure A
- [x] User report 8:48 PM PST (phone): still "Updated 8:15 PM PST" after a refresh. Cause: the PWA (autoUpdate: skipWaiting + clientsClaim) installs a new version in the background, but the page keeps its old code until the next load. `3579416`: `WebUpdateBanner` (apps/web/src/components/WebUpdate.tsx) reloads a page a new version takes over when it isn't in view, else offers "OpenSlate was updated · Reload"; open pages check for a new version every 5 min and on coming back into view. Kept autoUpdate: "prompt" mode would leave current clients waiting until every tab closes. Same commit: "Last checked: …" / "Last change: …" on their own lines (the user's wording); the measure row wraps on a phone instead of squeezing "(needs two-thirds)". Checked live 8:56 PM at 402 px, dark
- [x] User ask ~9 PM PST: tell the source changing its data apart from this race's data changing. Sources give one time per report (county file, state report). `b0f59b1`: `lib/raceChanges.ts` keeps each watched race's numbers (votes, precincts) and the source's time for the first report they appeared in (localStorage `openslate.raceChanges.v1`, in Your data). Cards: "Last checked", "Source updated", "This race changed" (+ "or earlier" when OpenSlate didn't see the report that set the numbers). Highlight and "Recently updated first" follow the race. Live 10:51 PM PST; a returning visitor (simulated) shows source 9:59 PM vs race 9:00 PM
- [x] User ask ~11 PM PST: log and chart each race's votes and % reporting over time. `42cb0f2`: `lib/raceHistory.ts` logs a point per report that changes a watched race (source time, votes per choice in first-seen order, precincts %), localStorage `openslate.raceHistory.v1` (Your data), 300 per race; `RaceHistoryChart.tsx`: votes chart + separate precincts chart (no dual axis), readout with Earlier/Later buttons (no hover-only info, no `title=`), table. Colors: dataviz reference palette as `--series-1..8` (validated vs --surface light and dark); Yes/No = blue/orange because the app's green/red fails CVD on dark (ΔE 4.7). Checked live 11:10 PM PST at 402 px, light and dark
  - Limits: history starts when this browser first watched the race, and only reports seen while a page was open are logged (a closed page misses intermediate reports; the next one seen is logged). No source offers past reports to backfill from (Clarity's old versions aren't listed).
- [ ] My ballot / race pages showing a race's county count (reuse `catalogRaceFor`): handed to its own thread, "County counts on My ballot and race pages" (plan `plans/county-counts-on-ballot.md`), 2026-11-04
- [x] San Francisco, San Joaquin, Alameda: thread "County results: add San Francisco, San Joaquin, Alameda" surveyed again 12:05–12:20 PM PST 11/4 (20:05–20:20Z). No machine-readable feed reachable with our honest UA in any (see "Not yet")
- [ ] San Joaquin / Alameda from their HTML pages: only if the user says yes (asked 11/4). SF stays out unless it stops blocking our UA
- [ ] Recheck of the zero-report counties above: handed to thread "County results: recheck feeds still at zero", 2026-11-04
- [ ] Race search ranking ("Measure O" not first for its own name): handed to thread "Results: race search fixes" (plan `plans/race-search.md`), 2026-11-04
- [ ] Whole-night history stored on our side (user ask, 2026-11-04): waiting on the user's choice of storage, see Open questions

## Open questions for the user

1. Where should the relay keep race history? (Asked 2026-11-04; user: cost is
   fine, wants options compared.) Recommendation: one SQLite-backed Durable
   Object per feed in openslate-poll-cache, the "recorder". Needs a DO binding
   and migration in `apps/poll-cache/wrangler.toml`; an R2 bucket for raw
   report copies is optional. Not built until the user says yes to that change.

   What the user asked for (2026-11-04):
   - Checks once a minute from the first county release on election night,
     slowing to hourly by morning, until the count is done.
   - Clients get a new report as soon as the server has it: checks lined up
     with the server's, or pushed.
   - Checks faster than once a minute around a county's announced release time.
   - No backfill from the user's browsers (more trouble than it's worth).

   Design:
   - DO alarms run the checks (sub-minute is possible; Cron Triggers stop at
     1 min). After a change: once a minute for an hour, then slowing to hourly.
   - In a window around an announced release (a hand-kept list in the repo),
     check every 10–15 s. Use only the small pointer (Clarity
     `current_ver.txt`) or a conditional GET; whether LVT and the others
     answer 304 is not yet checked.
   - Store one row per contest per change.
   - Push new reports to open pages over hibernating WebSockets (outgoing
     messages are free). Pages without a socket poll our relay just after
     its next check. Never fall back to a county.
   - Stop: "100% of precincts" is NOT the end in California. Governor showed
     100% at 8:08 AM on Nov 4 while counting goes on for weeks. Keep checking
     hourly until the county certifies or marks its results final. Counties
     must finish the canvass by Dec 3, 2026; the Secretary of State certifies
     by Dec 11, 2026, a hard stop.

   Estimated use (Nov 3 – Dec 11):
   - About 185 sources × about 1,500 checks = about 280k alarms.
   - About 130k rows written; about 20 MB stored.
   - All within the plan's included amounts.
   - Worst case: crowded-night relay misses reaching the DO could reach a
     few million requests a day, at $0.15 per million.

   Found 2026-11-04: ops `openslate.yaml` sets `tiered_cache: smart` on the
   zone, but `apps/poll-cache/wrangler.toml` says Tiered Cache is off. One of
   them is stale; not checked which.

## Things not to do

- Don't import `@openslate/core/<subpath>` from apps/web: its Vite alias maps
  only `@openslate/core` to `src/index.ts`, so subpaths break the build (tsc and
  bun test pass anyway). Export from core's index instead.
- Don't write regexes through bash heredocs/python in Git Bash: backslashes
  were eaten (`\b` became a backspace). Use the Edit/Write tools.
- The Results page is `/#/results` (hash router): `https://openslate.us/results` is a 404 with an empty body, so a headless check that goes there sees a blank page.
- Don't edit LivePanel.tsx's headings/civicAPI wording: another thread has
  uncommitted changes there (7:33 PM PST).
