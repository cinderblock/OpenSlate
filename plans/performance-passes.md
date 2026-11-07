# Performance passes

## Goal

Pages feel slow since the Results page's loading fix: the user opened the
Governor race page and waited about 5 s for anything to change (2026-11-04,
about 2:50 PM PST). Find what the main thread and network spend that time on,
page by page, and cut it, measuring before and after.

## Environment / context

- Timing harness (outside the repo): `%TEMP%\os-perf\measure.ts` (headless
  Chrome via `playwright-core`, 402 px; records content changes, long tasks,
  requests; `--warm` reloads after a first visit, `--cpu=N` throttles,
  `--profile=x.json` writes a CPU profile) and `top.ts` (self/inclusive time
  per function from a profile).
- Profile against an unminified local build so names are readable:
  `bunx vite build --minify false --outDir %TEMP%/os-perf/dist`, then
  `bunx vite preview --outDir … --port 5639 --strictPort` (4791 was taken by
  something else on this machine).
- The relay is not the bottleneck: `/api/recorder` at 2:52 PM PST (22:52Z)
  showed every recorder checking every 2 minutes, no sockets open.

## Findings / gotchas

- Race page, warm, no slates loaded (fresh profile): one 1.6 s long task right
  after first render. 1.4 s of it is the ballot-order sort inside
  `collateRaces` (`allSlates.ts` `lineUp`): `compareBallotOrder` →
  `ballotPart` → `isCountyPath` → `countyOfPath`, which slugifies all 58
  county names (`localityPathFor`, an NFD normalize and four regexes each) on
  every comparison.
