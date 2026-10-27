# Regional outlets in setup ("based elsewhere")

`plans/regional-outlets-setup.md` (one link of `plans/issues-burndown.md`)

## Goal

Setup (step 2, "Whose endorsements do you trust?") lists Bay Area News Group
(scope `us/ca/bay-area`) under "based elsewhere" for a San Francisco voter.
`GetStarted.tsx`'s `elsewhere` test calls any local scope that isn't one of
the area's localities "elsewhere", and a region's path doesn't say what it
contains. A voter's own regional paper should be with their area's outlets.

## Decisions already made (don't re-ask)

- User: do whichever rule is *best*, even if it's more work.
- **Rule chosen: an outlet's scope is "yours" when it's one of your places,
  and a region is one of your places when a contest filed under it is voted
  in your area (`voted_in`, SPEC §3.3).** The catalog lists, per entry, each
  region its subjects are filed under with the union of their `voted_in`
  (`regions`); setup unions them over the election's entries.
- Rejected: "local when any of its positions is on a sub-state race in your
  area". Bay Area News Group's only SF contest is RTM, and so is the Alameda
  County Democratic Party's: by races alone they're identical for an SF
  voter, so that rule either keeps BANG elsewhere or pulls every
  out-of-county org that took a side on RTM (about 40 SF clubs for a
  Sunnyvale voter) into the voter's list. Only the scope tells them apart.
- Rejected: a `bay-area → counties` table in the app (regional-measures plan:
  membership is per contest, the publisher knows it, the app doesn't).
- Region membership is whatever this election's contests filed under the
  region say (RTM: five counties). A region with no such contest in the
  catalog stays unplaceable, so its outlets stay "elsewhere", as before.

## Plan / steps

1. [x] Claim (`8720c3c`).
2. [x] Core: `regionsOf(payload)` in `packages/core/src/catalog.ts`, tests.
3. [x] CLI `sign --batch`: `regions` per index entry, when non-empty.
4. [x] Web: `CatalogEntry.regions`, `EntrySummary.regions` (catalog or
   payload), `regionsOfSummaries` + `basedInArea` helpers, `GetStarted` `elsewhere` uses it. Tests.
5. [x] Gates; README (catalog fields); commit with the ISSUES.md entry
   removed; push OpenSlate master.
6. [x] Endorsements repo (worktree, not the user's checkout): bump
   `.openslate-version`, push; CI republishes the catalog with `regions`.
7. [x] Check the live catalog has `regions` for BANG; setup check.

## Findings / gotchas

- Live catalog (2026-10-26): BANG's summary is `us/ca` 18 + RTM counted under
  its five counties (`voted_in`), so an SF voter sees "19 races on your
  ballot" but scope `us/ca/bay-area` isn't a locality.
- RTM is the only subject filed under a region today.
- Setup downloads nothing with a current catalog: anything it needs about a
  region must be in `index.json`.
- Dev check (2026-10-26, ~11:45 PM PDT): dev server on :5377 with
  `VITE_PUBLIC_ENDORSEMENTS_CATALOG` pointing at a copy of the live
  `index.json` served on :5378, BANG's entry given `regions`. Incognito, area
  San Francisco: BANG is in its own "Bay Area" group, 161 based elsewhere
  (was 162). Area Fresno County: BANG stays under based elsewhere.
- Until the endorsements catalog is re-signed with this CLI, the live
  catalog has no `regions` and setup behaves as before (no regression).
- Shipped 2026-10-26: OpenSlate master `38104c0`; endorsements master
  `b3ba2e9` (pin → `38104c0`, README), publish run 40460540861 green at
  11:21 PM PDT (06:21Z). Before pushing, the endorsements repo's tests and
  `verify-positions.ts` passed at the new pin, and a throwaway-key
  `sign --batch` gave 64 entries `regions`. Live catalog: 64 entries with
  `regions`, BANG's the five RTM counties. openslate.us in incognito, area
  San Francisco: groups California, San Francisco, Bay Area (BANG), 161 based
  elsewhere.
- `CatalogEntry` is a plain interface (no strict schema), so a new catalog
  field doesn't break the app that's live now.

## Things not to do

- Don't work in the user's endorsements checkout (stale, untracked files).
- Don't rewrite endorsement bundles with `JSON.stringify`.
