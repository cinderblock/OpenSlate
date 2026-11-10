# National scale: every state in one app, then the world

`plans/national-scale.md`

## Goal

OpenSlate works for California only. Make it work for every US state from one
app at one origin, with a path to other countries, without a central server.
The slate format is already global (`us/ca/sf` is a path; `de/by/muenchen`
would be one too). What has to change is the app's California-only code, the
catalog's one-file download, the boundary data, and where the data comes from.

The user's words (2026-11-10): "how do we scale to the whole country… per-state
deployments, like ca.openslate.us? How could we scale to the world?", then
"get building. boil the ocean."

## Environment / context

- Repo: `C:\Users\camer\git\Personal Projects\OpenSlate` (shared tree, `master`,
  a push deploys openslate.us through Workers Builds).
- Sibling repos, same parent directory: `openslate-public-endorsements` (the
  catalog: `scripts/build-site.ts` writes `index.json` and `bundle.json`; it
  pins OpenSlate in `.openslate-version`), `openslate-ballot-ca-2026-11-03`
  (voter guide), `openslate-source-captures`, `openslate-forecasts`.
- Live catalog today: `https://cinderblock.github.io/openslate-public-endorsements/index.json`.
  Measured 2026-11-10: 413 entries, `bundle.json` 12,191,498 bytes, nearly all
  California. `catalog.openslate.us` answers 503 (its move is another thread's:
  `plans/catalog-domain-move.md`).
- Boundary data: `apps/web/public/geo/us-ca.topo.json`, 4.1 MB, built by
  `apps/web/scripts/build-geo.ts` from Census TIGERweb plus county sources.
- Checks: `bun test`, `bun run typecheck`, `bun run lint` at the repo root.

## Decisions already made (don't re-ask)

