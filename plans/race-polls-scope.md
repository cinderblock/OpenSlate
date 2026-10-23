# Race pages show polls for other races

> Plan path: `plans/race-polls-scope.md`. Read this first when resuming.

## Goal

Fix the ISSUES.md entry "Race pages for local offices show the Governor's
polls". The race page's polls panel (and Kalshi forecast panel) should only show
data about the race on the page. A poll from another race reads as data about
this one, which is worse than showing nothing.

## Environment / context

- Polls panel: `apps/web/src/components/PollsPanel.tsx`; VoteHub adapter:
  `apps/web/src/lib/polls.ts` (`voteHubLookup`, `voteHubMatchesOffice`).
- Shared helpers: `packages/core/src/polls.ts` (`inferOfficeFromTitle`,
  `inferUsHouseDistrict`, ...), tested in `packages/core/test/polls.test.ts`.
  `packages/core/src/forecasts.ts` (`inferKalshiEventTickers`) uses the same
  helpers.
- `RacePanel.tsx` builds `pollSubject` from the race's subject. It used to drop
  `kind`.
- Live VoteHub data through `https://polls.openslate.us/api/...`.

## Findings

- **VoteHub's subject taxonomy** (`/api/subjects`, 2026-10-23, 162 subjects):
  `<year> <State>` holds **statewide** races only (`governor`, `us-senator`,
  `attorney-general`, `proposition-50`, ...). House races are `<year> <ST-DD>`
  (`2026 CA-22`). Mayors are keyed by city (`2025 New York City`, poll_type
  `mayor`). Primaries append the party (`2026 Texas Democratic`). No subject is
  a bare state name, but `?subject=California` still returns 18 polls (7 for
  the 2026 Governor race plus 11 for the 2025 Prop 50 race), so the API
  matches loosely.
- **Poll types in the dataset:** approval, attorney-general, favorability,
  generic-ballot, governor, mayor, presidential-primary, proposition-50,
  us-representative, us-senator. `seat_name` is null on everything checked.
- **Root cause:** `voteHubMatchesOffice` passes every poll when the office is
  `other`. Any local race (and any statewide office VoteHub has no poll_type
  for) got the whole state rollup.
- **The same defect in other forms**, checked against real titles from
  `openslate-ballot-ca-2026-11-03`:
  - "Lieutenant Governor of California" counts as `governor`, so the page shows
    Governor polls and the Kalshi `KXGOVCA-26` forecast.
  - "State Senator ..." counts as `senator`, so it gets U.S. Senate polls and the
    Kalshi `KXSENCA` forecast.
  - "Burbank City Treasurer" (`us/ca/burbank`) gets statewide Treasurer polls.
  - "Palmdale – Measure DE (Directly Elected Mayor)" counts as `mayor`.
  - Any measure matched any `proposition-*` poll, so Prop 1's page and every
    local Measure X page would show the 2025 Prop 50 polls.
  - The bare-state key brings in other cycles' polls (Prop 50 from 2025 on a
    2026 race).
  - "US House of Representatives, California District 10" (`us/ca/cd-10`) never
    got its district key, because the district was only read from a `CA-10`
    pattern in the title.

## Decisions

- Only use the `<year> <State>` rollup for **statewide** subjects (jurisdiction
  `us/<st>`) whose office maps to a VoteHub poll_type. For office `other`, fetch
  nothing: there is no poll_type to filter by, so any rollup poll would be a
  guess.
- Measures match only their own number (`Proposition 1` → `proposition-1`). A
  measure with no number matches nothing.
- Drop polls whose provider subject names a different year than the race.
- Drop the legacy title-slug key: VoteHub subjects are never slugs, so it was a
  wasted request and an odd tag in the panel.
- When there are no keys, the panel says VoteHub doesn't cover this kind of race
  rather than listing what it tried.

## Plan / steps

1. core: `inferOfficeFromTitle` honours `subject.kind === "measure"` and
   doesn't read "Lieutenant Governor", "State Senator/Senate" or "State
   Representative" as the federal or gubernatorial office. Add
   `inferUsHouseDistrict` from a `cd-NN` jurisdiction, `isUsStatewide`, and
   `inferMeasureNumber`. Gate Kalshi's state tickers on `isUsStatewide`.
2. core: `PollsLookup` carries `year` and `measure`; `PollsSource.matches(poll,
   lookup)` replaces `matchesOffice(poll, office)`.
3. web: rewrite `voteHubLookup`/matcher per the decisions; add a mayor city key;
   pass `kind` through `pollSubject`; update the empty state.
4. Tests in `packages/core/test/polls.test.ts` and a new web test for the
   VoteHub lookup/matcher, using real catalog titles.
5. typecheck, test, lint the touched files; check in the browser; commit; close
   the ISSUES.md entry.

- **House district subjects return nothing from `?subject=`.** `2026 CA-22` is
  in `/api/subjects`, but `/api/polls?subject=2026%20CA-22` returns `[]` (also
  with `&poll_type=us-representative`). The polls only come back from
  `?poll_type=us-representative` (175 across all districts, each with
  `subject: "2026 CA-22"` and `seat_name: "CA-22"`). So House pages show no
  polls, before this change and after it. Logged in ISSUES.md as its own fix.
- **The dev server fetches polls same-origin** (`/api/polls`, proxied to the
  local `apps/server`), so polls 404 in `vite` unless that server runs. To check
  against live data, start Vite with `VITE_POLLS_BASE=https://polls.openslate.us`.
- **Biome on Windows:** `--line-ending=crlf` on the CLI didn't take effect.
  Pointing `--config-path` at a copy of `biome.json` with
  `"formatter": {"lineEnding": "crlf"}` works (see the lint entry in
  ISSUES.md).

## Progress log

- [x] Diagnosed; plan written; issue claimed (`d63e961`)
- [x] Core helpers and interface
- [x] Web adapter, panel, RacePanel (`pollSubject` now uses the race's resolved
      election and jurisdiction, which fall back to the slate's context)
- [x] Tests: `packages/core/test/polls.test.ts`, new
      `packages/core/test/forecasts.test.ts` and `apps/web/test/polls.test.ts`
- [x] Checks: `bun test` (all pass), `bun run typecheck`, Biome (CRLF config)
      on the touched files
- [x] Browser check, 2026-10-23 (dev server with live polls), fresh
      profile: Governor shows its 7 polls under one key (`2026 California`).
      Lieutenant Governor shows no polls and no Kalshi forecast. Prop 1 shows
      none (it used to get Prop 50's). CA-22 gets its district key and Kalshi
      district tickers. The county guides weren't imported in that profile, so
      the local races there ran unresolved; the resolved local path is covered
      by the web test, using the reported race's exact subject.
- [x] Committed; ISSUES.md entry closed

## Things not to do

- Don't fall back to "show everything" when the office is unknown. That fallback
  is the bug.
