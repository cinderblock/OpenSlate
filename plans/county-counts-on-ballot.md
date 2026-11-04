# County counts on My ballot and race pages

> Plan path: `plans/county-counts-on-ballot.md`. Read this first when resuming.
> Builds on `plans/county-results.md` (county feeds, relay, `catalogRaceFor`)
> and `plans/live-race-tracker.md` (Results page, Secretary of State relay).

## Goal

A local race's live county count (city, county, school, special district,
local measures) shows where the voter already looks at that race: each race
card on My ballot, and the race page (`/race/<key>`). Before this it showed only
on the Results page. California, counties with a feed (`CA_COUNTY_FEEDS`).
Asked 2026-11-04 (day after the Nov 3 general).

## Decisions (from the user, don't re-ask)

- Go the other way from `catalogRaceFor`: catalog race → county contest, with
  the same matching rules (same people; measure letter + place).
- Reuse the county query (`countyQueryOptions`, key `["sos-ca","county-ca",slug]`):
  no extra requests to county servers (relay: one per county per minute, shared cache).
- Reuse the result display (ReportingLine with Last checked / Source updated /
  This race changed; MeasureRow with thresholds), no new look.
- Quiet when there's no match or no count yet (render nothing).
- State races already show the Secretary of State's count on race pages: don't duplicate.
- Relay by default, no automatic fallback; React Aria kit; no `title=`; accessibility first.

## Design (as built)

- `lib/countyCa.ts`: `raceMatch(contest, race, countyName)` is the one rule
  both directions use; `catalogRaceFor` (contest → race) and
  `countyContestFor` (race → contest, local contests only) both take the best.
  `localRaceCounty(race, area, election)`: which county's feed to read: only
  this election's local California races (not `sosContestForSubject`'s, not
  state or district jurisdictions); a county's own race reads that county
  (none if it has no feed), anything else the voter's area's county.
- `components/LiveResult.tsx`: result pieces moved out of LivePanel (Clock,
  ReportingLine, ResultBody, MeasureRow, CandidateRow, RaceHistoryToggle,
  sourceTimeOf); Results, My ballot and race pages share them.
- `components/RaceCountyCount.tsx`: `useRaceCountyCount(race)` + the view
  ("Count so far", h4 in a ballot card, h3 card on the race page). Same contest
  id as the Results page (`county-ca/<slug>/<key>`), so "This race changed" and
  History are one record (ballot races now also get raceChanges/raceHistory
  entries, not only watched ones). `no-print`.
- My ballot: in `RaceCardInner` after the choices. Race page: in the aside;
  when a county count exists it replaces `ResultsPanel` (civicAPI, the backup;
  it only said "No civicAPI race found" there).

## Findings / gotchas

- A fresh Sunnyvale ballot (no follows) took ~45 s to show the Santa Clara
  registrar's local races (background import); at 12 s only state races showed.
- Sunnyvale council seats (`us/ca/sunnyvale`, "District 3") are hidden until a
  council district is set; measures G/H/I show and match.
- The Bay Area's Regional Transit Measure (RTM, `us/ca/bay-area`): county
  titles have no letter ("Regional Transit Measure (Majority Approval
  Required)"), so it never matches, and on purpose: one county's feed is only
  that county's share of a regional vote. See open question 1.
- One local run read Santa Clara twice 2 s apart (version + summary, twice);
  other runs read once. Looks like a react-query retry after a transient
  failure (retry is on in `countyQueryOptions`); not reproduced.
- Peer threads (ballot-vs-results, race-search) were editing LivePanel,
  MyBallotPanel and styles.css at the same time: my hunks were staged by
  rebuilding the file from HEAD + my edits (`git hash-object -w` +
  `update-index --cacheinfo`). A peer's push carried `19b5d4a`, `d09fab3` to origin.

## Progress log

- [x] matcher + tests: `19b5d4a`
- [x] shared result pieces moved out of LivePanel; card on My ballot and race page: `d09fab3`
- [x] race page: county count in place of civicAPI's no-match card: `fa8ba47`
- [x] README: `f995941`
- [x] checks: bun test 1143 pass, typecheck, biome
- [x] local headless check (402 px, dev server against api.openslate.us relay):
      EPA ballot 7 county counts (council, county measures J/L/U/AA, EPA Measure O
      Passing 72.5% needs two-thirds, Measure CC), race page Measure O shows it,
      Governor race page shows none; one county request for everything. Sunnyvale:
      Measures G/H/I.
- [x] pushed 12:28 PM PST (20:28Z)
- [x] live check on openslate.us 12:29–12:31 PM PST (20:29–20:31Z), headless at 402 px: EPA ballot 7 county counts, Measure O race page has it (civicAPI card gone), Governor none; Sunnyvale Measures G/H/I, Measure G race page Passing 76.1% at 81.6% of precincts; one county read per minute, no page errors

## Open questions for the user

1. Regional measure (RTM): show nothing (current), or show "your county's part
   of the vote", clearly labelled? Recommendation: leave it out; a county's
   share can read as the result.

## Things not to do

- Don't import `@openslate/core/<subpath>` from apps/web (see county-results plan).
- Don't add a `title=` tooltip or a native form control.
- Don't write scripts with non-ASCII text through bash heredocs (the "←" got mangled); use Write.
