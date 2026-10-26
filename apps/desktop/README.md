# @openslate/desktop

The OpenSlate web app in a native window, for Windows, macOS and Linux, built
with [Electrobun](https://blackboard.sh/electrobun) on each system's own
webview (WebView2, WKWebView, WebKitGTK). It contains **no OpenSlate logic**:
it loads the web app, which imports `@openslate/core` like every other
surface, so signing, verification and the wire format live in one place. The
main process only opens the window, sends outside links to the browser, and
installs updates once it has checked they're signed (below).

Two editions:

| Edition | Name | Identifier | Public catalog |
| --- | --- | --- | --- |
| Standard | OpenSlate | `us.openslate.desktop` | read live, like openslate.us |
| Offline | OpenSlate Offline | `us.openslate.desktop.offline` | a copy built in: every slate, logo and voter guide, checked when the copy was taken |

The offline edition plans a ballot with no internet at all. Polls, forecasts,
results, address lookups and map images still need a connection, and say so.
The two keep separate data, so both can be installed at once.

## Downloads

Releases are on GitHub: <https://github.com/cinderblock/openslate/releases>.

- **Windows** (x64): unzip `…-windows-x64-Setup.zip` and run the `Setup.exe`
  inside, keeping the `.installer` folder beside it. It installs for the
  current user (no admin), with Start menu and desktop shortcuts. The builds
  aren't code-signed yet, so SmartScreen warns: *More info → Run anyway*.
- **macOS** (Apple Silicon): open the `.dmg` and drag the app to
  Applications; start it from there (it unpacks itself on first launch and
  can't from the disk image). Unsigned, so macOS may call it damaged: run
  `xattr -cr "/Applications/OpenSlate.app"` (or `"/Applications/OpenSlate
  Offline.app"`) once, then open it.
- **Linux** (x64, Ubuntu 24.04 or newer, or equivalent): extract
  `…-linux-x64-Setup.tar.gz` and run the `installer` inside. Needs
  `libwebkit2gtk-4.1-0` and `libgtk-3-0`.

**Uninstalling:** the uninstaller offers *App* or *App and Data*. *App and
Data* also deletes your signing keys, picks and notes. Download a backup of
any identity you'll want again first (Publish → Identities).

## Updates

The app updates itself. Shortly after it starts, and every six hours, it asks
its edition's update feed whether there's a newer version; if so it
downloads it (usually a patch of a few KB, otherwise the whole bundle) and
offers *Restart to update* at the top of the window.

Electrobun's updater doesn't check what it downloads, so the app does
([`src/bun/update.ts`](./src/bun/update.ts)). Each release carries, per
platform, a statement of exactly which update it is (app, platform, version,
build) and the SHA-256 of its unpacked bundle, signed with an Ed25519 key the
app has built in ([`update-keys.ts`](./src/bun/update-keys.ts)). An update is
installed only if:

- a trusted key signed its statement, and the statement names the same
  update the feed offers;
- it's newer than the running version, so an old release can't be served
  again to roll an install back;
- the bundle Electrobun prepared hashes to the signed SHA-256, checked after
  the download and again just before installing. A bundle that doesn't is
  deleted, and one full download is tried before giving up until the next
  check.

Two keys are trusted: the **release** key, which signs in GitHub Actions (the
`OPENSLATE_UPDATE_SIGNING_KEY` secret of the `desktop-release` environment,
which only `desktop-v*` tags can use), and a **recovery** key, to sign an
update that replaces the release key if it's ever leaked. The recovery key is
the `OPENSLATE_UPDATE_RECOVERY_KEY` secret of a separate `desktop-recovery`
environment that no workflow uses, so the release job never sees it; using it
means adding a workflow (or a step) that names that environment. GitHub
secrets can't be read back, so neither key exists anywhere else.

**Feeds.** Electrobun names its `update.json` only by channel and platform,
so each edition gets a release of its own as its feed:
`desktop-updates-standard` and `desktop-updates-offline` (the app's
`release.baseUrl`). A `desktop-v*` tag builds, signs and *stages* the
updates there, under `v<version>-…` names that nothing fetches. Publishing
the versioned release runs [`desktop-publish.yml`](../../.github/workflows/desktop-publish.yml),
which copies them to the live names (bundle, then signature, then
`update.json`), so installs are offered a version only once its release is
published. See [`scripts/feed.ts`](./scripts/feed.ts).

To check a feed's files by hand: download them into a folder and run
`bun scripts/verify-update.ts <folder>`.

**Testing an update locally:** build with `OPENSLATE_UPDATE_BASE_URL` set to
a local server and `OPENSLATE_TEST_UPDATE_KEY` set to a throwaway public key
(that build then trusts only that key), install it, build a newer version
the same way, sign it with `scripts/sign-update.ts`, and serve its updater
files. `OPENSLATE_UPDATE_LOG=<file>` logs each step, and
`OPENSLATE_UPDATE_AUTO_APPLY=1` installs without the click.

## Building

```sh
bun install
bun run --filter @openslate/desktop build                     # standard → apps/desktop/artifacts/
bun run --filter @openslate/desktop build --flavor offline    # offline edition
bun run --filter @openslate/desktop dev [--flavor offline]    # build and launch a dev copy
```

[`scripts/build.ts`](./scripts/build.ts) builds the web app with
`vite build --mode desktop` (settings from `apps/web/.env.desktop`, no service
worker) into `web/`, adds a fresh catalog snapshot for the offline edition
(`apps/web/scripts/snapshot-catalog.ts`; `--snapshot <dir>` reuses one), then
runs `electrobun build`. Electrobun builds only for the machine it runs on;
CI builds every platform on its own runner
([`.github/workflows/desktop.yml`](../../.github/workflows/desktop.yml)).

The first build downloads Electrobun's toolchain (Hutch) into `~/.hutch`; on
Windows it also adds `~/.hutch/bin` to your PATH. `bun run typecheck` runs
`electrobun prepare` first, which projects the SDK types into `.hutch/devkit`.

Icons come from `apps/web/public/icon.svg`. After changing it, run
`bun run --filter @openslate/desktop icons` (needs the `resvg` CLI) and
commit `icons/`.

## Self-test

`OPENSLATE_SELFTEST=<report.json>` makes the app check itself in its own
window (the page renders, localStorage and IndexedDB work, SHA-256, bundled
files load, links to other sites leave through the system browser and the
window stays on the app), write the results to the file, and quit. Run it
twice: the second report's `previous` values show storage survived a
restart. Links are recorded, not opened, during a self-test.

## How links work

The window only ever shows the app's own `views://` pages: WebView2 runs with
web security off, so nothing from the web may load in it. A preload script
hands `target=_blank` links and `window.open` calls to the main process, and
navigation rules block anything else; the main process opens those in the
system browser ([`src/bun/index.ts`](./src/bun/index.ts)).
