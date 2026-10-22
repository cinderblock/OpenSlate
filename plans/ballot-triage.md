# Ballot triage: work through My ballot to zero

`plans/ballot-triage.md`

## Goal

User request (2026-10-22): "need a way to 'work through' the ballot, like 'get
your inbox to zero'. Filters based on accepted/maybe/rejected. Also, some quick
buttons at the top, like accept/reject all dems/republicans. We should also be
able to load a list of recommendations and say I want to go against that set."

Three features on My ballot (`apps/web/src/components/MyBallotPanel.tsx`):

1. **Status filter + progress**: every race is in exactly one bucket — To do,
   Maybe, Picked, Against — with counts, a progress line ("12 of 40 decided"),
   and a "ballot zero" empty state when To do runs out.
2. **Quick fill by party**: Pick all / Against all for each party on the ballot.
3. **Quick fill by source**: Agree with all / Go against all of any imported
   source's recommendations (followed or not). New lists come in through
   Sources (link, file, QR, paste, catalog), as before.

## Environment / context

- Web app `apps/web` (React, TanStack Router/DB, React Aria kit in
  `src/components/ui`). Tests: `bun test` at the root (`apps/web/test/*.test.ts`).
  Checks: `bun run typecheck`, `bun test`. `bun run lint` is broken on Windows
  (CRLF, see ISSUES.md), so only check the touched files' lint by eye.
- Picks live in `localStorage` via `useBallotDraft` (`lib/ballotDraft.ts`),
  one row per (election, subject, choice) with a `stance`. My ballot's buttons
  map Pick → `endorse`, Maybe → `lean_for`, Against → `oppose`.
- Party is not a schema field. It comes from the ballot source's statement on
  each candidate (`ChoiceGroup.ballotNote`), e.g. `"Democratic · Voting Rights
  Attorney"` or bare `"Republican"`. CA SOS 2026-11-03 values: Democratic (177),
  Republican (138), No Party Preference, Green, Libertarian, Peace and
  Freedom, Non-Partisan; judges and measures carry other text.
- Measures are listed with choices `Yes` and `No` (both on the ballot), not as
  a stance on the measure itself. Some sources may still state a bare stance
  on the measure (choice `""`).

## Decisions already made (don't re-ask)

- Vocabulary follows the existing buttons (Pick / Maybe / Against), not the
  user's accepted/maybe/rejected wording.
- Race status, one per race, first match wins: **Picked** (any choice
  endorsed), **Maybe** (any lean_for), **Against** (every option opposed: a
  race you're skipping), else **To do** (including races with only some
  options ruled out). Decided = Picked + Against.
- Inbox behaviour: a race that leaves the current filter (e.g. you pick in
  To do) stays on screen as a one-line summary with an Edit button until the
  filter changes or you press "Clear N done", so a misclick is recoverable and
  nothing jumps away under the pointer.
- Quick fill never overwrites: it only fills options you haven't marked, and
  never adds a pick to a race that already has one. Every quick fill can be
  undone (restores exactly the rows it touched).
- Party Pick in a race with several candidates of that party (CA top-two can
  be D vs D) marks them all Maybe instead of picking.
- Source rules. Two-way races (exactly two options, which includes Yes/No
  measures): "agree" picks the source's side; "go against" picks the other
  side. Elsewhere: agree copies their stances (endorse → Pick, lean_for →
  Maybe, oppose/lean_against → Against); go against marks what they back as
  Against and leaves what they oppose alone. A bare stance on a measure counts
  as Yes (for) / No (against).
- Quick fill applies to the races the ballot currently lists (election + area),
  regardless of the status filter.
- Usage event `ballot.quick_fill` with dim `by: party | source` only (no party,
  no source, no direction), per the usage-analytics hard rule.

## Plan / steps

1. `lib/triage.ts` (pure): `partyOf`, `raceStatus`, `partiesOn`,
   `sourcesOn`, `partyFill`, `sourceFill`. Unit tests in `test/triage.test.ts`.
