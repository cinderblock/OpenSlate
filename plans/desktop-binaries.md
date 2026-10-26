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
- Ship **unsigned** (no Apple/Windows code signing) for now, **but self-updates
  must be signed**: the app installs only updates signed by our own key
  (user, 2026-10-25).
- Tag scheme `desktop-v<version>`, protected by a tag ruleset (user,
  2026-10-25; ruleset created, see Findings).
- No Mac available to test by hand: macOS ships tested only by CI's
  self-test (user, 2026-10-25).
- Approved: mark PR #1 ready, merge, push the tag (user, 2026-10-25).
  Publishing the drafted release is a separate yes. Held until the signed
  updater is in, so 0.1.0 installs can update themselves.
- Both update keys live only as GitHub secrets, no password-manager copy;
  go ahead: merge PR #1, tag and publish `desktop-v0.1.0` (user,
  2026-10-25).

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
8. ☑ Signed self-updates (see "Updates" below): built, unit-tested, and
   tested end to end on Windows against a local feed.
9. ☑ `desktop-release` / `desktop-recovery` environments and key secrets.
10. ☑ Released. PR #1 merged (`b4d21e7`); tag `desktop-v0.1.0` → run
   40250421358 (all builds, self-tests, signing, draft green); staged feeds
   verified with the app's keys; published 2026-10-25 5:45 PM PDT (00:45Z
   Oct 26); `desktop-publish.yml` run 40250854812 made both feeds live; the
   live feeds, fetched from their public URLs, verify. Local key files
   deleted. https://github.com/cinderblock/OpenSlate/releases/tag/desktop-v0.1.0

## Releasing the next version

Bump `apps/desktop/package.json`'s version, merge to master, tag the merge
`desktop-v<version>` (admins only, ruleset), check the draft, publish it.
The build makes delta patches from the live version automatically.

## Known gaps (not asked for; for later)

- The update itself is tested end to end only on Windows; macOS and Linux
  installs haven't updated themselves yet. The *Restart to update* click
  wasn't exercised by hand (synthetic input didn't reach WebView2).
- Unsigned builds (SmartScreen, Gatekeeper `xattr`), no Intel Mac build.
- The Google Civic relay rejects the desktop's `views://` origin
  (`CIVIC_ALLOWED_ORIGINS`, infra: needs per-change approval).
- About 30 other "this browser" strings in the web app; window title-bar
  icon is generic (Electrobun #565).

## Updates (design, 2026-10-25)

Electrobun's updater checks nothing cryptographically: its `hash` is a
13-character build ID (`/^[a-z0-9]{1,13}$/`), and the bundle, patches and
`update.json` are trusted as served. So the app adds its own check:

- **Signed statement** per edition and platform,
  `<channel>-<os>-<arch>-signature.json`: `{ statement, signatures: [{ key,
  signature }] }`, where `statement` is a JSON string `{ type:
  "openslate-desktop-update", identifier, channel, platform, arch, version,
  hash, tarSha256, tarBytes }` and each signature is Ed25519 over the
  statement's UTF-8 bytes (core's `ed25519:` base58 keys, base64url
  signatures).
