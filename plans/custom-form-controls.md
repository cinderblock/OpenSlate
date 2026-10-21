# Custom form controls (no native inputs)

## Goal

Replace every native form control in the web app (`<input>`, `<select>`,
`<textarea>`, checkboxes, radios, file pickers, range sliders) with our own
components. Native controls are almost always worse here: checkboxes and radios
barely show which option is chosen, `<select>` can only show one line of plain
text per option, and text inputs can't carry formatting. Our own controls can
highlight the chosen option clearly, show rich dropdown items (descriptions,
badges, groups, search), and format what's typed (e.g. colour the segments of a
pasted slate block).

The rule going forward: **no bare native form controls in `apps/web`**. Use or
extend the kit in `apps/web/src/components/ui/`.

## Environment / context

- Worktree: `C:\Users\camer\.t3\worktrees\OpenSlate\ui-custom-controls`, branch
  `ui/custom-controls`, started from local `master` at `e07192b`.
- Web app: React 18.3 + Vite 6 + TanStack Router, plain CSS in
  `apps/web/src/styles.css` (dark theme, tokens `--bg --surface --surface-2
  --border --text --muted --accent --ok --bad --warn`).
- Foundation: `react-aria-components` 1.22 (unstyled; we write all the CSS).
  It renders a visually hidden native `<input>` inside Checkbox/Switch/Radio and
  a real `<input>`/`<textarea>` inside TextField. That's fine: the rule is about
  what the user sees and how it behaves, not about the DOM underneath.
- Checks: `bun run typecheck`, `bun test` (197 tests, lib-level only),
  lint with the CRLF config copy (see Findings):
  `bunx biome check --config-path="$TEMP/biome-crlf" apps/web/src`.
- Dev server: `bun run dev:web` (Vite).

## Decisions already made (don't re-ask)

- **Build on React Aria Components** (user, 2026-10-20). Gets keyboard,
  focus, screen-reader and typeahead behaviour right for listbox/combobox/radio;
  we own every pixel.
- **Full sweep now** (user, 2026-10-20): build the kit, then convert all ~50
  native sites, one commit per component family.
- Kit lives in `apps/web/src/components/ui/`, one file per family, styles in a
  `ui` section of `styles.css` (the app has one stylesheet; keep it that way).

## Kit

| Component | RAC base | Used for |
| --- | --- | --- |
| `Switch` | `Switch` | on/off settings: usage stats, follow a source, show past, Live, include notes, include unfollowed |
| `Checkbox` | `Checkbox` | including an item in a set: Compose picks, wizard sources (card variant) |
| `RadioGroup` / `Radio` | `RadioGroup`, `Radio` | one-of: active identity, wizard election, wizard kind (card variant) |
| `Select` | `Select` + `Popover` + `ListBox` | small fixed lists with rich items: election (date + count + past badge), stance (coloured), signing identity (name + key), sort, map format, district |
| `ComboBox` | `ComboBox` | searchable long lists: Compose subject picker |
| `TextField` | `TextField` + `Input` | single-line text; label, description, error, prefix/suffix, `quiet` inline-edit variant |
| `SearchField` | `SearchField` | filter boxes with icon and built-in clear button |
| `TextArea` | `TextField` + `TextArea` | multi-line text, auto-grows |
| `TokenField` | `TextField` + `TextArea` + mirror | pasted slate blocks, JWS segments coloured as you type |
| `TokenBox` | (none, read-only display) | showing a signed block / raw QR text with a copy button, replacing read-only textareas |
| `FileDrop` / `FileTrigger` | `DropZone`, `FileTrigger` | import slate from file (drop or browse); QR image scan |
| `Slider` | `Slider` | results timeline scrubber |

## Plan / steps

1. [x] Plan doc; add `react-aria-components`; record the rule in README.
2. [x] Kit foundation + `Switch` + `Checkbox`; convert their sites. (`2047908`)
3. [x] `RadioGroup`; convert. (`c1cf284`)
4. [x] `Select` + `ComboBox` + `Segmented`; convert. (`c492e27`)
5. [x] `TextField` / `SearchField` / `UrlField` / `TextArea`, plus
   `PublicKeyField`; convert. (`f91d8d7`)
6. [x] `TokenField` / `TokenBox`; convert paste and read-only token sites. (`fe2f7eb`)
7. [x] `FileDrop` / `FileTrigger` / `Slider`; convert. (`4291ea2`)
8. [x] Dead native-control CSS removed, React Aria locales trimmed to en-US
   (`c25e0bd`); grep finds no `<input>`/`<select>`/`<textarea>` outside the
   kit's comments; typecheck, 197 tests, lint (CRLF config) and `vite build`
   pass; browser walkthrough done (see Progress).
9. [x] Merged to `master` (fast-forward to `eead22d`) and pushed on the
   user's yes, 2026-10-20. Live on `https://openslate.us` within a minute
   (bundle `index-DBE_SJkp.js`).

## Findings / gotchas

