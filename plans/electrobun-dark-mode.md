# Electrobun dark mode — read before adding the electrobun dependency

**Status:** Informational, forward-looking. Nothing to fix yet.
**Issue:** https://github.com/blackboardsh/electrobun/issues/349 (closed 2026-08-02)
**Applies to:** `apps/desktop`

Notes last verified against electrobun `main` on 2026-08-02.

## Current state

`apps/desktop` is still a stub. Electrobun is referenced only in scripts (`"dev": "electrobun dev"`,
`"build": "electrobun build"`) and is deliberately **not** a dependency — the `apps/desktop` README
says this keeps the root install light. It is absent from `OpenSlate/bun.lock` and from
`node_modules`, and there is no `electrobun.config.ts` yet. `src/bun/index.ts` imports
`BrowserWindow` from `electrobun/bun` with a comment noting it won't resolve until
`bun add -d electrobun`. There is no dark-mode code here at all.

## When you eventually run `bun add -d electrobun`

**Pin a stable release newer than `v1.18.1`.** Latest stable is `v1.18.1` (2026-05-04) and it has a
known Windows dark-mode defect: the OS titlebar stays light/grey while a dark UI renders below it.

The fix first appears in prerelease **`v1.18.4-beta.13`** (tag `5b25ab4e`, 2026-08-03). Check for a
stable successor with `gh release list --repo blackboardsh/electrobun`.

**Do not write a workaround for this.** Two sibling projects (`ThisIsFine`, `git-repo-scanner`) each
carry a 105-line `src/bun/titlebar-theme.ts` that `dlopen`s `dwmapi.dll` through `bun:ffi` and polls
the registry every 2 s via `Bun.spawn(["reg", "query", ...])`. Both are being deleted. If someone
suggests copying that pattern into OpenSlate, the answer is to bump the dependency instead.

Upstream's fix is **fully automatic — no API, no import, no opt-in.** `updateWindowTheme(hwnd)` in
`package/src/native/win/nativeWrapper.cpp` reads `AppsUseLightTheme` from the registry with
`RegGetValueW` and sets `DWMWA_USE_IMMERSIVE_DARK_MODE` (attr 20, falling back to 19 on Win10 1809),
called at window creation and on `WM_SETTINGCHANGE`. Constructing a `BrowserWindow` is enough.

Full write-up, including the lost `--dark`/`--light` override and an unrelated `backgroundColor`
trap: `~/git/Personal Projects/ThisIsFine/DARK_MODE_MIGRATION.md`.
