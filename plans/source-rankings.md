# Personal rankings for sources

> Plan path: `plans/source-rankings.md`. Read this first when resuming.

## Goal

Today every followed source counts the same: one vote for or against a choice.
A voter should be able to say that some sources matter more to them than
others. The user's words (2026-10-30):

> we should probably add personal rankings for the sources, instead of treating
> all sources equal weight. This could possibly replace the "disapprove" flag
> for a source...

> can we unlimit the numbers? (or have a per user option to uncap them)

## Environment / context

- Web app `apps/web`. Standing per source: `lib/sources.ts` (`Standing`:
  `follow`, `disagree`, `off`), stored in `lib/myVote.ts` as
  `openslate.follows.v2`.
- Tallies: `lib/collate.ts` (`collateRaces` → `ChoiceGroup.support` and
  `opposition`, `countedTone`, `positionTone`), repeated for measures by
  `count` in `lib/ballotView.ts`.
- Readers of those tallies: `ChoiceRow`, `PrintBallot`, `ballotExport`,
  `ballotAgent`, and the "your sources agree / split" line in `MyBallotPanel`.
- Control: `components/StandingToggle.tsx`, shared by Sources, the catalog and
  the wizard. Disagree's history and rules: `plans/disagree-sources.md`.
- The kit in `components/ui` has no number field yet. Native inputs are out, so
  this needs a React Aria `NumberField` added to the kit.
- Not affected: `lib/raceTally.ts` counts every position and ignores standing;
  `lib/alignment.ts` scores a voter's marks, not their follows. Quick fill acts
  on one source the voter chose.
- Naming trap: `weight` (SPEC position strength) and `rank` (a source's ranking
  of a choice, SPEC §3.16) are both taken. Keep this as `standing`.
- Picks and follows never leave the browser (`project_no_central_server`). The
  ranking is the same: local, and never in a usage event.
- The election is Tuesday 2026-11-03.

## Decisions already made (don't re-ask)

- **Numbers, not capped steps** (user, 2026-10-30). A first draft used five
  steps from +2 to -2; the user asked for the limits to go.
- **Uncapped for everyone, with no setting.** A cap protects nothing, because
  these numbers only change what one voter sees in their own browser.
- **Disagree is any number below zero.** It keeps today's meaning, including
  `DisagreeMode` for two-way races. No separate flag is left.
- **The number by a choice is the weighted total** (user, 2026-10-30), so it
  adds up from the `×3` chips.
- **Ship as soon as it's verified** (user, 2026-10-30).

## How it works

Each source has one signed number, how much it counts for you. Fractions are
allowed; only non-finite values are refused.

| Number | Means | Before |
| --- | --- | --- |
| 1 | Counts once. The default for a source nobody decided about | Follow |
| 0 | Doesn't count, stays on race pages | off |
| -1 | Counts once the other way | Disagree |
| Anything else | That many times, in that direction | new |

- **Storage:** `openslate.follows.v3` (`Follows`, `Record<id, number>`), seeded
  from v2 (`follow` 1, `disagree` -1, `off` 0), else v1. Earlier keys stay, so
  an older build in the same browser still reads sane state.
- **`Standing` stays, derived.** The word is the number's sign (`standingOf`),
  so everything that only cares about direction didn't change.
  `RacePosition.times` carries the size, only when it isn't 1 or 0.
- **Control:** Follow and Disagree set 1 and -1, and a source already counting
  that way keeps its number. The kit's `NumberField` beside them on the Sources
  page sets any value, and that list sorts by size. The catalog, setup and
  Compare keep Follow and Disagree only.
- **Tallies:** `tallyPositions` in `collate.ts`, shared with `ballotView.ts`.
- **Display:** `×3` on chips, "you count this ×3" on race pages, the total
  beside each choice. When weights are in play and one choice leads, the line
  reads "your sources split, leaning X". Unweighted ballots read as before.
- **Export and agent:** `for` / `against` and `sources_for` / `sources_against`
  are the weighted totals, so they match the screen, with `times` on each source.
  This replaces the proposal's "keep plain counts beside it": a second pair of
  numbers would disagree with what the voter sees.

## Progress log

- [x] User chose numbers, the weighted total, and shipping now.
- [x] `sources.ts`, `myVote.ts`: numeric follows, v3 seeded from v2.
- [x] `collate.ts`, `ballotView.ts`: weighted tallies, tests.
- [x] Kit `NumberField`, Sources page, chips, race page, export, agent, README.
- [x] Checks and a headless browser pass (results below).
- [x] Shipped.

## Findings / gotchas

- Headless Chrome pass, dev server, 2026-10-30: a seeded v2 profile came through
  as `{a: 1, b: -1, c: 0}` with v2 untouched. Typing 2.5 stored 2.5. Emptying the
  field kept the old value. No sideways overflow at 390 px. My ballot showed
  `350 San Francisco Action ×3` with "3 counted for". No page errors.
- v3 is written on the first change, not on load. Until then the seed is
  re-read from v2 at each load, which is harmless.
- The field's + and - step to the next whole number: 2.5 goes to 3, not 3.5.
  That is React Aria's behaviour with no `step` set, and setting a `step` would
  round typed fractions instead.
- Leave `step` unset on `NumberField` for that reason.

## Open questions for the user

- (none)

## Things not to do

- Don't call this `weight` or `rank` in the data model: both are taken in SPEC.
- Don't send these numbers anywhere, and don't let them into usage events.
- Don't rewrite a disagreed source's stance in exports or on the race page.
- Don't weight Compare or All slates: those report what sources said.
