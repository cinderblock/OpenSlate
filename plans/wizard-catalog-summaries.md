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

- Repo `C:\Users\camer\git\Personal Projects\OpenSlate` (shared working tree,
  branch `master`).
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
2. [ ] core: `racesByJurisdiction(payload)`, tested.
3. [ ] CLI: `sign --batch` writes `scope` + `jurisdictions` per entry.
4. [ ] web: catalog types; prefetch the catalog when the wizard opens.
5. [ ] web: wizard reads summaries; fallback fetch starts early with a bar.
6. [ ] web: import step with a progress bar, concurrency, strong "wait"
       message, guarded stop; "download all" via bundle.
7. [ ] public-endorsements: `bundle` field in `index.json`; types for the new
       entry fields; bump `.openslate-version` once OpenSlate is pushed.
8. [ ] Checks, browser check in a fresh profile, README, commit.

## Findings / gotchas

- `bundle.json` already exists in the public catalog (build-site.ts) but the
  app never used it.
- GitHub Pages gzips `bundle.json`; a browser's `Content-Length` is then the
  compressed size while the stream yields decompressed bytes, so progress needs
  the uncompressed size from the catalog.

## Progress log

- [x] Explored wizard, catalog producer and public catalog repo.

## Open questions for the user

1. Pushing: OpenSlate master deploys the app; the public catalog repo needs the
   OpenSlate commit on GitHub before bumping `.openslate-version`. Ask before
   pushing either.

## Things not to do

- Don't `verifySlate` hundreds of tokens on the main thread for a preview.
- Don't make the app depend on the new fields: catalogs without them must work.