2. `ballotDraft`: `patchMany` (one state update) and `restore` (undo).
3. My ballot UI: status Segmented with counts, progress, sticky resolved
   races, ballot-zero state; Quick fill card behind a toolbar button with an
   undo notice.
4. README: describe the triage filter and quick fill.
5. Typecheck, tests, try it in the browser against the live catalog data.

## Findings / gotchas

- Biome on Windows: run it with a copy of `biome.json` that sets
  `formatter.lineEnding: "crlf"` (`--config-path=<dir>`), see ISSUES.md.
  Files made with the Write tool come out LF; convert to CRLF before linting.
- Biome's `useSemanticElements` rejects `role="status"`; the quick-fill
  notice is an always-mounted `<output>` (also better: a live region that
  mounts with its text often isn't announced).
- The React Aria radio inside a Segmented isn't clickable by locator in
  automation (hidden input); click the `.ui-segment` label instead.
- Browser check, 2026-10-22 ~12:20 AM PDT (07:20Z), dev server on :5191,
  fresh profile with CA SOS list + CADEM, CAGOP (unfollowed), Sierra Club CA,
  SF Chronicle, no area set (256 races):
  - Pick in To do collapses the race to "✓ Picked … Edit"; counts update.
  - Republicans → Against all: "138 marked Against in 136 races"; 5 races
    (only Republicans on the ballot) went to Against all. Undo restored all.
  - CAGOP → Go against all: "131 picked, 3 marked Against in 134 races";
    the 3 are uncontested Republican Assembly seats, so skipped (correct).
  - Democrats → Pick all after that: "17 picked, 44 marked Maybe in 39 races"
    (top-two D-vs-D races go to Maybe).
  - Emptying To do shows the Ballot zero card with "Settle the maybes".
- Data note (not this task): the SoS race lists both "Donald P. (Don)
  Wagner" (ballot) and "Don Wagner" (CAGOP), a spelling the endorsements
  repo's normalize-choices script didn't merge.

## Progress log

- [x] triage lib + tests (`apps/web/src/lib/triage.ts`, `test/triage.test.ts`)
- [x] ballotDraft patchMany / restore
- [x] My ballot UI (`MyBallotPanel.tsx`, `QuickFill.tsx`, styles)
- [x] README
- [x] typecheck + tests (289 pass) + browser check
- [x] commit (`9c48572`)
- [x] focus mode + tests + browser check
- [x] commit focus mode (`61db250`)
- [x] on origin/master (another thread's push of `86399ca` carried them); live on openslate.us, checked in the `MyBallotPanel` chunk 2026-10-22 12:36 AM PDT (07:36Z)

## Focus mode (user: "do it", 2026-10-22)

- "One at a time" button in the filter row. Entering from All switches to To
  do. Shows one race (`FocusRace` in `MyBallotPanel.tsx`) with Previous /
  Next, "N of M · K left", and the card takes keyboard focus on each race.
- Keys: 1–9 toggle Pick on the nth choice, Shift+number toggles Against,
  ←/→ (or K/J) step, Esc returns to the list. Ignored while typing in a
  field, a combobox/listbox, or the filter radio group. Pick/Against buttons
  carry `aria-keyshortcuts`; choices show a number badge.
- When the race on screen is dealt with (leaves the filter; under All, gets
  decided) the next one left comes up after 450 ms; undoing within that time
  cancels. Manual Previous/Next step through everything shown, including
  races already dealt with this session. Logic: `stepThrough` in
  `lib/triage.ts` (tested).
- Browser check 2026-10-22 ~12:45 AM PDT (07:45Z): `1` picked Rob Bonta and
  moved to Controller; Shift+2 ruled out Herb Morgan and stayed; ← went back;
  Esc returned to the list; a `1` typed into the private note didn't pick.

## Open questions for the user

- (none)

## Things not to do

- Don't send party names, source names or the fill direction in usage events.
- Don't let quick fill overwrite a choice the user already made.
