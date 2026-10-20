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
2. [ ] Kit foundation + `Switch` + `Checkbox`; convert their sites.  ← current
3. [ ] `RadioGroup`; convert.
4. [ ] `Select` + `ComboBox`; convert.
5. [ ] `TextField` / `SearchField` / `TextArea`; convert.
6. [ ] `TokenField` / `TokenBox`; convert paste and read-only token sites.
7. [ ] `FileDrop` / `FileTrigger` / `Slider`; convert.
8. [ ] Remove dead native-control CSS (`label.switch input`, global
   `select`/`textarea` rules, `.identity-radio` etc.); grep confirms zero bare
   native controls; full check; browser walkthrough of every converted screen.

## Findings / gotchas

- `bun run lint` fails on Windows checkouts (CRLF vs Biome's `lf` default;
  ISSUES.md). Workaround for this branch: a copy of `biome.json` with
  `"lineEnding": "crlf"` in `$TEMP/biome-crlf/`, run with `--config-path`.
  Baseline on `e07192b`: `apps/web/src` checks clean that way.
- Baseline: typecheck clean, 197 tests pass.

## Progress log

- [x] Survey: 53 native sites in 21 files (9 checkbox, 4 radio, 13 select,
  ~16 text/search/url, 9 textarea, 2 file, 1 range).
- [x] Worktree + dependency.

## Open questions for the user

(none yet)

## Things not to do

- Don't hand-roll ARIA for listbox/combobox; RAC does it.
- Don't add a second stylesheet or CSS-in-JS; the app styles live in
  `styles.css`.
- Don't break `/results/$token` or `/race/$key` links (from the two-modes plan).
