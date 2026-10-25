# Desktop binaries: build and publish, standard and offline

**Branch:** `feat/desktop-binaries` (own worktree,
`~/.t3/worktrees/OpenSlate/feat-desktop-binaries`), built on `origin/master` with
only this task's commits. **Started:** 2026-10-24.

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

1. ☑ Electrobun 2.0.4 research (config, artifacts, CI, `views://` storage,
   signing): see Findings.
2. ☑ Moved into the worktree on `feat/desktop-binaries`.
3. ☑ Snapshot script + web changes (`1d656f6`, `40bdbc2`, `118baf6`); an
   offline web build checked in a browser: catalog, logos, a voter guide all
   from the copy, no request left localhost.
4. ☑ Electrobun app (`8259e34`) builds and runs on Windows, both editions;
   self-test passes; storage survives restarts; installer and uninstaller
   work.
5. ☑ Icons generated and committed.
6. ☑ CI workflow (`6579abe`), first run on draft PR #1
   (https://github.com/cinderblock/OpenSlate/pull/1, run 40167794253): all 8
   jobs green; the self-test passed for both editions on windows-2025,
   macos-14 and ubuntu-24.04 (Xvfb), storage across a restart included.
   (`workflow_dispatch` only works once the file is on the default branch.)
7. ☑ Docs: apps/desktop/README, RELEASE_NOTES, root README (`afa69d1`); the
   macOS app is `OpenSlate Offline.app` (with a space), checked in the dmg.
8. ☐ **(current)** Publish: merge PR #1, tag `desktop-v0.1.0`, publish the
   drafted release — needs the user's go-ahead (see questions).

## Findings / gotchas

### From building it (2026-10-24, Windows 11)

- **`navigationRules` as a `BrowserWindow` option didn't block anything**
  (`JSON.stringify([...])`; the native side may want a comma-separated
  string). `mainWindow.webview.setNavigationRules(["^*", "views://*"])` after
  creating the window works: the self-test's `location.href = "https://…"`
  stays on `views://mainview/index.html`.
- Electrobun's config loader doesn't run in the project folder:
  `readFileSync("package.json")` → `ENOENT … ConfigLoadFailed`. Resolve with
  `new URL("./package.json", import.meta.url)`.
- First `electrobun` run from Git Bash failed: Hutch's `install.ps1` picked up
  Git's `/usr/bin/tar` (`Cannot connect to C: resolve failed`). From
  PowerShell it installs (to `~/.hutch`, and adds `~/.hutch/bin` to the user
  PATH). Later runs from bash are fine.
- `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port` is ignored
  (Electrobun sets its own arguments); `win.chromiumFlags` is CEF-only. Hence
  the in-app self-test (`OPENSLATE_SELFTEST`) to inspect the real window.
- A missing `views://` file is a network error ("Failed to fetch"), not 404.
- Service workers: `getRegistrations()` throws "The document is in an invalid
  state" on `views://`, as expected; the desktop build has none.
- The updater file is `stable-win-x64-update.json`, without the app name, so
  the two editions **can't share a release's update files**. Dropped
  `release.baseUrl` and publish installers only; the updater needs separate
  locations per edition first.
- The `build/stable-*/…/launcher.exe` isn't runnable in place ("installer
  package is incomplete"); test via the zip's `Setup.exe`. Installs to
  `%LOCALAPPDATA%\us.openslate.desktop\stable\app`, with Start menu and
  desktop shortcuts; uninstall offers *App* / *App and Data* (data = keys).
- Window icon in the title bar stays generic (Electrobun issue #565); the
  taskbar and shortcuts use ours.
- Sizes (CI, zipped artifacts): Windows 34 MB standard / 43 MB offline;
  macOS dmg 21 / 30 MB; Linux 36 / 45 MB. Windows Setup zip 36 MB locally. Snapshot 31 MB, 1,729 files
  (376 slates, 291 logos, 7 guides), 17 s to take.

### Electrobun 2.0.4 (research 2026-10-24, from the v2.0.4 tag on GitHub; not yet run)

- 2.x builds through **Hutch**; the `electrobun` npm package is a launcher that
  downloads the paired Hutch. `bunx electrobun build --env=stable`. Config
  needs `build.mainProcess: "bun"` explicitly; Bun entry imports from
  `electrobun/main` (not `electrobun/bun` as the stub has). Add a
  `hutch.config.ts` (`packageManager: "bun"`) and gitignore `.hutch/`.
- `build.copy` takes whole nested folders but **rejects absolute paths and
  `..`**: the web dist (and snapshot) must be staged inside `apps/desktop`
  first. Vite's default `base: "/"` works (`views://mainview/assets/...`).
- **No cross-building**: one runner per OS. Electrobun's own release uses
  `macos-14`, `ubuntu-24.04`, `windows-2025`. **No Intel Mac on 2.0.4**
  (returns in 2.0.5-beta.4).
- Artifacts (`artifacts/`, names fixed, spaces stripped from the app name):
  macOS `.dmg`; Windows `win-x64-<App>-Setup.zip` (zip around a setup exe);
  Linux `linux-x64-<App>-Setup.tar.gz` (self-extracting installer; no
  AppImage/deb; needs Ubuntu 24.04+-era glibc and `libwebkit2gtk-4.1-0`).
  Plus updater files `stable-<os>-<arch>-<App>.app.tar.zst` and
  `-update.json`, which must not be renamed. Installers can be renamed.
- **Both flavors in one release need different app names**, or their updater
  files collide. So: "OpenSlate" and "OpenSlate Offline", with identifiers
  `us.openslate.desktop` and `us.openslate.desktop.offline`. Storage is keyed
  by identifier, so the two flavors keep separate data.
- Storage: default partition `persist:default`, keyed by identifier and
  channel; Windows `%LOCALAPPDATA%\<identifier>\stable\WebView2\...`. The
  uninstaller's "App and Data" option deletes it (users' keys!). Nobody has
  tested IndexedDB/localStorage/`crypto.subtle` on `views://`: **must verify**.
  OPFS is refused on `views://`. Service workers: assume none.
- WebView2 runs with `--disable-web-security`: keep remote content out of the
  window (navigation rules: block all but `views://*`, open http(s) in the
  system browser from `will-navigate`).
- `target=_blank` on Windows opens a bare WebView2 popup (no
  `NewWindowRequested` handler); Linux probably does nothing. The SPA must
  turn external `_blank` links into something the Bun side can open
  externally.
- Signing: macOS via `mac.codesign`/`notarize` + `ELECTROBUN_*` env vars;
  unsigned CI downloads show as "damaged" until `xattr -cr` (ad-hoc
  `ELECTROBUN_DEVELOPER_ID=-` may help; untested). macOS app must be dragged
  to /Applications before first launch. Windows signing isn't built in;
  unsigned gets SmartScreen's "Run anyway".
- Updater: `release.baseUrl` set to
  `https://github.com/cinderblock/openslate/releases/latest/download` is baked
  into installs, so set it from the first release; wire the in-app check later.
- Windows dark titlebar fix is in 2.0.4 (supersedes
  `plans/electrobun-dark-mode.md`'s pin advice).

- The Google Civic relay on `api.openslate.us` only answers origins listed in
  `CIVIC_ALLOWED_ORIGINS` (`apps/poll-cache/wrangler.toml`), so desktop
  windows (origin `views://…`) can't use it; a user's own Google key still
  works. Fixing it means a worker config change and deploy: infrastructure,
  needs per-change approval.
- `apps/web/public/icon.svg` draws "OS" with a system font, so rasterizing it
  differs by machine: render once and commit the outputs.

## Progress log

- [x] Explored: desktop stub, catalog/guide URL handling, worker origin rule.
- [x] Snapshot script, built-in catalog support, desktop Vite mode.
- [x] Electrobun app, icons, self-test; verified on Windows.
- [x] CI workflow written (actionlint clean).
- [x] CI green on all six builds, self-tests included (run 40167794253).
- [x] Root README; macOS app name in RELEASE_NOTES.
- [x] Cleaned up local self-test data (`%LOCALAPPDATA%\us.openslate.desktop*`).
- [ ] Merge, tag, publish (user's go-ahead).

## Open questions for the user

0. Is there a Mac (Apple Silicon) available to smoke-test the macOS build?
   Without one, the macOS artifact ships untested at runtime.

1. Code signing: unsigned builds trigger SmartScreen (Windows) and Gatekeeper
   (macOS: users must right-click → Open, or `xattr -d`). Signing needs an
   Apple Developer account ($99/yr) and a Windows certificate (or SignPath
   Foundation, free for OSS). Recommendation: ship unsigned first, document
   the workaround, add signing later.
2. Release tag scheme: recommendation `desktop-v0.1.0`, protected by a tag
   ruleset (a GitHub settings change, so it needs your yes).

## Things not to do

- Don't push a branch based on local master: other threads' unpushed commits
  ride along (some wait on the user). The branch was rebuilt on
  `origin/master`; the old head is `backup/desktop-binaries-on-local-master`.

- Don't write a Windows dark-titlebar workaround; pin an Electrobun with the
  upstream fix (see `plans/electrobun-dark-mode.md`).
- Don't push master or tags without checking `origin/master..HEAD` and asking:
  other threads' commits ride along.
- Don't change or deploy the poll-cache worker without per-change approval.
