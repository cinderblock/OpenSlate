# Regional measures reach the ballot (`us/ca/bay-area`)

## Goal

Fix the ISSUES.md entry "Regional measures (`us/ca/bay-area`) never reach a
voter's ballot". With the area set to San Francisco, My ballot must list "Bay
Area — Regional Measure RTM (Regional Transit Measure)" (on SF's real Nov 3,
2026 ballot; 62 orgs in the public-endorsements catalog take a position on it),
and setup must bring along Local News Matters, whose one article is on RTM.

## Environment / context

- Worktree `C:\Users\camer\.t3\worktrees\OpenSlate\fix-regional-measures`,
  branch `fix/regional-measures`, from `origin/master` `2742444`.
- Catalog data: sibling repo `cinderblock/openslate-public-endorsements`. The
  user's checkout at `~/git/Personal Projects/openslate-public-endorsements` is
  another thread's (staged and untracked work, 3 ahead / 36 behind on
  2026-10-26): don't touch it. Read `origin/master` through an export
  (`git archive origin/master | tar -x -C $TEMP/ope-master`), and make data
  changes in a worktree of that repo.
- Area matching: `apps/web/src/lib/jurisdictions.ts` (`inArea`, `placeRace`).
  My ballot: `apps/web/src/lib/collate.ts` (`placeRace` per position, a race's
  `district` from `districtsOf`). Setup: `racesInArea` in
  `apps/web/src/lib/catalogSummary.ts`, over the catalog's per-entry
  `jurisdictions` (core `racesByJurisdiction`, written by `openslate sign
  --batch` in the endorsements repo's CI).

## Root cause

A jurisdiction path only shows containment by prefix (`us/ca/sf` is in
`us/ca`). `us/ca/bay-area` is a sibling of `us/ca/sf`, so `inArea` sees an
unrelated locality, and nothing in the data says which places vote on RTM.
The area only ever holds the city and county a lookup found. Setup's
`racesInArea` asks the same `inArea` of the catalog summary's jurisdiction
keys, so it misses RTM (and the Local News Matters entry, all of whose
coverage is under `us/ca/bay-area`).

## Survey: other multi-county regions in the catalog (origin/master, 2026-10-26)

`bun scripts/list-subjects.ts 2026-11-03` on an export of origin/master:

- `us/ca/bay-area`: only RTM (64 bundles, incl. the SF, Alameda, San Mateo and
  Santa Clara listings). Also the `context.jurisdiction` of Bay Area News
  Group's and Local News Matters' slates.
- Multi-county special districts are already filed per county with
  `district`: EBRPD (`alameda-county` + `east-bay-regional-park-district/ward-N`,
  ward 7 under `contra-costa-county`), AC Transit, cross-county school
  districts (one race under the county of record, `unsd-N` puts voters on
  either side in). Those already place correctly.
- `us/ca/bart-N`, `us/ca/coa-N`, `us/ca/boe-N`, `cd/sd/ad`: district families
  of the state, set in the area; not a containment problem.
- `us/ca/ebmud` (2 wards) is still a bare special-district locality (no
  `district`): nobody gets it unless they pick it. Separate from this issue
  (no region; it wants `district` like EBRPD). Not touched here.

So RTM is the only subject the fix has to carry today.

## Decisions already made (don't re-ask)

- **Where membership lives: on the subject, as a new optional field
  `voted_in`** (SPEC §3.3): the jurisdictions whose voters decide the contest
  together, when its `jurisdiction` spans several. Not part of identity; a
  ballot listing's value is preferred, like `district`. Reasons:
  - Who votes is a property of the contest, not of a region's name: Regional
    Measure 3 (2018) was voted in all nine Bay Area counties, RTM in five
    (Alameda, Contra Costa, San Francisco, San Mateo, Santa Clara). One
    `bay-area → counties` table, in the app or in data, would be wrong for one
    of them.
  - The project rule: no parsing structure out of strings; add structure.
    A hardcoded app table is knowledge the publisher has and the app doesn't.
  - `district` can't express it: it's one chain of ever-smaller places inside
    `jurisdiction`, not a union.
  - Each entry is a path like `jurisdiction` and is matched the same way
    (`inArea`), so a county is in or out exactly as a race filed under it
    would be.
- Catalog summaries count a subject with `voted_in` under each of its
  `voted_in` paths instead of its jurisdiction ("where it's voted"), so setup
  matches it and the area picker doesn't offer "Bay Area" as a place to live.
  An area holding two of its counties counts it twice; areas hold one county.
- `voted_in` stands in for `jurisdiction` when placing a race (it says where
  the contest is on the ballot); `district` still narrows it. A voter who
  picked the region itself as a place isn't in it unless they're in one of
  its counties.
- In the endorsements repo, `voted_in` lives in a per-contest table
  (`scripts/lib/regions.ts`) and is written into every bundle, positions and
  articles (not just listings like `district`), because setup's catalog
  summary reads each entry's own subjects.

## Plan / steps

1. [x] Claim the ISSUES.md entry (`7f31b0d`, pushed to master).
2. [x] Spec + core (`2d5c607`): `Subject.voted_in` in SPEC §3.3 and the
   changelog, zod schema, JSON schema, vectors `regional-measure` and
   `voted-in-empty`; `racesByJurisdiction` counts by `voted_in`.
3. [x] App (`5d65078`): `placeRace(…, votedIn)`; collate merges `voted_in`
   like `district` (ballot source first, `placesOf`); area options and search
   use it. README line.
4. [x] Tests: core catalog, web jurisdictions, collate, catalogSummary.
5. [x] Endorsements repo, worktree
   `~/.t3/worktrees/openslate-public-endorsements/regional-voted-in`, branch
   `fix/regional-voted-in`, commit `b9cf956`: `scripts/lib/regions.ts`,
   `scripts/assign-voted-in.ts` (text edits), verify check, tests, README,
   68 subjects in 64 bundles, `.openslate-version` → `5d65078…`.
6. [x] Dev-app check against a locally signed catalog (throwaway key, `dist/`
   served on :5299, Vite on :5288 with `VITE_PUBLIC_ENDORSEMENTS_CATALOG`),
   incognito, area San Francisco: setup offered SF counties not "Bay Area";
   RTM-only orgs (TODCO, SF Foundation) show "1 race on your ballot"; My
   ballot lists "Bay Area · 1 / Regional Measure RTM" with SPUR's Yes; its
   race page shows Local News Matters' and the SF Standard's articles, so the
   Local News Matters slate came along.
7. **Current:** ship. Push OpenSlate master first (deploys openslate.us; old
   verifiers reject `voted_in`), then the endorsements branch to its master
   (CI clones OpenSlate at the pin from GitHub, signs, publishes).
8. Check live: openslate.us, area SF, RTM on My ballot, Local News Matters
   offered.
9. Close the ISSUES.md entry.

## Findings / gotchas

- `sed -i` in Git Bash rewrote ISSUES.md with LF line endings (and the
  pattern with `\r$` didn't match). Use the Edit tool on CRLF files; `unix2dos`
  restores them. Bash heredocs mangle `\r\n` escapes in TS written through
  them: write scripts with the Write tool.
- `plans/ui-two-modes-refactor.md` noted RTM "keyed under several
  jurisdictions" (`us/ca`, `us/ca/sf`); on origin/master it is one subject
  under `us/ca/bay-area` now.
- Endorsement bundles are partly hand-formatted (one position per line).
  Rewriting them with `JSON.stringify` reflowed 64 files (+6477 lines); the
  repo's `scripts/position-edit.ts` text edits keep the diff to the new
  property (+504/−9).
- Listing coverage (SPEC §8.2, core `ballot.ts`) keys on
  `subject.jurisdiction`, not catalog summaries, so the SF listing now
  counting RTM under Alameda etc. in its summary doesn't make it "cover"
  Alameda.
- Test-signing locally: clone this branch into the endorsements worktree's
  `.openslate`, `bun install`, `keygen` to `$TEMP`, `sign --batch . --key …
  --force`, `bun scripts/build-site.ts`, serve `dist/` with CORS.
- Side issue logged in ISSUES.md, not fixed: setup lists Bay Area News Group
  (scope `us/ca/bay-area`) as "based elsewhere" for SF voters.

## Progress log

- [x] Read the entry, claimed it.
- [x] Root cause and data survey.
- [x] Spec + core.
- [x] App.
- [x] Catalog data (endorsements branch, not pushed).
- [x] Dev-app verification against a locally signed catalog.
- [ ] Ship app (push OpenSlate master).
- [ ] Ship catalog (push endorsements master; CI publishes).
- [ ] Live check.
- [ ] Close the entry.

## Open questions for the user

None.

## Things not to do

- Don't add a `bay-area → counties` table to the app.
- Don't re-file RTM under each county: it's one contest, and its positions
  must collate across counties.
- Don't work in the user's endorsements checkout.
- Don't publish the catalog before the app that reads `voted_in` is live.
- Don't rewrite bundles with `JSON.stringify`; edit them as text.
