# Light mode

## Goal

The web app (`apps/web`) supports a light theme as fully as the dark one. By default it
follows the OS (`prefers-color-scheme`). Settings has a System / Light / Dark override,
stored on the device only. The right background is painted from the very first frame,
whichever theme applies, so no white or black flash appears before the stylesheet or the
bundle loads.

## Environment / context

- Before this work the app was dark only: one `:root` palette in `apps/web/src/styles.css`,
  no `prefers-color-scheme` or `color-scheme`, PWA manifest colours `#0f1115`
  (`apps/web/vite.config.ts`).
- CSP (`apps/web/public/_headers`): `script-src 'self'` (no inline scripts),
  `style-src 'self' 'unsafe-inline'` (inline styles are fine).
- Device-local settings use `createLocalStore` (`src/lib/localStore.ts`), which stores
  values as JSON (a stored string looks like `"dark"`, quotes included). See
  `src/lib/basemap.ts` for the pattern.
- Form controls come from the React Aria kit in `src/components/ui` (no native inputs).
  Use `Segmented` for the theme picker.
- District map colours were validated with the dataviz skill against the dark surface
  (`plans/district-map-readability.md`). Light mode needs its own validated set.

## Decisions already made (don't re-ask)

- The installed app's splash matches the device by default (user, 2026-10-21): light base
  colours in the manifest, with `color_scheme_dark` for dark.
- Light mode is fully supported, and that includes critical CSS so the first load doesn't flash
  (user, 2026-10-21).
- The theme follows the OS by default, with a System / Light / Dark override in Settings
  (proposed and not objected to).
- **CSS does the work; JS only stamps an override.** The light palette sits on `:root`.
  The dark palette applies under `@media (prefers-color-scheme: dark)` on
  `:root:not([data-theme="light"])`, and again under `:root[data-theme="dark"]`. This is
  the dataviz reference pattern. With no JS at all, the System choice still works.
- **`light-dark()` is not used.** It needs Safari 17.5 / Chrome 123, and Vite 6 targets
  Safari 14 without transpiling CSS. In an unsupported browser, every colour would be
  invalid.
- The dark block is declared twice (once for the media query, once for the attribute).
  A test keeps the two copies identical.
- **The boot script is external: `public/theme.js`.** CSP blocks inline scripts. It is a
  classic, parser-blocking script early in `<head>`. It reads the stored override, sets
  `data-theme` on `<html>`, and points the `theme-color` metas at the chosen theme. The
  app's `src/lib/theme.ts` does the same at runtime. A test runs both and checks that
  they agree.
- The critical inline `<style>` in `index.html` sets only `color-scheme`, the background
  and the text colour for each theme. A test checks that its values match the tokens in
  `styles.css`.

## Plan / steps

1. Pick the light palette and check contrast (text tokens at least 4.5:1 on `--bg`,
   `--surface` and `--surface-2`).
2. Turn the theme-dependent hard-coded colours in `styles.css` into tokens: the lean
   stance colours, the JWS segment colours, map colours, the backdrop and shadows. Leave
   the colours that don't depend on the theme (white on accent, and the basemap overlays
   that depend on the tiles) as they are.
3. Validate the light map colours with the dataviz validator (`--pairs all`, light mode,
   light surface).
4. Add `public/theme.js`, plus the critical CSS, `color-scheme` and `theme-color` metas
   in `index.html`.
5. Add `src/lib/theme.ts` (store, `applyTheme`, sync) and the Appearance card in Settings.
6. Write tests: dark blocks identical, critical CSS matches the tokens, boot script and
   `applyTheme` agree, contrast floors.
7. Typecheck, lint, test and build. Look at both themes in a browser, including the first
   load with an override that differs from the OS.
8. Update the README if it mentions the theme.

## Findings / gotchas

- Light palette (`:root`, styles.css): bg `#f3f4f6`, surface `#ffffff`, surface-2
  `#f1f3f6`, text `#1b1f24`, muted `#596273`, accent `#0f62d6`, ok `#18794a`, bad
  `#c52a2a`, warn `#8a5a00`. Every text token clears 4.5:1 on bg and both surfaces;
  white on accent, ok and bad clears 5.4:1. Enforced by `test/theme.test.ts`.
- The dark theme already had gaps: `--bad` text 4.41:1 on surface and 4.02:1 on
  surface-2, and white on dark `--ok` 2.10:1. Not changed here (lightening `--bad`
  worsens the white-on-red fills). Logged in ISSUES.md; the test lists the two `--bad`
  pairs as known failures and fails if they get fixed without the list being updated.
- Light map colours: the dataviz light slots at full strength,
  `#eda100,#e87ba4,#008300,#6250d6`. Validator (`--mode light --surface #ffffff --pairs
  all`): all checks pass, worst CVD ΔE 16.2, worst normal-vision ΔE 19.6. Contrast WARN
  for yellow (2.17) and magenta (2.69), covered by the district labels. At 90% over white
  (the dark set's recipe) yellow falls out of the lightness band, so it's full strength.
- `::backdrop` doesn't inherit custom properties in older browsers (before Chrome 122 /
  Safari 17.4), so backdrops use `var(--backdrop, <dark fallback>)`.
- Verified in a browser, served with `wrangler dev` so the real CSP applied: `theme.js`
  loads; the HTML shell alone (main CSS and bundle stripped) paints the right background
  for all six OS × choice combinations; Light survives a reload on a dark OS; a change in
  another tab applies live; the district map reads well in light (Off and Streets); dark
  is unchanged.
- Vite leaves a non-module `<script src>` in `index.html` alone (and warns). Files in
  `public/` are served from the root, and the PWA precache picks up `theme.js` through
  `globPatterns` (`**/*.js`).
- PWA splash and title bar: the manifest's `color_scheme_dark` member (W3C manifest PR
  #1207, merged 2026-04-09) overrides `theme_color` / `background_color` when the OS is
  dark. WebKit shipped it in May 2026 (bug 311727). Chromium has committed to it (crbug
  383165202) but hasn't shipped, so Chrome installs show the light base colours for now.
  vite-plugin-pwa 1.3's `ManifestOptions` type doesn't know the member yet; it's passed
  through a spread and does reach `manifest.webmanifest`.
- Another thread's feedback dialog landed alongside this with dark-only `rgb(0 0 0 / …)`
  backdrop and shadow. Fixed in `7bb4661`, and the theme test now rejects any raw `rgb()`
  outside the theme blocks.

## Progress log

- [x] Light palette and contrast
- [x] Hard-coded colours tokenised
- [x] Map colours validated for light
- [x] Boot script, critical CSS, metas
- [x] theme.ts and the Settings card (Appearance, last card in Settings)
- [x] Tests (`test/theme.test.ts`)
- [x] Checks and build pass (bun test 249+, typecheck, Biome with a CRLF config per ISSUES.md). Verified in a browser
- [x] README (How to Run → Cloud)
- [x] Pushed to origin (`8704551`, user approved 2026-10-21)
- [x] Manifest splash follows the device (`color_scheme_dark`)
- [ ] Push the splash follow-up (waits on the user)

## Open questions for the user

None open.

## Things not to do

- Don't inline the boot script. CSP `script-src 'self'` blocks it (and adding a hash makes
  `_headers` drift on every edit).
- Don't use `light-dark()` without a CSS transpiler (see Decisions).
- Don't put the light map colours in without running the validator.
