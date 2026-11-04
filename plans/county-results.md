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
| Los Angeles | `results.lavote.gov/electionresults/json?electionid=4348` | own JSON (`Election.ContestGroups[].Contests[]`), 193 KB, no ids/precincts/time | none |

(13 counties. LA answered our honest User-Agent at 7:39 PM PST, despite the
survey's Imperva note; Sacramento's `/data` has no CORS header, though the
survey thought so.)

Not yet (by value):

- **San Francisco**: Dominion `summary.xml` in a new folder per report under
  `sfelections.org/results/20261103/data/<folder>/`; site blocks non-browser UAs.
- **San Joaquin**: `sanjoaquincaenr/22/summary_22.csv` answered HTML; recheck.
- Alameda (HTML only), Kern (HTML app), Fresno / Placer / Santa Cruz / Monterey (PDF).

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
- [ ] still at their zero report at 8:07 PM: Contra Costa, Marin, Sonoma, Ventura, Riverside, San Mateo, Solano, Sacramento, Los Angeles. Recheck later tonight; for Sacramento, check that `election.asOf` in `/data` moves (its `Last-Modified` did, its `asOf` still said Oct 30), since cards use `asOf` for "updated"
- [x] User report 8:12 PM PST: East Palo Alto voter saw only propositions, no Measure O. Cause: local races appeared only after "+ Local races" → "Add all" (a small link). Fixed `d34a609`: a place's local races and measures are added on their own once its county count is in (once: removed ones stay removed); legacy "Where I vote" places use the voter's area and county; a place with no county is prompted to pick one. Checked live 8:16 PM: an EPA place shows Measure O with no clicks
- [x] San Mateo's first report 8:15 PM PST: EPA Measure O Yes 1,171 (73.7%), No 418
- [x] Two-thirds / 55% measures were called "Passing" past 50%: `b0778c0` reads the threshold from the title, shows "(needs two-thirds)"
- [x] "0% of precincts" beside counted mail ballots: `8fca2b0` leaves precincts out until one reports
- [x] User report 8:19 PM PST: "Add one race" didn't offer local measures. `3310cbc`: a county picker (starts on a watched place's county, else the voter's), that county's local races and measures first in the list. Checked live 8:23 PM: "Measure O" → East Palo Alto Measure O added
- [x] User ask 8:25 PM PST: show both the last check time and the source's last change time. `a1c7349`: "Changed <source's time> · Checked <last fetch>", local first with UTC smaller beside it; LA (no time in its feed) says "New by <first seen>"; the reporting line's `title=` removed (no hover tooltips). Workers Builds never started for `a1c7349` (no Cloudflare check run on it; GitHub's ran); empty commit `4a086f9` triggered it. Live 8:42 PM PST, checked on Governor, EPA Measure O, LA County Measure A
- [ ] My ballot / race pages showing a race's county count (reuse `catalogRaceFor`): not started
- [ ] San Francisco, San Joaquin (recheck the feed number), Alameda (HTML): not started

## Things not to do

- Don't import `@openslate/core/<subpath>` from apps/web: its Vite alias maps
  only `@openslate/core` to `src/index.ts`, so subpaths break the build (tsc and
  bun test pass anyway). Export from core's index instead.
- Don't write regexes through bash heredocs/python in Git Bash: backslashes
  were eaten (`\b` became a backspace). Use the Edit/Write tools.
- Don't edit LivePanel.tsx's headings/civicAPI wording: another thread has
  uncommitted changes there (7:33 PM PST).
