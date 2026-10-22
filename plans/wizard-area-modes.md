# Where you vote: "find them for me" vs "choose them myself"

## Goal

The getting-started wizard's "Where do you vote?" step (and the same picker on
My ballot) mixed the automatic ways to set your area (map, location, address)
with the manual lists (city chips, district selects) in one long column. The
user (2026-10-21): it "needs to be more clear about the automatic map based
options or to manually select locations. The automatic mode shouldn't make you
scroll past the manually entered parts to finish."

## Environment / context

- Worktree `C:\Users\camer\.t3\worktrees\OpenSlate\feat-wizard-area-modes`,
  branch `feat/wizard-area-modes`, from local master `4739b5e`.
- Dev server: `bunx vite --port 5207 --strictPort` in `apps/web`.
- Files: `apps/web/src/components/AreaPicker.tsx` (the picker, used by
  `Wizard.tsx` AreaStep and `MyBallotPanel.tsx`), `FindDistricts.tsx` (the
  automatic methods + found summary), `apps/web/src/styles.css`, `README.md`.
- Checks: `bun run typecheck`, `bun test`, Biome with a CRLF config copy
  (`bunx biome check --config-path="$TEMP/biome-crlf" apps packages`),
  `bun run build`.

## Decisions already made (don't re-ask)

- No native form controls; use the `ui/` kit (user memory). The mode choice is
  the kit's `RadioGroup` with `card` radios, like the wizard's "Just me / An
  organization".

## Plan / steps

1. [x] AreaPicker: a top-level choice between "Find them for me" (map /
   location / address) and "Choose them myself" (localities + districts).
   Only the chosen mode's content shows; both stay mounted (`hidden`), so
   switching keeps the map, a lookup's result and the filter. Default: find,
   unless an area is already set (then the lists, where its values show).
2. [x] FindDistricts: the found summary's "adjust anything below" / "set it
   below" became an "Adjust by hand" button that switches to the lists and
   moves focus to that option (the button itself is hidden by the switch).
3. [x] Wizard: the footer (Back / Skip / Next) sticks to the bottom of the
   dialog, so Next is in view however tall the map makes the step.
4. [x] Verified in the browser; checks pass; README mentions choosing by hand.

## Findings / gotchas

- Before: with "Pick on a map" open, the step was 1,556 px tall in a 734 px
  dialog, and Next sat below the city chips and district selects.
- `DistrictMap`'s ResizeObserver ignores a zero size, so keeping it mounted
  inside a `hidden` panel is safe; it renders at 416 px when shown again.
- Editing `AreaPicker.tsx` forces a full remount under Vite ("describeArea
  export is incompatible" with Fast Refresh), so the wizard's in-progress
  state resets on each edit while testing.
- The wizard can hang at "Loading endorsements… N of M" in a fresh profile
  (ISSUES.md, not this task); it didn't happen this time.
- Git Bash `sed -i` rewrites CRLF files as LF; edits went through Python with
  `newline=""`.

## Progress log

- [x] Read the current code (2026-10-21).
- [x] Implemented and checked in the T3 preview (2026-10-21, 9:59 PM PDT):
  wizard at 1280x800: the mode cards, map pick (Santa Clara County → CD 18,
  SD 15 "no race", AD 25, COA 6), Next pinned under the map, "Adjust by hand"
  shows the lists with those values and focuses the "Choose them myself"
  radio at the top, switching back keeps the map and result; iPhone 12 Pro
  width: cards stack, footer pinned; My ballot's editor opens on the lists
  when an area is set.
- [x] typecheck (5 packages), 234 tests, Biome (CRLF config), build all pass.
- [x] Merged to master (fast-forward) and pushed `4739b5e..aa2ab49`
  (2026-10-21, user: "yes and yes"); nothing else rode along. Live at
  10:10 PM PDT (05:10Z) as `AreaPicker-D7q33R6S.js`. Checked in a fresh
  incognito window on openslate.us: both mode cards, the lists hidden while
  the map is open, the footer pinned to the dialog's bottom (dialog 734 px,
  content 1,022 px). Worktree removed.

## Open questions for the user

None open.

## Things not to do

- Don't unmount the inactive mode's panel; it throws away the map position
  and the found result.