- **In the app** (`src/bun/update.ts`): check, fetch and verify the statement
  (a trusted key; identifier, channel, platform, arch, version and hash match
  Electrobun's `update.json`; version newer than the running one, so an old
  signed release can't be replayed), let Electrobun download, then hash the
  prepared `self-extraction/<hash>.tar` and compare with `tarSha256` before
  anything is applied. A mismatch deletes the prepared update and the local
  patch base, and retries once with the full bundle. The page shows "ready,
  restart to update"; the restart re-checks the hash and calls `applyUpdate`.
- **Two trusted keys** baked in: *release* (a GitHub Actions secret in the
  `desktop-release` environment, tags `desktop-v*` only) and *recovery*
  (`OPENSLATE_UPDATE_RECOVERY_KEY` in a separate `desktop-recovery`
  environment, also `desktop-v*` tags only, used by no workflow; signs a
  release that changes keys if the release key leaks).
- **Feeds**: one prerelease per edition (`desktop-updates-standard`,
  `desktop-updates-offline`), `release.baseUrl` =
  `https://github.com/cinderblock/OpenSlate/releases/download/<that tag>`
  (`scripts/feed.ts`). The tag job uploads `v0.1.0-`-prefixed copies of
  `update.json`, the signature and the bundle, plus the patches (named for
  the build they start from, so inert until `update.json` changes). Nothing
  is live until the versioned release is published: `desktop-publish.yml`
  (`release: published`) copies the staged files to the live names, bundle
  then signature then `update.json`, and prunes anything older than the
  previous version. The live bundle keeps Electrobun's name (see Findings).
- **Keys** generated 2026-10-25 with core's `generateKeyPair`: release
  `ed25519:BzKVTftwYGSDUf6CzqGmbBykFMrSN4tCcfFaTmrT6eEX`, recovery
  `ed25519:Hmpghduf2yLhjUsmsYgcBokTQKG9jLZ5SBmVUmyZZHyz`. The private halves
  live only in those GitHub secrets (user, 2026-10-25: "all keys live on
  github"); the local files were deleted once the release job had signed
  with the release key.

## Findings / gotchas

### Updates (2026-10-25, Windows 11)

- Tag ruleset "Desktop release tags" (id 25842427) created: `refs/tags/desktop-v*`,
  rules creation/update/deletion/non_fast_forward, repo admins bypass.
- **Electrobun makes a delta patch only if the previous bundle in the feed has
  its own name** (`stable-win-x64-OpenSlate.tar.zst`): with a versioned name
  in `artifact.file` the build says "previous update metadata does not match
  this release; skipping delta patch". With the original name: "Patch: 3.80 KB
  (0.0% of new size)" instead of a 35 MB download. Hence the stage/publish
  copy.
- The build fetches `${baseUrl}/stable-win-x64-update.json` (and the bundle)
  to make the patch; "no previous release found; skipping delta patch" when
  the feed has none, which is fine for the first release.
- `Bun.zstdDecompressSync` gives the same tar as Electrobun's `zig-zstd`: the
  CI-side SHA-256 matched what the app hashed after both a full download and
  a patch.
- End to end against a local feed (test key, `OPENSLATE_UPDATE_BASE_URL`):
  0.1.0 installed by `Setup.exe` → found 0.1.1, verified, patched (3.8 KB),
  hash matched, banner showed "OpenSlate 0.1.1 is ready" → installed and
  relaunched as 0.1.1 (`version.json`). Untrusted key on 0.1.2: "the update
  isn't signed by a key this app trusts", nothing downloaded. Correctly
  signed 0.1.2 with one byte of the bundle flipped: rejected after the
  download, retried in full, rejected, discarded, stayed on 0.1.1; once the
  genuine bundle was back, it updated to 0.1.2. 0.1.2 → 0.1.3 likewise.
- Not exercised: the *Restart to update* click itself. Synthetic mouse input
  (`mouse_event`) didn't reach the WebView2 window. The click calls
  `__electrobunSendToHost({ openslateUpdate: "apply" })`, the same channel the
  self-test uses, and the install it triggers is the auto-apply path tested
  above. macOS and Linux updates are untested (no Mac; Linux would need a
  desktop session).
- Setup.exe ends on an "Installation complete" dialog; the install writes
  `HKCU\…\Uninstall\us.openslate.desktop.stable`, Desktop and Start menu
  shortcuts. Applying an update leaves
  `.electrobun-update-<id>.result.json` in the channel folder.

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
- [x] Tag ruleset (id 25842427).
- [x] Signed updates: `update-signature.ts`, `update.ts`, keys, banner,
      `sign-update.ts`, `verify-update.ts`, `feed.ts`, CI (PRs sign with a
      throwaway key; tags sign for real and stage), `desktop-publish.yml`,
      docs. Tests: 10 unit, end to end on Windows (above). Test install,
      feed server and files cleaned up.
- [x] `desktop-release` and `desktop-recovery` environments (deployment
      tags `desktop-v*`), each with its key as a secret (2026-10-25).
- [x] Merged, tagged, published `desktop-v0.1.0`; feeds live and verified.

## Open questions for the user

None open. (Answered 2026-10-25: create the environments and secrets, keys
live on GitHub only, merge PR #1, tag and publish `desktop-v0.1.0`.)

## Things not to do

- Don't push a branch based on local master: other threads' unpushed commits
  ride along (some wait on the user). The branch was rebuilt on
  `origin/master`; the old head is `backup/desktop-binaries-on-local-master`.

- Don't write a Windows dark-titlebar workaround; pin an Electrobun with the
  upstream fix (see `plans/electrobun-dark-mode.md`).
- Don't push master or tags without checking `origin/master..HEAD` and asking:
  other threads' commits ride along.
- Don't change or deploy the poll-cache worker without per-change approval.
