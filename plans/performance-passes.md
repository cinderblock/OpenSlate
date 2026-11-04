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
9. [ ] ← current, waiting on the user: next round, each its own job:
   - All races / race page with `?all`: collate in a worker.
   - Keep catalog-check progress across reloads (save verified tokens as
     they're checked, not only at the end).
   - The race page collates every slate to find one race (`useRaceTarget`).

## Progress log

- [x] Harness built; Governor race page profiled.
- [x] Steps 1-6 and the Sources fix committed; 1,198 tests, typecheck clean;
  local build smoke-checked on six pages with no page errors.

## Open questions for the user

1. Go ahead with the next round (step 9)? Recommended order: collate in a
   worker (All races and `?all` race pages, the largest freeze left), then
   keeping catalog-check progress across reloads.

## Things not to do

- Don't measure with the dev server: it says nothing about the shipped code.
- Don't migrate to zod 4 for speed: ~100 ms on a desktop, and CSP likely
  disables the part that makes it fast.
- Don't trust one throttled wall-clock run on this machine: other threads
  load it heavily.