- The race page collates every race in every slate just to show one.
- The user's URL guess `#/race/2026-11-03/us/ca/governor` is not a page; the
  real slug is `governor-of-california` (from All races' links). Not a bug.
- Cold Governor page at 4x CPU throttle (`?all=true`), full content:
  production before these passes 45 s (34 s of long tasks); local build after
  steps 1-5, 15.7 s (7.5 s of long tasks). Throttled wall-clock is noisy on
  this machine (other threads' work): compare runs back to back, and compare
  per-function time from profiles.
- Where the cold time went (4x): signature checks of the catalog's ~349
  slates, about 7 s, of it noble's pure-JS Ed25519 2.6-3.9 s and zod's payload
  parse 1.2-2 s; base64url decoding via `@scure/base` 2.5 s (fixed); React
  re-rendering the whole race page on every 12 ms progress report, 3.5-5.5 s
  (fixed); collating the whole catalog 1.4 s.
- Ed25519 in Bun: noble 2.5 ms a verify, WebCrypto 0.19 ms sequential, 0.04 ms
  with many in flight. In headless Chrome after step 6, noble's share of a
  cold race page fell from 2.6-3.9 s to 0.28 s (4x); what's left of signature
  checking is zod's payload parse and token decoding.
- zod 4 (`zod/v4`, shipped inside our zod 3.25) on the 413 catalog payloads in
  Bun: 122 ms against v3's 229 ms once warm, identical results. Its speed is
  generated code (`new Function`), which our CSP likely forbids, so in the
  browser it would be less. Not worth a migration for ~100 ms on a desktop.
- Workers Builds has now twice not deployed a pushed commit (`583403f`,
  `ac83b90`); each time an empty commit deployed fine. The build log is in
  the Cloudflare dashboard, which this thread doesn't touch.
- Machine load: Processor Time was 77-88% from other work during these runs.
- Warm sweep, 4x, production vs local (before the Sources fix): All races
  ~10 s of long tasks either way; Sources 17.5 s (one 5.7 s); Results 7.8 s
  vs 2.4 s; Compare 3.2 s vs 1.8 s; My ballot about equal.
- "Warm" needs a long first visit (`--first=40000`): at 4x the catalog check
  can take longer than 12 s, and nothing is kept until it finishes, so a
  reload starts it over. A phone visitor who reloads mid-check loses it all.
- Sources, truly warm: four whole-list renders of 3-9 s each (400 rows of
  React Aria toggles). After `e24ec10`: 3.8 s total, longest 0.48 s.
- All races, truly warm: `lineUp` (collating every catalog race) 3.4 s at 4x
  in one task; `collateRaces`' self time is spread over ~30k positions, no
  single hotspot. Moving it to a worker is the fix (ISSUES.md, "The catalog
  copy verifies on the page, and workers would halve the wait").
- My ballot's collation in a worker is no win (measured 2026-11-06,
  heavy profile, 4x): posting the slates cost 0.37 s on the page (0.29 s
  even without their tokens), the reply 0.13 s plus ~0.3 s reading it
  back, against 0.87 s for collating on the page. All races gains because
  its worker already holds the catalog; My ballot's slates are on the page.
- The machine's speed drifts a lot between sessions (Publish, untouched,
  0.7 s one day and 1.2-2.1 s the next): compare builds with `ab.sh`
  (`serve.ts` serves the build named in `which-dist.txt` on :5639, so both
  share the heavy profile's origin and data), never against old numbers.
- A kept browser profile's service worker serves the build it cached:
  `serviceWorkers: "block"` doesn't stop it in a persistent context. Delete
  `<profile>\Default\Service Worker` before measuring a new build with it.
- Sources' 9 entries that never count as imported are a bug, not speed
  (ISSUES.md); the heavy setup waits for the "Imported N" summary instead.
- Copying the worker's reply is not free: with the slates in it, 0.5-0.57 s
  at 4x, about half of what the worker saved. Sending articles and search
  text instead of slates brought it to 0.25-0.3 s.
- A worker can't load anything that touches React, the database or
  localStorage, even indirectly; `test/lineUp.test.ts` walks the worker's
  runtime imports and fails on any of them.
- `--block=<substring>` on `measure.ts` aborts matching requests (and
  blocks the service worker), so the same build can be measured with the
  worker failing over to the page.
- The harness's own per-frame `textContent` read (`check :9` in profiles)
  costs real time on big pages; ignore it in profiles.

## Plan / steps

1. [x] `countyOfPath`: a table built once (`75318d5`).
2. [x] base64url from a table, not `@scure/base` (`ce86a5a`).
3. [x] Ballot order keys worked out once per sort (`f93a78e`).
4. [x] Progress reports a few times a second (`db496c5`).
5. [x] Race slugs cached (`522791c`).
6. [x] Signatures through WebCrypto's Ed25519 where the browser has it, with
   noble deciding anything WebCrypto doesn't accept (so the outcome is always
   noble's) (`68615b0`, `837b04d`).
7. [x] Swept My ballot, All races, Compare, Results, Sources, race page.
   Sources fixed (`e24ec10`).
8. [x] Pushed and live. Workers Builds failed on `583403f`, though the same
   commit built cleanly on Windows and Linux (Bun 1.4.2, frozen lockfile);
   the empty commit `3a800cc` redeployed it (entry `index-Ch5w33CZ.js`).
   Live Governor page at 4x: cold full content 45 s -> 11.4 s (long tasks
   34 s -> 8.5 s); warm 3.4 s (long tasks 3.0 s).
9. [x] Second round (the user's go-ahead, 2026-11-06):
   - [x] Catalog-check progress kept across reloads (`bb91644`): the slates
     checked so far go to `openslate.catalogChecked.v1` every 2 s and are
     read back by the next check; cleared once the whole copy is kept.
     Headless at 6x: reloaded at 225/413, resumed at 129 (121 kept).
   - [x] All races / `?all` race pages collate in a worker (`56da124` splits
     out what a worker can load, `ff10ab8` adds `lineUp.worker.ts`). The
     reply carries races, search text and articles, not slates. All races
     at 4x, warm, against the same build with the worker blocked: long
     tasks 3.3-4.4 s -> 1.8-2.3 s, longest 1.8-2.3 s -> 0.5 s.
   - [x] Live 2026-11-06 as `5ae18d4` (entry `index-DxKPG0dK.js`): Workers
     Builds again didn't deploy the pushed commit (`ac83b90`; 20 min later
     the site still served `9d02be1`), and an empty commit fixed it again.
     Live All races at 4x, warm: long tasks 3.0-3.6 s -> 2.5 s, longest
     1.25-1.33 s -> 0.6-0.78 s. Search and the `?all` race page checked.
10. [ ] <- current. Third round, "fix all performance issues" (the user,
   2026-11-06). Live sweep before it, every page at 4x (cold = fresh
   profile; warm = after a 40 s first visit), last content change / long
   tasks / longest:
   - My ballot: cold 2.3 s / 1.7 s / 0.56 s; warm 0.9 s / 0.44 s / 0.19 s
   - All races: cold 6.9 s / 4.4 s / 0.48 s; warm 1.7 s / 1.3 s / 0.31 s
   - Compare: cold 1.6 s / 1.1 s / 0.38 s; warm 0.6 s / 0.25 s
   - Results: cold 1.3 s / 1.7 s / 0.5 s; warm 0.4 s / 0.3 s
   - Sources: cold 5.9 s / 2.7 s / 0.37 s; warm 6.4 s / 1.7 s / 0.26 s
   - Governor race: cold 3.9 s / 2.8 s / 0.97 s; warm 0.4 s / 0.06 s
   - Governor `?all`: cold 10.9 s / 8.1 s / 0.73 s; warm 2.1 s / 1.2 s / 0.54 s
   - Publish: cold 2.4 s / 2.5 s / 1.19 s; warm 1.2 s / 1.3 s / 0.67 s
   - Settings: cold 1.4 s / 1.9 s / 0.78 s; warm 0.5 s / 0.44 s
   Work:
   - [x] The race page lists race keys straight from positions and collates
     only its own race (`collateRaces` `only`), not every imported race.
   - [x] The whole catalog job in a worker (`catalog.worker.ts`): bundle
     download and parse, signature checks, the IndexedDB copy, lining up.
     The page gets progress and races only; the catalog's list and single
     slates are asked of the page's query cache. Falls back to the page
     (`catalogService.ts`) where a worker can't start.
   - [x] Storage that throws outright (no IndexedDB) no longer breaks the
     loader (found by the worker test, where Bun has no IndexedDB).
   - [x] Query cache written at most once a second (`5271df2`): it was
     rewritten whole (660 KB) on every query change, 0.56 s at 4x.
   - [x] TextArea sizes itself with `field-sizing: content` (`54d808e`):
     the script forced a whole-page layout per box. Publish's longest task
     1.2 s -> 0.5 s.
   - [x] Sources: source ids worked out once per catalog (`17b2d72`).
   - [x] Voter guides verified through WebCrypto (`0e87747`).
   - [x] A voter with the whole catalog imported (383 slates; profile built
     by `%TEMP%\os-perf\heavy-setup.ts`, measured with `--user-dir`):
     - "Import the other N" through the background queue (`46725bc`): over
       10 minutes on a desktop, now 8 s.
       - Every page's layout and CatalogUpdater decoded all imported slates
       at once with noble: 6-15 s on every page at 4x. Now sliced and kept
       in IndexedDB for the next visit (`a2eca8d`, `bc9a3c6`). That commit
       also fixes `decodeSlatesInSlices` never yielding once every slate
       was checked ahead.
     - Sources renders its lists a few dozen rows at a time, the closed one
       only when opened (`151c159`): 7 s -> 1.2 s.
     - Heavy profile at 4x, longest task, before -> after: My ballot 14.1 s
       -> 3.2 s; All races 8.0 s -> 0.6 s; Compare 11.2 s -> 1.4 s; Results
       6.8 s -> 1.0 s; Sources 15.5 s -> 1.2 s; Governor 7.8 s -> 0.7 s;
       Publish 7.5 s -> 0.7 s; Settings 6.7 s -> 0.4 s.
   - [x] Live as `e1d252a` (entry `index-CgSu63-A.js`; deployed first
     time). Live sweep at 4x, before -> after, full content / long tasks:
     - All races cold 6.9 s / 4.4 s -> 3.5 s / 2.3 s; warm 1.7 / 1.3 -> 1.2 / 0.9
     - Governor `?all` cold 10.9 s / 8.1 s -> 3.5 s / 2.1 s; warm 2.1 / 1.2 -> 1.4 / 0.7
     - Governor cold 3.9 s / 2.8 s -> 2.1 s / 1.4 s
     - Publish cold 2.4 s / 2.5 s (longest 1.19 s) -> 1.2 s / 1.4 s (0.47 s)
     - Results cold 1.3 / 1.7 -> 1.0 / 1.2; Compare cold 1.6 / 1.1 -> 1.3 / 0.9
     - My ballot, Sources, Settings: about the same for a fresh profile
       (their wins are for a voter with many slates, measured locally above).
11. [x] Fourth round: the user's go-ahead 2026-11-06 ("anything
   to make it feel snappier"). Heavy profile, local build, 4x, My ballot:
   one 2.9 s task. Of it: React rendering the open race cards' controls
   ~1.5 s (React Aria Select/Button/TextField/GridList; 2580 elements),
   collation 0.62 s, translateSlates 0.2 s, refile 0.25 s, IndexedDB
   reads/writes ~0.6 s in other tasks. Work:
   - [x] Race cards render three at a time per open section; less work per
     visit: `listedJurisdictions` in place of a second collation, search
     text only while searching, `parseJurisdiction` and name sort parts
     remembered per string, `refiledRows` stops early (`9459837`).
   - [x] Collation itself 2-4x faster (`1b4f5d8`; benchmark
     `%TEMP%\os-perf\bench-collate.ts` over the public catalog, warm,
     desktop): everywhere 91 -> 45 ms, one area 72 -> 18 ms,
     `listedJurisdictions` 40 -> 9 ms.
   - [x] Collation in a worker: built, measured, dropped (see Findings).
   - [x] A/B against `1833ac8` on one origin, same moment (`ab.sh`), heavy
     profile, 4x: My ballot's biggest task 3.8-4.5 s -> 2.4-2.6 s, long
     tasks 7.2-8.2 s -> 5.9-6.9 s. All races, Governor, Publish: no change
     beyond noise.
   - [x] Live as `dbc8f83` 2026-11-06 10:30 PM PST (06:30Z), entry
     `index-c1GV8byS.js` (Workers Builds names it differently from a local
     build; checked by content). Cold live check, no page errors: My
     ballot, All races 3.2 s, Governor 2.2 s, Sources.
   Left: the first collation after a page load is ~2.5x a warm one (243 ms
   vs ~95 ms on a desktop): JIT and the new per-string caches filling. The
   rest of My ballot's biggest task is React building ~1,300 elements.
   Was:
   - My ballot with hundreds imported: 3.2 s at 4x in one task, spread
     over collating (two `collateRaces` over every slate, 0.7 s), React
     Aria controls and the race cards. Collating in a worker, as All races
     does, is the next step.
   - The main bundle is 786 KB minified; TanStack DB (172 KB) and React
     DOM (131 KB) are most of it and every page needs both at start.

12. [ ] <- current. Fifth round ("any other performance improvements you
   can find?", 2026-11-06). Cold sweep of a local build, fresh profile, 4x:
   Sources 10.0 s to its last change (5.1 s long tasks), All races 5.5 s,
   Publish/Settings 2.4-2.8 s of long tasks spread thin over start-up.
   - [x] Long lists render more as they're scrolled to (`6ae20cc`):
     Sources cold 10.0 -> 3.2 s, long tasks 5.1 -> 3.2 s. The observer's
     root reaches far above the screen, since a jump past the end crosses
     nothing smaller (found with `%TEMP%\os-perf\scroll-grow.ts`).
   - [x] The catalog index preloaded with the page (`1e7a9a2`): it went
     out 1.5-3.4 s into a first visit; now ~0.1 s, one request per page.
   - [x] Start-up: the main bundle is framework code (TanStack DB 172 KB,
     React DOM 131 KB, router 60 KB, zod 56 KB); nothing worth splitting.
   - [x] A worker pool for the catalog check (the user's yes, 2026-11-07):
     built, measured, dropped; ISSUES.md entry closed. Bun, the public
     catalog (413 slates), 12 cores: one thread first 516 ms / best 302 ms;
     pool of 4 first 569 ms / best 221 ms. A visit checks once per catalog
     version, so the first run is the one that counts, and there the pool
     loses: each worker loads and warms up zod and the core itself. The
     browser's own Ed25519 already runs off the JS thread; the issue's
     4.3 s -> 1.5 s was measured with noble, before that. Checking more at
     once on one thread (8 -> 64 -> all 413 in flight): 395 -> 315-358 ->
     296-366 ms, within noise. The code is kept outside the repo, in the
     session scratchpad `verify-pool/`, should phones without WebCrypto
     Ed25519 ever matter.
   - [x] Live as `572b7e3` 2026-11-06 11:27 PM PST (07:27Z); the preload
     is in the live page and the index arrives at ~0.15 s. Live cold, no
     page errors or console warnings: Sources 6.8 -> 3.3 s. My ballot
     ranged 1.8-3.8 s of long tasks run to run; the same build with and
     without the preload, alternated locally, showed no difference.

## Progress log

- [x] Harness built; Governor race page profiled.
- [x] Steps 1-6 and the Sources fix committed; 1,198 tests, typecheck clean;
  local build smoke-checked on six pages with no page errors.

## Open questions for the user

1. (Answered 2026-11-06: yes, "anything to make it feel snappier". The
   worker was measured and dropped; collation was made faster instead.)

## Things not to do

- Don't measure with the dev server: it says nothing about the shipped code.
- Don't migrate to zod 4 for speed: ~100 ms on a desktop, and CSP likely
  disables the part that makes it fast.
- Don't trust one throttled wall-clock run on this machine: other threads
  load it heavily.
