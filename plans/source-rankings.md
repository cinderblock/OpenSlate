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
  these numbers only change what one voter sees in their own browser, so an
  option would be a switch with no reason to be off.
- **Disagree is any number below zero.** It keeps today's meaning, including
  `DisagreeMode` for two-way races. No separate flag is left.

## Proposal (not yet approved to build)

Each source has one signed number, how much it counts for you. Fractions are
allowed; only non-finite values are refused.

| Number | Means | Today |
| --- | --- | --- |
| 1 | Counts once. The default for a source nobody decided about | Follow |
| 0 | Doesn't count, stays on race pages | off |
| -1 | Counts once the other way | Disagree |
| Anything else | That many times, in that direction | new |

**Storage:** new key `openslate.follows.v3` (`Record<id, number>`), seeded from
v2 (`follow` 1, `disagree` -1, `off` 0). v2 is left in place, as v1 was, so an
older build in the same browser still reads sane state.

**Control:** Follow and Disagree stay as they are and set 1 and -1, so nobody
has to think in numbers. A number field beside them sets any value.

**What a voter sees:**

- Chips stay coloured as they are, with `×3` on anything other than 1 or -1.
- The number by a choice becomes the sum of what the chips show, so it can be
  checked by eye. The export and agent keep plain source counts beside it.
- The "your sources agree / split" line reads the sums, so a source at 3
  outweighing one at 1 reads as a lean, not a tie.
- Within a tier, positions sort by size, largest first.
- A disagreed source's stance is still never rewritten (`disagree-sources.md`).

## Plan / steps

1. [x] User chooses numbers over steps.
2. [ ] Go-ahead to build, and the remaining open questions.
3. [ ] `sources.ts`, `myVote.ts`: numeric standing, v3 store seeded from v2,
       helpers replacing each comparison with a standing word.
4. [ ] `collate.ts`, `ballotView.ts`: weighted tallies, source counts kept;
       tests first, since these decide what a ballot says.
5. [ ] Kit `NumberField`; `StandingToggle` with it, checked at phone width on
       Sources, the catalog and the wizard.
6. [ ] `ChoiceRow`, `PrintBallot`, `MyBallotPanel`, `PositionRow`, export.
7. [ ] README, checks, browser pass, commit.

## Findings / gotchas

- `comparison.ts:93` tests `standing === "follow"`, which would silently drop
  anything above 1. Every equality check on standing needs reviewing, not only
  the ones naming `disagree`.
- `STANDING_ORDER` and the local `order` in `triage.ts` both rank standings, and
  should become one comparison on the number.
- `ballotView.ts` `count` and the `collate.ts` tally are the same logic twice.
  Share it when adding weights, or the two will drift.
- Numbers mean no comparison on standing can stay a string check, so this
  touches more sites than the steps draft did, and needs a storage migration
  that the steps draft avoided.
- A large number makes one source decide every summary line. That is the
  voter's call, and the chip shows it.

## Open questions for the user

1. Does the number by a choice become the weighted sum, or stay a plain count
   of sources with only the order and summary line weighted? Recommendation:
   the sum, because it matches the `×3` chips.
2. Ship before Tuesday, or after? It changes what My ballot's numbers mean days
   before the election. Recommendation: before only if it's done by Sunday
   2026-11-01, since nothing changes for a voter who never touches it.

## Things not to do

- Don't call this `weight` or `rank` in the data model.
- Don't send rankings anywhere, and don't let them into usage events.
- Don't rewrite a disagreed source's stance in exports or on the race page.
- Don't weight Compare or All slates: those report what sources said.
