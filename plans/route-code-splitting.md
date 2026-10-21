# Route-level code splitting

## Goal

Load each page's code when the page is opened, instead of the whole app up
front. The app ships as one JS file (361 KB gzipped after the custom form
controls landed, up from 288 KB). First load on a phone should only fetch the
shell and the page being opened.

## Environment / context

- Worktree `C:\Users\camer\.t3\worktrees\OpenSlate\ui-custom-controls`, branch
  `perf/route-splitting`, from `master` at `71497bc`.
- Router: TanStack Router, code-based routes in `apps/web/src/router.tsx`,
  hash history. Root layout `App.tsx` renders the header, footer (usage
  Switch) and `WizardHost`.
- PWA: `vite-plugin-pwa` precaches `**/*.js`, so split chunks are still all
  cached for offline use; they're fetched after the first page is up.
- Checks: `bun run typecheck`, `bun test`, lint with
  `bunx biome check --config-path="$TEMP/biome-crlf" apps/web/src` (see
  `plans/custom-form-controls.md` Findings for why), `bun run build`.

## Decisions already made (don't re-ask)

- Do per-route splitting (user, 2026-10-20).
- Keep the drag-and-drop zone (user: "nah" to dropping it).
- Keep React Aria; accessibility is first class (user). Don't swap libraries
  to save bytes.

## Plan / steps

1. [x] Every route component via `lazyRouteComponent`; preload on link
   hover/focus (`defaultPreload: "intent"`). (`22ae05a`)
2. [x] Lazy-load the wizard body (`WizardHost.tsx` keeps the first-visit
   check). (`22ae05a`)
3. [x] Load `qrcode` / `jsqr` on first use (found while measuring: the `Qr`
   chunk was 58 KB gzipped). (`1832105`)
4. [x] Measured, checked offline precache, walked the routes (see Progress).
5. [x] Rebased onto `master` (the find-my-districts work had landed:
   `31d23a1`), re-checked (225 tests, shell still 196 KB, My ballot 274 KB with
   the district finder), merged and pushed on the user's yes, 2026-10-20
   (`4e9413f`). Live on `https://openslate.us` within a minute (entry
   `index-BKGXsM-r.js`, with the wizard as its own chunk).

## Findings / gotchas

- Measure with the production build (`vite build`, then `vite preview`); the
  dev server serves modules unbundled, so it says nothing about chunks.
- Sizes, gzipped (`vite build --manifest`, closure of each page's imports):

  | | before | after |
  | --- | --- | --- |
  | Shell (entry chunk) | 361 KB | 196 KB |
  | My ballot, cold | 361 KB | 260 KB |
  | Other pages, cold | 361 KB | 198–274 KB |
  | All JS (precached) | 361 KB | 387 KB in 40 files |

  The shell is mostly TanStack DB, React DOM, the router, zod and
  `@openslate/core`; the footer's usage Switch keeps React Aria's
  interaction/focus core in it too.
- `RacePanel` pulls in `SourcesPanel` and `ImportVerifyPanel` chunks (it
  reuses parts of them). Not worth untangling now; noted in case the race
  page needs to get lighter.

## Progress log

- [x] Fresh origin, production build: the landing page loads only its chunks;
  the wizard's chunk loads when it auto-opens on first visit; completed the
  wizard to My ballot.
- [x] Hovering the Sources tab fetched `SourcesPanel` before any click.
- [x] Cold loads: `/race/$key`, `/results/$token` (GrowSF June 2), legacy
  `/compose` → `/publish`. No errors.
- [x] Identities → Share QR: `qrcode`'s chunk loads only then; QR renders.
- [x] Service worker precache lists all 40 JS chunks.
- [x] Typecheck, 197 tests, lint (CRLF config), build.

## Open questions for the user

1. ~~Merge to `master` and push?~~ Done (`4e9413f`).

## Things not to do

- Don't break `/results/$token` or `/race/$key` links (shared outside the app).
- Don't swap or drop React Aria to save size.
