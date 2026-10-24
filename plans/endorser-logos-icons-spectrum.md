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
10. [x] Pushed (user approved, 2026-10-22). Live on openslate.us and the
    catalog republished at 1:40 AM PDT (08:40Z).
11. [x] **More logos** (user, 2026-10-23: "more logos is more better",
    which answered both open questions: fill the gaps *and* replace the small
    ones).
    - [x] `fetch-logos.ts`: Google favicon fallback for bot-blocked sites and
      small icons; `--icon <url>` for a hand-picked image (`4286b4d`); refuses
      WordPress's default "W" and ClubExpress's favicon (`0da326a`).
    - [x] Five agents found and confirmed homepages for orgs with no `uri` and
      hand-picked larger marks for small icons; every changed logo reviewed
      on a contact sheet (three bad picks rejected).
    - [x] `90eb602`: 289 of 335 orgs have a logo (was 177). Pushed; publish
      run 40037507047 succeeded, live catalog: 362 entries, 316 with a logo,
      at 4:05 PM PDT (23:05Z).

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
- My "core: format lean tests" commit (`da257ca`) swept in another thread's
  already-staged `Wizard.tsx` hunks: `git add <path>` + bare `git commit`
  commits the whole shared index. That thread split it before pushing
  (`bce1106` theirs, `7e7266c` mine). Commit with `git commit -- <paths>`.
- The catalog's `index.json` is served `max-age=600`, so a browser that just
  fetched it keeps the old one (no logos) for up to 10 minutes after a
  republish. The app's catalog query adds up to an hour (`staleTime`).
- 2026-10-23 run: of 151 orgs without a logo, ~125 had no `uri` at all in
  meta.yaml (the ballot-argument scripts create meta.yaml without one). Adding
  `uri:` is safe: signed slates carry `attribution.of` from positions.json,
  never meta.yaml, so source ids don't change.
- Google's favicon service
  (`t3.gstatic.com/faviconV2?...&size=256&url=<site>`) serves icons for sites
  that 403 us, returns 404 for unknown sites, and doesn't upscale.
- A `uri` that's a third-party page yields the third party's icon:
  long-beach-young-democrats got Blue Voter Guide's (since fixed: lbyd.org).
- Google's fallback returns WordPress's default "W" for some WordPress sites
  (now refused by hash). A failed re-run leaves the old logo file in place,
  so a bad pick needs `--reject`, not just a re-run.
- Still without a logo (46 orgs): ~33 have no findable website (small clubs,
  coalitions, parked or dead domains); a few have only a white-on-transparent
  logo that vanishes on the avatar's white tile (Lincoln Club OC, BizFed
  Central Valley, PSR-LA), and Haight Ashbury NC and SF Community Land Trust
  show faintly for the same reason. A per-logo dark tile would fix those;
  not done.
- `bun run lint` still fails on CRLF in a Windows checkout (ISSUES.md); lint
  was run with `--formatter-enabled=false` plus `biome format --write`.

## Progress log

- [x] `942f869` core: leanOf
- [x] `b7d1a1d` web: verify each imported slate once
- [x] `da257ca` core: format lean tests
- [x] `2587d5b` web: logos, spectrum, icons
- [x] endorsements `5efed02`, `76453a3`, `5404dd2` logos; `1ae4a8c` catalog extras
- [x] Checks: 312 tests pass, every package typechecks, `vite build` OK.
- [x] OpenSlate master pushed (by the candidate-info thread, in merge `2702f81`;
  my commits are `942f869`, `b7d1a1d`, `7e7266c`, `2f2bd50`); deployed.
- [x] Endorsements repo rebased onto that thread's voter-guide commits and
  pushed (`52b2a40`..`2fa856b`); publish run succeeded. Live catalog: 267
  entries, 200 with a logo, 248 with a lean.
- [x] Logos for the orgs added after the first logo run, and better ones for
  small logos: step 11.

## Open questions for the user

1. White-only logos: which tile? Mocked up side by side on 2026-10-24
   (page in `$TEMP/openslate-edits/tiles/page.html`): A today (monogram /
   faint), B fixed dark #1b1f24, C dark tile in the logo's own hue, D the
   monogram's hue, E recolour to black on white. User leans B or C, and
   asked whether the orgs publish a light-background version first:
   - BizFed CV and SFCLT do (found in their WordPress media libraries via
     `/wp-json/wp/v2/media?search=logo`); swapped in, endorsements `e90825e`
     (local, not pushed).
   - PSR-LA, Lincoln Club OC and HANC don't, as far as I could find
     (crawled 30 pages of each site; social avatars: PSR-LA's are blocked,
     HANC's X avatar is a photo of the street sign, and an @LincolnClubOC X
     avatar is a different Lincoln sketch from an account I couldn't
     confirm is theirs).
   - Those three logos have no colour, so B and C draw them identically.
     Recommended: B, as a hand-set `logo_background: dark` in meta.yaml
     (automatic detection by near-white share misses HANC at 38%).

## Things not to do

- Don't fetch logos from org sites at runtime (privacy; no central server).
- Don't hand-assign a lean to any org.
- Don't push the endorsements repo before OpenSlate `942f869` is on GitHub:
  its CI would fail to check out the pinned ref.
- Don't touch `orgs/sd-green-party/2026-11-03/` in the endorsements repo
  (another thread's untracked work).
