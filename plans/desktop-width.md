# Use the full width on desktop

## Goal

The web app is laid out for a phone. On a desktop browser everything sits in a
1100px column (`.app { max-width: min(1100px, 96vw) }`), and My ballot is one
long column of race cards (17,000px tall with a dozen San Francisco sources
followed). The user asked to make use of the full width on desktop (2026-10-21).

Mobile layout must stay as it is.

## Environment / context

- Worktree `C:\Users\camer\.t3\worktrees\OpenSlate\ui-desktop-width`, branch
  `ui/desktop-width`, from `master` at `28a5bcc`.
- All styling is in `apps/web/src/styles.css` (one file, ~2100 lines). Pages are
  in `apps/web/src/components/*Panel.tsx`; routes in `apps/web/src/router.tsx`.
- Dev server: `bun run dev -- --port 5288 --strictPort` in `apps/web`. Checked
  with the T3 preview at 1920, 1440, 1024 and phone widths.
- Checks: `bun run typecheck`, `bun test`, lint with
  `bunx biome check --config-path="$TEMP/biome-crlf" apps/web/src` (see
  `plans/custom-form-controls.md` Findings), `bun run build`.

## Decisions already made (don't re-ask)

- Lay out by content rather than just stretching the column: cards go into
  responsive grids, context goes into a sidebar, and paragraphs keep a readable
  line length.
- Phone layout unchanged, including the order things appear in.

## Plan / steps

1. [x] Shell: `.app` max-width `min(120rem, 96vw)` (was 1100px).
2. [x] My ballot: race cards in a grid (`.race-grid`, 32rem min: 3 columns
   at 1920, 2 at 1440, 1 at 1024 and on a phone). Closed sections sit side by
   side (`.ballot-sections`, from 40rem up); open ones span the row.
3. [x] Race page: `.race-layout` puts polls/forecast/results in an `aside`
   beside My positions and the choices from 70rem up.
4. [x] Sources: `.sources-layout`, what you have on the left (2fr), "Add
   sources" on the right (3fr); the catalog list goes to two columns.
5. [x] Results: imported-slate list in columns (`.slate-grid`).
6. [x] Prose: `main p { max-width: 80ch }`.
7. [x] Identities, Compose, Settings: `.card-columns`, two columns from 76rem.
   Compose: identity and picks left; other positions, Sign, result right.
8. [x] Copy that said "below" now names the section (it may be to the right).
9. [x] Verified at 1920 / 1440 / 1280 / 1024 / iPhone 12 Pro.
10. [x] Checks pass; committed. README has nothing on layout.

## Findings / gotchas

- The T3 preview tab stalls React rendering when it isn't visible: hash
  navigation changed the URL but the page didn't re-render, and screenshots
  were stale. Reopen the tab with `open: true` and reload.
- The setup wizard hung at "Loading endorsements… 173 of 197" in a fresh
  profile; logged in `ISSUES.md`, not part of this task. Load test data from
  Sources → Public catalog instead.
- Grids only kick in behind `@media screen and (min-width: ...)` where a
  phone would otherwise change: grid items don't collapse margins, so cards
  stacked in a one-column grid get double spacing. `.race-grid` is the
  exception: it zeroes card margins and uses `gap`, which matches exactly.
- Where a wide-screen sidebar sits between other things in DOM order (race
  page, Sources), `grid-template-areas` keeps the phone order. The last row is
  the only `1fr` row, so a tall sidebar grows that row instead of spreading
  the left-hand cards apart.
- `biome format --write` with the repo config writes LF; use
  `--config-path="$TEMP/biome-crlf"` to keep CRLF.

## Progress log

- [x] Surveyed every page at 1920px (2026-10-21).
- [x] Implemented and verified (2026-10-21). My ballot with 12 SF sources and
  no area set: 17,148px tall at 1100px wide before; 5,630px at 1920 and
  6,467px at 1440 after. Sources 13,127px to 9,178px at 1920.
- [x] typecheck, 225 tests, Biome (CRLF config), build all pass.
- [ ] Merge to `master`: waiting on the user.

## Open questions for the user

1. Merge `ui/desktop-width` into `master`? Recommended once you've looked at
   it on your screen (`bun run dev:web`, then My ballot, a race page, Sources).

## Things not to do

- Don't use CSS `columns` for the race cards: it reorders reading/tab order
  down each column, and the cards are a ballot in order.
- Don't change the phone layout or DOM order on narrow screens.
