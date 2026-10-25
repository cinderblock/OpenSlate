# Desktop binaries: build and publish, standard and offline

**Branch:** `feat/desktop-binaries` (own worktree). **Started:** 2026-10-24.

## Goal

Ship downloadable OpenSlate desktop apps for Windows, macOS and Linux, built in
GitHub Actions and published to GitHub Releases, in two flavors:

- **Standard**: the web app in a native window; fetches the public catalog and
  voter guides live, like openslate.us.
- **Offline**: the same app with a snapshot of the public endorsements catalog
  (slates, logos) and the voter guides it lists embedded, so ballot planning
  works with no network at all. Live data (polls, forecasts, results, address
  lookups, map tiles) still needs a network and says so.

Then the welcome screen's "A desktop app is on the way" becomes a link to the
downloads (the "What is OpenSlate?" section shipped in `e72ee5c`).

## Environment / context

- Repo `cinderblock/openslate` (public, MIT). No tags, no releases, no
  rulesets, no GitHub Actions workflows yet (`.github/` has only issue
  templates). The hosted web app builds on Cloudflare Workers Builds.
- `apps/desktop`: stub. `src/bun/index.ts` opens a `BrowserWindow` on
  `views://mainview/index.html`; Electrobun is not a dependency yet.
- Electrobun: latest stable **v2.0.4** (2026-10-18). Sibling projects
  `ThisIsFine` and `git-repo-scanner` use it with a `copy` of a Vite `dist`
  into `views/mainview`. The local `electrobun` checkout is v1.17, too old to
  trust for 2.x behavior.
- Web build: Vite, HashRouter (`/#/`), PWA via `vite-plugin-pwa`,
  `apps/web/.env.production` points polls/results/forecasts/relays at
  `https://api.openslate.us`. All user data is IndexedDB + localStorage.
- Catalog: `https://cinderblock.github.io/openslate-public-endorsements/index.json`
  (376 entries, ~358 KB index; logos ~7 MB; `bundle.json` holds every token).
  `guides.json` sits beside it and lists signed guide manifests hosted by
  `openslate-ballot-ca-2026-11-03` (state + county guides; manifest
  `files: { path: sha256 }`, fetched relative to the guide's URL).
  Rough embedded size: tens of MB.
- Everything the app reads from the catalog resolves relative to the catalog
  URL (`new URL(path, catalogUrl)`), and guide files relative to the guide's
  URL, so a relocated copy works if those base URLs are absolute.

## Decisions already made (don't re-ask)

- Build and publish desktop binaries, with and without embedded endorsements
  (user, 2026-10-24).

## Design (current)

1. **Snapshot script** (`apps/web/scripts/snapshot-catalog.ts`): download the
   live catalog (index, bundle, every slate, every logo) and every guide in
   `guides.json` (manifest + every listed file) into one folder, verifying
   slate signatures and guide manifests/file hashes as it goes. `guides.json`
   is rewritten so each guide's `url` is relative to the snapshot. Usable for
   a fully offline self-hosted web build too.
2. **Web app**: resolve a relative `VITE_PUBLIC_ENDORSEMENTS_CATALOG` against
   the page, and relative guide URLs against `guides.json`. A `desktop` Vite
   mode: no PWA service worker (doesn't work on `views://`), API bases at
   `api.openslate.us`.
3. **Electrobun app**: config copies `apps/web/dist` (plus the snapshot for
   the offline flavor) into `views/mainview`; external links open in the
   system browser.
4. **CI** (`.github/workflows/desktop.yml`): matrix of OS runners × flavor,
   build, upload artifacts; on a version tag, attach them to a GitHub Release.

## Plan / steps

1. ☐ Electrobun 2.0.4 research (config, artifacts, CI, `views://` storage,
   signing) — in progress (background agent).
2. ☐ Move this thread into a worktree on `feat/desktop-binaries`.
3. ☐ Snapshot script + web changes; test a snapshot build in a browser.
4. ☐ Electrobun app builds and runs locally on Windows (both flavors);
   data persists across restarts.
5. ☐ Icons (png/ico/icns) generated and committed.
6. ☐ CI workflow; dry run via `workflow_dispatch` on the branch.
7. ☐ Docs: README (How to Run → Desktop), apps/desktop/README, welcome screen
   link.
8. ☐ Publish: merge, tag, release — needs the user's go-ahead (see questions).

## Findings / gotchas

- The Google Civic relay on `api.openslate.us` only answers origins listed in
  `CIVIC_ALLOWED_ORIGINS` (`apps/poll-cache/wrangler.toml`), so desktop
  windows (origin `views://…`) can't use it; a user's own Google key still
  works. Fixing it means a worker config change and deploy: infrastructure,
  needs per-change approval.
- `apps/web/public/icon.svg` draws "OS" with a system font, so rasterizing it
  differs by machine: render once and commit the outputs.

## Progress log

- [x] Explored: desktop stub, catalog/guide URL handling, worker origin rule.
- [ ] Everything in Plan / steps from 1 on.

## Open questions for the user

1. Code signing: unsigned builds trigger SmartScreen (Windows) and Gatekeeper
   (macOS: users must right-click → Open, or `xattr -d`). Signing needs an
   Apple Developer account ($99/yr) and a Windows certificate (or SignPath
   Foundation, free for OSS). Recommendation: ship unsigned first, document
   the workaround, add signing later.
2. Release tag scheme: recommendation `desktop-v0.1.0`, protected by a tag
   ruleset (a GitHub settings change, so it needs your yes).

## Things not to do

- Don't write a Windows dark-titlebar workaround; pin an Electrobun with the
  upstream fix (see `plans/electrobun-dark-mode.md`).
- Don't push master or tags without checking `origin/master..HEAD` and asking:
  other threads' commits ride along.
- Don't change or deploy the poll-cache worker without per-change approval.
