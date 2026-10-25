# Setup wizard: pick sources from the list, download only the picks

## Goal

The getting-started wizard downloaded and verified every slate for the chosen
election (346 for 2026-11-03) on the "Where do you vote?" step, just to build
the area picker and count races per organization. The step showed
"Loading endorsements… x of y" and could sit for a long time (ISSUES.md: "Setup
wizard hangs on 'Where do you vote?'").

The user (2026-10-24): load the *list* separately from the *contents*, so the
area and sources steps are immediately available, and only download the
selected organizations' slates at the end. Offer a "download all" option for
privacy (the server can't tell whose recommendations you use). Where there is
still a wait, show a loading bar instead of "x of y", with a clear message
strongly suggesting waiting rather than skipping.

## Environment / context

- Repo `C:\Users\camer\git\Personal Projects\OpenSlate`. Core + CLI landed on
  `master` in the shared tree (`7dbaf9c`); the web work moved to its own
  worktree, branch `feat/wizard-catalog-summaries` (T3 handoff), because
  `plans/disagree-sources.md` is reworking follow state (`setFollowed` →
  `setStanding`, `Standing` = follow / disagree / off) and the wizard's sources
  step at the same time. Rebase onto master once that thread commits, and use
  its `setStanding` / selection control rather than `setFollowed`.
- WIP carried over as files in `%TEMP%\wizard-catalog-wip\`: `query.patch`,
  `styles-mine.patch` (only the progress-bar hunk), `ProgressBar.tsx`
  (→ `components/ui/`), `catalogSummary.ts` and `fetchProgress.ts`
  (→ `lib/`).
- Catalog producer: `packages/cli/src/index.ts` `cmdSignBatch` writes
  `index.json`. The public catalog repo
  `C:\Users\camer\git\Personal Projects\openslate-public-endorsements`
  (`scripts/build-site.ts`) adds `logo`/`lean` and writes `dist/index.json` and
  `dist/bundle.json` (every entry with its token inline). Its CI clones
  OpenSlate at `.openslate-version`.
- Live catalog: https://cinderblock.github.io/openslate-public-endorsements/index.json
  (376 entries, 358 KB). `bundle.json` there: 8.8 MB raw, ~1.3 MB gzipped,
  `Access-Control-Allow-Origin: *`.
- Wizard: `apps/web/src/components/Wizard.tsx`, host `WizardHost.tsx`,
  import helper `lib/catalogImport.ts`, catalog types `lib/query.ts`.
- Checks: `bun run typecheck`, `bun test`, Biome with a CRLF config copy
  (`bunx biome check --config-path="$TEMP/biome-crlf" apps packages`),
  `bun run build`.

## Decisions already made (don't re-ask)

- Catalog entries carry a per-entry summary so the wizard needs no slate
  contents before the import: `scope` (the slate's `context.jurisdiction`) and
  `jurisdictions` (distinct races per position jurisdiction, `""` for none).
  Computed by core (`racesByJurisdiction`) so the CLI and the app's fallback
  agree. Written by `sign --batch`, the generic catalog producer.
- Old catalogs (no summaries, e.g. third-party, or the live one until it's
  republished) still work: the wizard falls back to fetching contents, starting
  as soon as the election is known, with a progress bar and a "please wait"
  message. Fallback parses without verifying signatures (preview only; import
  verifies).
- "Download all" is a Checkbox on the sources step (kit guidance: Checkbox for
  "include in a set", Switch for immediate settings), modifying the main
  action. It imports every slate of the election; the ones not picked start
  unfollowed (same as the catalog's "Import all for comparison"), so following
  one later needs no request. Uses the catalog's `bundle` (one request) when
  advertised, else per-entry fetches.
- The catalog advertises its bundle with `bundle: { path, bytes }`; `bytes` is
  the uncompressed size, so progress works even when the transfer is gzipped.

## Plan / steps

1. [x] Plan doc; claim the ISSUES.md wizard-hang entry.
2. [x] core: `racesByJurisdiction(payload)`, tested (`7dbaf9c`).
3. [x] CLI: `sign --batch` writes `scope` + `jurisdictions` per entry
   (`7dbaf9c`). Measured on the live bundle: +154 KB pretty-printed over 376
   entries (index is 358 KB; gzip shrinks both); ballot slates have up to 212
   jurisdictions.
4. [x] web: catalog types; prefetch the catalog when the wizard opens.
5. [x] web: wizard reads summaries; fallback fetch starts early with a bar.
6. [x] web: import step with a progress bar, concurrency 6, strong "wait"
       message, guarded Stop (ConfirmLink, which SkipSetup now uses), Escape
       ignored while running; "download all" via the bundle.
7. [~] public-endorsements: `bundle: {path, bytes}` in `index.json`, types and
       README for the new fields — committed locally there, not pushed.
       **Next:** after OpenSlate master (with `7dbaf9c`) is on GitHub, bump
       `.openslate-version` there and push, so CI re-signs with the new CLI.
8. [x] Checks, browser check in a fresh profile, README, commit.
9. [ ] Rebase `feat/wizard-catalog-summaries` onto master (disagree-sources
       landed as `7fad8f5`: `setStanding`, `StandingToggle` in the wizard) and
       merge. Then ask the user before pushing either repo.

## Findings / gotchas

- `bundle.json` already exists in the public catalog (build-site.ts) but the
  app never used it.
- `apps/web/src/lib/download.ts` already exists (`downloadText`). A Write to
  that path clobbered it once this session; restored from HEAD (it matched HEAD
  at session start). The download helpers live in `lib/fetchProgress.ts`.
- Importing slates one `slatesCollection.insert` at a time made "download
  all" take 40+ s for 346 slates: every insert re-collated the ballot behind
  the dialog. Batched (verify each, then one insert) it takes ~3.6 s locally.
  The collection's `onInsert` only persisted `mutations[0]`; it now persists
  and confirms every row of a batch.
- Browser check (2026-10-24, T3 incognito, a local catalog built from the live
  bundle with summaries, served gzipped and slowed): area and sources steps
  appear with no slate requests; picks import with the bar; download-all makes
  one `bundle.json` request, the byte bar tracks it, 346 stored, 1 followed,
  336 recorded unfollowed; Escape ignored mid-import; Stop → Stop anyway kept
  the 227 checked so far. Old-format catalog: fetching starts on "Plan my
  vote", wait bar + message on the area step, worst main-thread stall 126 ms.
- GitHub Pages gzips `bundle.json`; a browser's `Content-Length` is then the
  compressed size while the stream yields decompressed bytes, so progress needs
  the uncompressed size from the catalog.

## Progress log

- [x] Explored wizard, catalog producer and public catalog repo.
- [x] Core + CLI summaries (`7dbaf9c` on master).
- [x] Web wizard, batched import, progress bar, download all (branch
      `feat/wizard-catalog-summaries`).
- [x] public-endorsements build-site `bundle` field (local commit there).
- [ ] Rebase onto master, merge, push (ask first), bump `.openslate-version`.

## Open questions for the user

1. Pushing: OpenSlate master deploys the app; the public catalog repo needs the
   OpenSlate commit on GitHub before bumping `.openslate-version`. Ask before
   pushing either.

## Things not to do

- Don't `verifySlate` hundreds of tokens on the main thread for a preview.
- Don't make the app depend on the new fields: catalogs without them must work.
- Don't Write a new file without checking the path is free (see download.ts).