- **One app, one origin.** No per-state deployments. Browser storage is per
  origin, so `ca.openslate.us` and `ny.openslate.us` would split a voter's
  keys, picks and imports; federal races and national endorsers cross states
  anyway. A state subdomain may exist only as a redirect that presets the
  state (infrastructure, needs the user's yes; see open questions).
- **A region is a registry entry, not a deployment.** Everything the app knows
  about one state lives behind a `RegionProfile` (`apps/web/src/lib/regions/`).
  Generic facts (name, postal code, FIPS, chamber names and sizes) come from a
  table covering every state; California's special code (ballot order, the
  Secretary of State's count, county feeds, Courts of Appeal) is one profile's
  extras.
- **Signed data keeps its paths.** Existing slates say `us/ca/ad-11`,
  `us/ca/cd-11`; those stay valid forever. New states get family keys from the
  registry, documented in SPEC.
- **The catalog shards by region**, the first two path segments (`us/ca`), with
  `us` for national contests. The host learns a voter's state and nothing
  finer. A slate that speaks to several regions is in each one's shard; the
  app keeps each token once.
- **No central server** (standing project rule): shards and boundary files are
  static files.
- **District keys are the same in every state**: `cd` Congress, `sd` the upper
  chamber, `ad` where the lower one is an Assembly (CA, NV, NJ, NY, WI) and
  `hd` anywhere else, `ld` for Nebraska's one chamber. One rule a slate's
  author can remember beats per-state keys. What voters call them (Washington's
  "legislative district") is the label, not the key.
- **Shards are by election and region**, listed in `shards.json` beside the
  catalog's `index.json`, which stays as it is for older apps and small
  catalogs. A shard's files carry no date, so an unchanged shard keeps its
  revision and nobody re-downloads it.
- **California's Live results page stays California's** for now (`LivePanel`,
  `watch.ts`): it is built on the Secretary of State's contest ids. Other
  states get results through `counts.ts` and civicAPI until a second state's
  own count is read.

## Plan / steps

1. **Region registry and California behind it.** Done in the library
   (`2fa7d4f`, `0bd1d5e`); components' California wording is step 4.
   - `apps/web/src/lib/regions/`: `types.ts` (the profile), `usStates.ts`
     (every state from one table), `index.ts` (lookups), `us-ca/` (California:
     `data.ts`, `ballotOrder.ts`, `countyDrawings.ts`, `districtOverlaps.ts`,
     `sos.ts`, `sosResults.ts`, `sosCandidates.ts`, `countyResults.ts`,
     `counts.ts`, `links.ts`).
   - Seams the shared code asks through: `ballotOrder.ts` (`RULES`),
     `counts.ts` (`StateCounts`, `CountyCounts`), `researchLinks.ts`
     (`RegionLinks`). Adding a state is adding an entry to each it has.
   - Generic pieces pulled out: `liveCount.ts`, `nameOrder.ts`, `counties.ts`.
2. **Catalog shards.** Done and live. App (`a6074de`): core's
   `buildCatalogShards` / `shardsFor`, `catalogShards.ts` (loader with the
   whole-catalog fallback), `catalogScope.ts` + `catalogScopeKeeper.ts` (which
   regions this browser asks for), `CatalogRegions.tsx`. Catalog repo
   (`636cefa`): `build-site.ts` writes `shards.json` and the shard files,
   OpenSlate pinned at `d8f205d`. The page preloads `shards.json`.
   - `index.json` and `bundle.json` are still published whole, for older
     apps and for `scripts/snapshot-catalog.ts` (the desktop app's offline
     copy), which copies those two. Before the catalog grows past one state,
     the snapshot has to learn shards, and the whole files have to stop
     growing (keep them California-only, or drop them).
   - With no area set, the app loads every shard. Fine for one state; with
     many, setup has to ask for a state before the catalog loads (step 4).
3. **Boundaries for every state.** *(current)*
   Generalize `build-geo.ts` to any state from
   TIGER (congressional, both chambers, counties, places, school districts),
   plus a small national file of state outlines so a point finds its state
   before any state file loads. Decide where the files live (open question 1).
4. **State-aware UI.** Find my districts, the district map, setup, Results and
   All races work for any state with a profile: pick or detect the state,
   labels from the profile, sources (state count, county feeds) only where the
   profile has them, civicAPI elsewhere.
5. **SPEC.** Jurisdiction path conventions beyond one state and one country
   (ISO 3166 segments, district family keys, district ids that aren't
   numbers), and the sharded catalog.
6. **Federal coverage.** National organizations' House and Senate
   endorsements, and a nationwide federal ballot listing, in
   `openslate-public-endorsements`. Data work with human review before
   signing.
7. **A second state end to end.** Virginia or New Jersey, 2027-11-02
   (governor and legislature): listing, endorsers, results adapter. The test
   of whether step 1's interface holds.
8. **The world.** i18n (strings, RTL, dates), ballot types the app doesn't
   model (party lists, STV, two rounds), quiet-period rules, federated
   catalogs run by local groups.

## Findings / gotchas

- California-specific modules in the web app (2026-11-10): `sosCa.ts`,
  `sosResults.ts`, `sosCandidates.ts`, `countyCa.ts`, `ballotOrderCa.ts`,
  `ballotOrderCounties.ts`, `ballotOrder.ts` (the 58 counties, §13111/§13112),
  `ballotSequence.ts`, parts of `jurisdictions.ts` (`STATE_NAMES`,
  `DISTRICT_FAMILIES`, `DISTRICT_COUNTS`, `SEATS_UP`, `REFILED_COUNTIES`),
  `geo.ts` (`GEO_FILES`, `COURT_OF_APPEAL_BY_COUNTY`), `researchLinks.ts`
  (`isCalifornia`), `watch.ts` (`us/ca/${family}`), `FindDistricts.tsx`
  (`STATE = "us/ca"`), `LivePanel.tsx`, `DistrictMap.tsx`. In core:
  `countyResults.ts` (`CA_COUNTY_FEEDS`, Clarity and other parsers).
- `parseJurisdiction` reads a district only as `<letters>-<digits>`. Other
  states have lettered (`12A`, Minnesota, Maryland) and named (`1st
  Middlesex`, Massachusetts; New Hampshire; Vermont) legislative districts.
- Washington, Arizona, Idaho, New Jersey, the Dakotas and Maryland elect both
  chambers from the same "legislative districts"; Nebraska has one chamber.
- The catalog's `index.json` is itself about 600 KB for 413 entries: it has
  to shard with the bundle, not only the bundle.
- The four files `git status` shows modified in the shared tree
  (`Select.tsx`, three tests) have an empty `git diff`: line endings only, not
  anyone's work.
- Biome's `lineEnding: auto` means CRLF in the working tree on Windows: a
  file written with LF fails `biome check` as a whole-file format error. Run
  `biome check --write` on changed files before committing.
- Big inline shell heredocs break in this harness (an apostrophe is enough).
  Write scripts and JSON to the scratchpad with the Write tool and run them.
- `test/catalogWorker.test.ts` fails the build if the catalog worker's import
  graph reaches `query.ts`, `localStore.ts` or React: anything `catalogCopy.ts`
  or `catalogBundle.ts` needs at run time must live in a worker-safe module
  (`catalogShards.ts`). `test/browserData.test.ts` fails on a localStorage key
  that isn't listed in `browserData.ts`.
- The All races loader skips a re-check within 5 minutes of the last one, so
  a change of regions has to say so (`load(url, changed)`), or nothing loads.
- Measured on the live catalog, 2026-11-10: shard `2026-11-03 us/ca` 383
  entries, bundle 11.7 MB, index 555 KB; `2026-06-02 us/ca` 30 entries, 296 KB
  and 36 KB. The live `index.json` is 811 KB.
- Pinning OpenSlate 226 commits forward in the catalog repo changed no
  slate: signed locally with a throwaway key, all 413 payloads equal the
  published ones apart from signer and `issued_at`. `lean` changed on 19
  entries (core's `leanOf` moved on).
- `openslate sign --batch .` failed on Windows after signing everything:
  Bun's recursive `mkdir(".")` throws EEXIST. Fixed in `54b992e`; an absolute
  path works with an older pin.
- `packages/cli/test/races.test.ts` times out (5 s) when the machine is busy
  (another thread's rustc build, 2026-11-10); it passes alone on a quiet one.
- Local end-to-end harness, outside the repo:
  `%TEMP%\claude\…\scratchpad\e2e` (`mirror.ts` builds a sharded copy of
  the live catalog with core, `serve.ts` serves a build on :5741 and the
  mirror on :5742, `shards.e2e.ts` and `regions.e2e.ts` drive headless Chrome
  through playwright-core). Build with
  `VITE_PUBLIC_ENDORSEMENTS_CATALOG=http://localhost:5742/index.json bunx vite build --outDir <scratch>/e2e/dist`.
  The scratchpad doesn't outlast the session: rebuild it from this note.

## Progress log

- [x] 2026-11-10: survey of California-specific code; this plan.
- [x] Step 1: region registry, California behind it (`2fa7d4f`, `0bd1d5e`).
- [x] Step 2: catalog shards. App `a6074de`, catalog repo `636cefa`, both
  live 2026-11-10 about 12:50 PM PST (20:50Z). Checked in headless Chrome
  against a local sharded mirror, a whole catalog, and production: openslate.us
  asks for `shards.json` and the two `us/ca` shards (1.9 MB on the wire), a
  Texas voter is told the catalog has nothing for Texas and can add
  California. The shard revisions CI published equal the ones built locally
  from the live bundle (`64d0acca…`, `ff1ed7fc…`): the build is repeatable.
- [ ] Step 3: nationwide boundary data.
- [ ] Step 4: state-aware UI.
- [ ] Step 5: SPEC.
- [ ] Step 6: federal coverage.
- [ ] Step 7: a second state.
- [ ] Step 8: the world.

## Open questions for the user

1. Where do 50 states' boundary files live? About 1-5 MB each, so on the
   order of 100 MB. In this repo they bloat git history at every
   redistricting. My recommendation: a sibling repo `openslate-geo` that
   builds from TIGER in CI and publishes static files, fetched per state like
   the catalog. Until you answer, files build to a git-ignored directory and
   only California's stays committed.
2. State subdomains as redirects (`ca.openslate.us` → the app with California
   preset): want them? It's a Cloudflare change, so it waits for your yes.
3. `openslate.org` is for sale on Afternic. Worth pricing if the project goes
   past the US.

## Things not to do

- Don't deploy per state, and don't key browser storage by state.
- Don't rename paths inside signed slates (`us/ca/ad-11` stays).
- Don't fetch per-race or per-city catalog files: the host would learn what a
  voter looks at. A state is the finest grain.
- Don't touch Cloudflare, DNS or the ops repo from this work without a
  per-change yes.