- `bun run lint` fails on Windows checkouts (CRLF vs Biome's `lf` default;
  ISSUES.md). Workaround for this branch: a copy of `biome.json` with
  `"lineEnding": "crlf"` in `$TEMP/biome-crlf/`, run with `--config-path`.
  Baseline on `e07192b`: `apps/web/src` checks clean that way.
- Baseline: typecheck clean, 197 tests pass.
- **RAC ComboBox: pass `defaultItems`, not `items`.** `items` means "already
  filtered by you"; with it, typing filtered nothing (all 265 subjects stayed
  listed). `defaultItems` lets RAC apply `defaultFilter`.
- RAC Select's `selectedKey`/`onSelectionChange` are deprecated in 1.22; use
  `value`/`onChange`.
- Browser automation: clicking `role=switch`/`role=checkbox` times out, because
  the real `<input>` is visually hidden. Click the label text (what a user
  clicks) or focus the input and press Space.
- RAC Popover portals to `document.body`. Inside a modal `<dialog>` (Wizard,
  QR dialog: both use `showModal()`) it would sit under the top layer. No
  Select/ComboBox is inside a dialog today; if one is added, wrap the dialog
  content in `UNSAFE_PortalProvider` (from `react-aria`, which would need adding
  as a direct dependency) pointing at the dialog.
- Edit scripts: open files with `encoding="utf-8"`; Windows Python defaults to
  cp1252 and choked on `Wizard.tsx`.
- **Vite's watcher can miss the second of two quick writes to a file** (an edit
  script that replaces JSX, then adds the import): the dev server kept serving
  the first version and the page crashed with "TokenField is not defined"
  while `tsc` passed. `touch` the files after scripted edits.
- RAC `SliderFill` sets `height: 100%` inline and `SliderThumb` centres itself
  with an inline `transform`. Draw the 4px fill bar as a background gradient,
  and use `scale:` (not `transform:`) for the thumb's hover growth.
- TokenField works by stacking a transparent textarea on a coloured mirror;
  both need identical font metrics, so the font is set explicitly on both
  (checked: same height, 2742px, for a 20 KB block).
- Drag-and-drop can't be fully tested with synthetic events: `dragover`
  lights the zone (`data-drop-target`), but the drop gets no file because the
  browser never fills a synthetic `DataTransfer`. Opening by button works.
- **Bundle size:** main JS gzip 288 KB on `e07192b` → 386 KB with RAC →
  361 KB after `@react-aria/optimize-locales-plugin` (en-US only). The rest is
  React Aria's core (interactions 24 KB, utils 25, selection 19, overlays 18,
  collections 15, focus 10 raw), not optional extras. The app ships as one
  chunk; route-level code splitting would be the lever if it matters.
  Raw sizes of React Aria's parts in the build: interactions 24 KB, utils 25,
  selection + collections 45, overlays 18, focus 10, dnd 9, the components and
  react-stately ~65. Shared, so further components cost a few KB each.

## Progress log

- [x] Survey: 53 native sites in 21 files (9 checkbox, 4 radio, 13 select,
  ~16 text/search/url, 9 textarea, 2 file, 1 range).
- [x] Worktree + dependency.
- [x] Switch/Checkbox, RadioGroup, Select/ComboBox/Segmented built, converted and
  checked in the browser (wizard, My ballot, districts, Identities, Compose,
  Sources).
- [x] Text fields: key field (prefix, tick, error), URL error, search clear,
  textarea growth checked in the browser.
- [x] Token field colours and alignment, TokenBox in Compose and the QR dialog,
  file open on Import & verify (verified VALID), slider (click + arrow keys,
  mounted standalone: no results timeline has data before Nov 3), mobile
  width on Compose.
- [ ] A real file drag onto Import & verify (needs a human; see Findings).
- [x] Region sort on real results (GrowSF's June 2 slate, 58 counties):
  "Name (A–Z)" and "Closest margin" reorder the table. Found and fixed a
  lingering browser outline on the trigger after a mouse pick.
- [ ] Results timeline slider on real data: not possible yet. civicAPI keeps
  no history for the June 2 races ("No tracked history for this race"), so
  the timeline only appears once Nov 3 results come in. The slider itself
  was checked standalone.

## Open questions for the user

1. ~~Merge and push?~~ Done 2026-10-20 (`eead22d`).
2. **Bundle size** (+73 KB gzipped, see Findings; the user asked why, and was
   told it is React Aria's shared core, see the table in Findings): accept
   it, or follow up with route-level code splitting? Recommendation: accept;
   code splitting as a separate task if load time on phones matters.
3. Another thread is on `feat/find-my-districts`. It touches
   `apps/web/package.json`, `bun.lock` and `vite.config.ts` too (small merge),
   and will probably add district/location UI: it should use the kit, not
   native inputs.

## Things not to do

- Don't hand-roll ARIA for listbox/combobox; RAC does it.
- Don't add a second stylesheet or CSS-in-JS; the app styles live in
  `styles.css`.
- Don't break `/results/$token` or `/race/$key` links (from the two-modes plan).
