# Endorser logos, icons all around, and a left-right spectrum

## Goal

The user asked (2026-10-22): "more icons all around. endorsers should show
their logo, and maybe even a left-right spectrum."

Three parts:

1. **Icons all around**: the UI was nearly text-only (two emoji in the mode
   switch, a few hand-drawn SVGs in `components/ui`). Add a consistent icon
   set to navigation, primary buttons, section headings and stance buttons.
2. **Endorser logos**: every place an endorser (a slate's entity) is named
   shows its logo, falling back to a coloured monogram.
3. **Left-right spectrum**: place each endorser on a left-right axis, and show
   the user's sources laid out along it.

## Environment / context

- Web app: `apps/web` (React 18, TanStack Router (hash routes), TanStack
  Query persisted to IndexedDB, React Aria kit in `components/ui`).
- Catalog: `openslate-public-endorsements` repo, sibling checkout at
  `~/git/Personal Projects/openslate-public-endorsements`. CI signs
  `orgs/<slug>/<election>/positions.json`, `scripts/build-site.ts` assembles
  `dist/` (copies `orgs/` wholesale, writes `index.json` + `bundle.json`) for
  GitHub Pages. CI uses OpenSlate at the ref in `.openslate-version`.
- `index.json` is ~220 KB with the new fields; `bundle.json` ~5.6 MB.
- Ballot data slates (`kind: election-authority`, e.g. CA SoS) put the
  candidate's party first in each position's `statement`
  (`"Democratic · Attorney"`).
- Party slates: `ca-democratic-party`, `ca-republican-party`, plus county
  pairs `<county>-democratic-party` / `<county>-republican-party` (20 pairs).
- Local preview of the whole thing (this session only): the endorsements
  `dist/` served on :5292 (`$TEMP/openslate-edits/serve-dist.ts`) and a dev
  server on :5293 with `VITE_PUBLIC_ENDORSEMENTS_CATALOG=http://localhost:5292/index.json`.
  The catalog there was signed with a throwaway key; the signed slates were
  deleted afterwards, only `dist/` (gitignored) remains.

## Decisions already made (don't re-ask)

- **Spectrum is computed from picks, not curated.** (User, 2026-10-22.)
  Sides come from where the parties split: subjects a Democratic/Republican
  party pair of slates disagree on, and Democrat-vs-Republican races on the
  ballot. Shown with its counts; hidden below `LEAN_MIN_EVIDENCE` (5).
  OpenSlate makes no editorial judgement.
- **Logos come from the endorsements repo.** (User, 2026-10-22.) Fetched once
  from each org's site, committed as `orgs/<slug>/logo.*` with `logo` /
  `logo_source` in `meta.yaml`, published with the catalog. Browsers never
  contact the orgs. No logo → monogram.
- Icon set: `lucide-react` (ISC, tree-shaken), always next to a visible label.
- No spec change: OpenSlate payloads are closed (SPEC §3.8), so logo and lean
  are catalog metadata, not slate fields.
- No `title=` tooltips (user's standing rule): detail opens on tap via
  `components/ui/InfoPopover.tsx`. The ones in touched UI were removed.

## Plan / steps

1. [x] Core: `packages/core/src/lean.ts` (`leanOf`, `contrastsFromPoles`,
   `contrastsFromBallot`, `mergeContrasts`, `ballotPartySide`) + tests.
2. [x] Web: `EndorserAvatar` and the endorser directory
   (`lib/endorsers.ts`, `EndorsersContext` provided in `App.tsx`).
3. [x] Web: `LeanMeter` / `LeanSummary` / `LeanDetail` and the "Left to
   right" `SpectrumStrip` on Sources.
4. [x] Web: local lean fallback from imported ballot data (`localLeans`).
5. [x] Web: icons all around.
6. [x] Web: service worker caches logo images (`openslate-logos`).
7. [x] Endorsements repo: `scripts/fetch-logos.ts` + 174 logos (background
   agent), contact sheet at `review/logos.html` (gitignored).
8. [x] Endorsements repo: `scripts/catalog-extras.ts`, `build-site.ts` adds
   `logo` + `lean` to entries; `.openslate-version` → `942f869`.
9. [x] README updates in both repos.
10. [ ] **Current step:** push. Needs the user's go-ahead (see open questions).

## Findings / gotchas

- Real-data sanity run (Nov 3 2026, adoptions included): parties land at
  their own ends (CA Dem 144–0, CA GOP 1–129); chambers of commerce, papers
  and some unions spread through the middle (CalChamber 3–6, SF Chronicle
  20–4, CA Professional Firefighters 74–20). LA Times has 1 sided subject,
  hence the minimum of 5.
- `decodeSlates` re-verified every signature on every call; mounting the
  directory at the app root would have added another full pass. Fixed by
  caching verification by token (`b7d1a1d`).
- A zero-specificity (`:where`) reset for the popover trigger loses to the
  global `button {}` rule, so the meter rendered as a grey button. The reset
  now lives in `button.ui-info-bare` beside the other button styles, and
  chips opt out with `bare={false}`.
- Pure helpers exported from component files break Vite Fast Refresh
  ("export is incompatible"); they live in `lib/endorsers.ts`.
- `LeanSummary` must render a `<span>`: it sits inside the wizard's checkbox
  `<label>`, where a `<p>` is invalid.
- Logos: 28 of 174 are under 64 px (e.g. all five Sierra Club chapters share
  sierraclub.org's 16 px favicon). 19 orgs failed (403s, dead sites, no
  `uri`), 6 rejected (Facebook/Wix/IONOS defaults, a photo). Full list in the
  endorsements repo commit `76453a3` and `review/logos.html`.
- `bun run lint` still fails on CRLF in a Windows checkout (ISSUES.md); lint
  was run with `--formatter-enabled=false` plus `biome format --write`.

## Progress log

- [x] `942f869` core: leanOf
- [x] `b7d1a1d` web: verify each imported slate once
- [x] `da257ca` core: format lean tests
- [x] `2587d5b` web: logos, spectrum, icons
- [x] endorsements `5efed02`, `76453a3`, `5404dd2` logos; `1ae4a8c` catalog extras
- [x] Checks: 312 tests pass, every package typechecks, `vite build` OK.
- [ ] Push OpenSlate master (deploys openslate.us), then the endorsements repo.

## Open questions for the user

1. **Push?** OpenSlate master is 9 commits ahead of `origin/master`
   (5 mine, 4 plan commits from the candidate-info thread). Pushing deploys
   openslate.us. The endorsements repo is 4 commits ahead; it must be pushed
   *after* OpenSlate, because CI fetches OpenSlate at `942f869`. Until the
   catalog republishes, the live app shows monograms and computes lean only
   from imported ballot data. Recommendation: push both, OpenSlate first.
2. Lower-quality logos (28 under 64 px, several only 16 px): accept for now,
   or hand-source better ones for the most-followed orgs?

## Things not to do

- Don't fetch logos from org sites at runtime (privacy; no central server).
- Don't hand-assign a lean to any org.
- Don't push the endorsements repo before OpenSlate `942f869` is on GitHub:
  its CI would fail to check out the pinned ref.
- Don't touch `orgs/sd-green-party/2026-11-03/` in the endorsements repo
  (another thread's untracked work).
