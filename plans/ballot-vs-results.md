# My ballot vs. the results

## Goal

A voter can compare their own ballot (My ballot's marks) with the count, race by
race, and see their races grouped by whether they're going the way they voted.
Asked 2026-11-04 (the day after the Nov 3 general), after the user found no way to do it.

## Why it didn't exist (found 2026-11-04)

- `/results` lists signed slates only (`slatesCollection`); My ballot is a draft in
  localStorage (`openslate.ballotDraft.v1`), never in that list.
- `positionOutcome` (`lib/slate-summary.ts`) only scored a race once a candidate
  had `winner: true`; the SOS and county feeds never set it. Everything was "pending".
- Measure positions have no `choice`, so they scored "n/a".
- County results (local races and measures) were wired only into the Live page.

## Decisions already made (don't re-ask)

- Its own view, reached from My ballot, reading the draft directly: no signing.
- One lookup per race: SOS for state races, county feeds for local ones, civicAPI only
  as the fallback. Backend lookups must be efficient (user's words): share the Live
  page's query keys, one county file for every local race, no civicAPI calls for races
  a state/county feed already covers.
- No race is "called" by OpenSlate: the feeds have no call signal, so the words are
  "leading / trailing" (with margin and % reporting) until a source calls it. No invented margin.
- Grouping: Going your way / Partly your way (multi-seat) / Not going your way /
  No votes counted yet / No count found.
- Measures: Yes/No against the threshold (`measurePasses`, 55% and two-thirds).
- Multi-seat: the top `voteFor` are in. Ranked choice: first-round count only, the
  voter's first choice, said so plainly.
- Same scoring on `/results/$token` (imported slates).

## Design (as built)

- `lib/ballotOutcome.ts` (pure): `myMarks` (draft rows → picks/against/measure vote),
  `Standing` (a count from any source), `civicStanding`, `raceOutcome`.
- `lib/ballotResults.ts`: `useBallotCounts(races, area, election)`. SOS via
  `contestQueryOptions`; county via `localRaceCounty` + `countyContestFor` (the
  county-counts-on-ballot thread's matcher, one rule both ways) and `countyQueryOptions`;
  civicAPI via a pinned match, else a "high" confidence search hit only.
- `components/BallotResultsPanel.tsx` at `/results/my-ballot`; linked from Results and
  from My ballot's toolbar ("How it's going") once the election date has come.
- `lib/slate-summary.ts` `positionOutcome` now delegates to `raceOutcome`: win/loss when
  called, leading/trailing otherwise.

## Findings / gotchas

- Draft rows: one per (subject, choice). Measures: choice "Yes"/"No" with `endorse`,
  or choice "" with a stance on the whole measure (against = a No vote). `ballotChoices`
  folds these onto Yes/No.
- Ranked races (`ranking.ts`): the first `marksFor` ranked are `endorse`, backups `lean_for`.
- Python string literals ate `\b` again (became a backspace byte) when editing
  regexes; fixed. Use the Edit tool for regexes.
- Headless check 2026-11-04 (dev server on :5287 against api.openslate.us, East Palo Alto
  area, all 413 catalog entries, 32 races marked): 10 going your way, 19 not, 3 no count;
  state races, props and San Mateo County measures (Measure CC) all scored right.
- Not found by any source (known gaps, not fixed): California Supreme Court retention
  votes (the SOS API has no contest for them and civicAPI has none; county feeds carry
  them but `localContests` drops state contests), and the Bay Area's Regional Measure RTM
  (not matched in San Mateo's count). Also `/results/$token` still reads SOS + civicAPI
  only, not county feeds.

## Progress log

- [x] Scoring + tests, resolver hook, page, route, links: `e7e5240`
- [x] `/results/$token` leading/trailing, measures by stance: `df4ca50`
- [x] README
- [ ] Push (not done: waiting on the user)

## Open questions for the user

1. Push to master (deploys)? Recommend yes.
2. Follow-ups worth doing: retention judges from the county feeds, Regional Measure RTM
   matching, county counts on `/results/$token`. Recommend the first two (they're on
   most Bay Area ballots).

## Things not to do

- Don't import `@openslate/core/<subpath>` from apps/web (see plans/county-results.md).
- Don't run `biome check --write` over all of apps/web in this shared tree: it touches
  other threads' files (only line endings this time).
