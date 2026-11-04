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

Not yet (by value):

- **Los Angeles**: `https://results.lavote.gov/electionresults/json?electionid=4348`
  (`Data.Election.ContestGroups[].Contests[].Candidates[]`, `Timestamp`). Behind an
  Imperva bot check for non-browser clients: a worker fetch may be blocked too. Untested.
- **Sacramento**: own JSON API, CORS `*`:
  `https://results.saccounty.gov/results/public/api/elections/sacramento-county-ca/69/data`
  (~31 KB; metadata at the bare URL: `asOf`, `nextUpdateAt`). Structure
  `results.ballotItems[].{name,voteFor,precinctsReporting,ballotOptions[]}`.
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
- [ ] live check of the LVT counties through the worker
- [ ] after 8 PM: confirm counts move (Clarity version bumps; CSV `Last-Modified`)
- [ ] Sacramento (JSON API), then Los Angeles (if the worker gets past Imperva)
- [ ] link county contests to catalog races (My ballot / race pages)

## Things not to do

- Don't import `@openslate/core/<subpath>` from apps/web: its Vite alias maps
  only `@openslate/core` to `src/index.ts`, so subpaths break the build (tsc and
  bun test pass anyway). Export from core's index instead.
- Don't write regexes through bash heredocs/python in Git Bash: backslashes
  were eaten (`\b` became a backspace). Use the Edit/Write tools.
- Don't edit LivePanel.tsx's headings/civicAPI wording: another thread has
  uncommitted changes there (7:33 PM PST).
