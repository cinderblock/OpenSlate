# Race search on the Results page ("Add one race")

> Plan path: `plans/race-search.md`. Read this first when resuming. Builds on
> `plans/live-race-tracker.md` and `plans/county-results.md`.

## Goal

The "Add one race" picker on Results (`AddRace` in
`apps/web/src/components/LivePanel.tsx`) should find what a voter types the way
they type it, with the best match on top: "Measure O" puts East Palo Alto's
Measure O first (San Mateo county picked), exact name and candidate matches beat
partial ones, and the usual ways of writing a race (Prop 5, 12th district, CD 12,
USD, all caps county titles) all work.

## Environment / context

- Options: the chosen county's local contests first (from its own count,
  `localContests`), then statewide offices, propositions (`Proposition N`, SOS
  `ballot-measures`), then every district seat (`U.S. House District N`, …).
  State races carry candidate names from the catalog's Secretary of State slate
  (`useSosCandidates`, `b473b10`); county races from the county's own count.
- `ComboBox` (`components/ui/Select.tsx`) filtered with react-aria's `contains`:
  every typed word as a substring anywhere, in list order, no ranking.
- Real titles (pulled through `api.openslate.us/api/county-ca`, 2026-11-04
  ~10 AM PST): 13 counties, 51 to 336 local contests each.

## Decisions (don't re-ask)

- Build on `b473b10` (candidate names) and `3310cbc` (county picker); don't redo.
- Ranking is a pure module (`apps/web/src/lib/raceSearch.ts`) with tests; the
  ComboBox gets an optional ranked-search hook and keeps its old filter elsewhere.

## Findings (problems a voter hits, before the fix)

1. **"Measure O"**: the word "o" matched any title with an "o" in it, so every
   San Mateo contest matched and the list kept its own order: the court of appeal
   retention votes came first, East Palo Alto's Measure O about 30th.
2. Single letters and numbers as substrings: "Measure C" also found Measure CC,
   "District 1" found 10–19, 21, 31… (no whole-number rule here, unlike
   `lib/search.ts`).
3. No ranking at all: "Controller" or "Treasurer" listed a county's
   Auditor-Controller / Treasurer-Tax Collector above the state's office.
4. Orange titles its measures "C – City of Costa Mesa, …" with no word
   "Measure": "Measure C" didn't find it.
5. District words: "12th", "CD 12", "AD 12", "SD 12", "congress 12",
   "assembly 12", "senator 12" found nothing or the wrong family; LA titles say
   "Fifth District", so "district 5" missed them.
6. County abbreviations: Riverside "Mbr Gov Bd Alvord USD, TA 4", Sonoma
   "Assoc Justice, Ct Appeal 1st Dist Div 1", Ventura "AJ 2nd App Dist":
   "alvord unified", "trustee area 4", "court of appeal" missed them.
7. "Prop5", "prop. 5": not split into the word and the number.
8. San Mateo titles the regional transit measure "Regional Transit Measure"
   (others "Measure RTM"): "RTM" missed it. "LA" didn't mean Los Angeles,
   "school board" didn't reach "County Board of Education".
9. The picker's own hint said "Prop 50", which isn't on this ballot (props are
   1–5 and 37–45): the example found nothing.
10. With no county picked (a fresh phone), "Measure O" said only "No matches":
    nothing said local measures need a county.

## Plan / steps

1. [x] `lib/raceSearch.ts`: normalize (fold accents/case, split letters from
   digits, ordinals to numbers, expand abbreviations, synonyms), score
   (exact word > word prefix > substring for 3+ letters; whole-name, phrase,
   measure letter, and candidate full-name bonuses), stable sort. Tests from
   real titles.
2. [x] ComboBox: optional `search` (input → ranked options), items controlled.
3. [x] AddRace uses it; aliases for state contests (CD/AD/SD, congress, …).
4. [x] Checks, commit, push (check `origin/master..HEAD` for ride-alongs).
5. [x] Live check on openslate.us at phone width (headless Playwright): Measure O,
   Jamie Joyce, Prop 5, CD 12, a county council title.

## Progress log

- [x] Diagnosis and real titles
- [x] `60e61f5`: `lib/raceSearch.ts` (ranked search, 21 tests from real titles),
  `ComboBox` `search` prop (controlled items; other ComboBoxes keep the old
  filter), AddRace entries with aliases, measure letters, candidates; hint now
  "Prop 3, Measure A". `bun test` 1125 pass, typecheck, biome.
- [x] Dev check (headless, 402 px, county feed forwarded to the public relay):
  San Mateo picked, "Measure O" → only EPA Measure O; "measure cc", "RTM",
  "board of supervisors", "half moon bay", "Jamie Joyce", "CD 12", "Prop 3",
  "controller" all right; choosing the top hit adds
  `county-ca/san-mateo/city-of-east-palo-alto-measure-o-2-3-approval-required`.
- [x] `72a983b`: "No matches" says to pick a county when none is picked.
- [x] Pushed 12:24 PM PST (20:24Z) with peers' `d09fab3` and `e7e5240` riding
  along; Workers Builds green.
- [x] Live check, 402 px, 12:26 PM PST: San Mateo "Measure O" → only EPA
  Measure O, choosing it adds it; "Jamie Joyce", "joyce", "Prop 5",
  "Proposition 5", "CD 12", "12th congressional", "east palo alto council",
  "RTM", "controller" all first. No page errors. (The user's original "Jamie
  Joyce" on mobile report is now verified live.)
- [x] Found live: with no county, the "pick its county above" message never
  showed: react-aria closes an empty list (so the old "No matches" never showed
  either). `de96a21`: a ComboBox given `emptyText` keeps the list open to say
  it (`allowsEmptyCollection`); others unchanged. Pushed 12:29 PM PST (20:29Z),
  checked live: the message shows; "prop5" → Proposition 5; "alvord" with San
  Mateo picked → "No matches" (it's Riverside's).
- Checked against every county's real titles (script below): "trustee area 4"
  (Riverside "TA 4"), "council district 5" (LA "Fifth District", "5th District"),
  "mt san jacinto", "measure c" (Orange "C – …"), "irvine", "costa mesa".

## How to re-check against real titles

`%TEMP%/race-search/dump.ts` pulls every wired county's local contests through
the relay into `titles.json`; `try.ts <slug> "<query>"…` ranks them with the
real module. `pick.mjs <base> <out> "<County>" "<query>"…` drives the picker
headless at 402 px (`FORWARD=1` sends `/api/county-ca` to the public relay, for
`vite` dev; `SELECT="<query>"` chooses the top hit and prints the watch list).

## Not done (by choice)

- Other ComboBoxes (SubjectPicker, …) keep react-aria's substring filter; the
  same single-letter noise applies there. Not this task.
- All-caps county titles are shown as the county prints them.
- The race list fades in about half a second after the first typed text in
  headless Chromium (county picker: at once). Not investigated; seen only in
  headless, typing key by key it shows normally.
- Searching every county at once would mean fetching all 13 feeds; the picker
  keeps one county.

## Things not to do

- Don't write regexes through bash heredocs (backslashes get eaten); use Edit/Write.
- Don't import `@openslate/core/<subpath>` from apps/web.
