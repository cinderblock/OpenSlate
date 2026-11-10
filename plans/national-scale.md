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
   - With no area set, the app loads every shard while the catalog has at
     most 3 states (`MAX_UNASKED_STATES`); past that, only what the whole
     country votes on, until a state is known. Setup asks for its draft
     area's state before the area is confirmed.
3. **Boundaries for every state.** *(current)* Code done; where the files
   are served from waits on open question 1.
   - `bun run geo --state <code>|all [--out <dir>]` builds any state from
     TIGERweb (`167acf6`): district ids as core's `districts.ts` spells them,
     "not defined" areas dropped, an empty layer for a chamber a state lacks,
     counties' own names, Alaska west of -180 (`metadata.wrap`), `index.json`
     and the states' outlines (`us.topo.json`).
   - `bun run geo:regions [--from <dir>] [--files <dir>|all]` writes
     `src/lib/regions/usDistricts.gen.ts` from the state files: each chamber's
     count, or every district where they're lettered or named, and which
     states the app ships a file for (those in `public/geo`, or `all`).
   - `geo.ts` reads `VITE_GEO_BASE` (a URL ending in `/`) for where the files
     are; default `geo/` beside the app.
   - All 56 built to the scratchpad on 2026-11-10; sizes in Findings. Only
     California's file is in `public/geo`, so only California has a map and
     "Use my location" in production.
4. **State-aware UI.** Mostly done.
   - Done: Find your districts in any state (`FindDistricts.tsx`: the Census
     address lookup works everywhere with no boundary file; the map and "Use
     my location" where the app has the state's file, found through the
     outlines), the map's labels by state (`layerWords`), choosing by hand
     with a state chooser and that state's districts (`AreaPicker.tsx`), one
     state per area (`inOneState`, `mergeFoundArea`), the catalog's states on
     All races and the catalog browser (`CatalogRegions.tsx`).
   - Not done: the Live page for another state (it is built on California's
     contest ids), and a county subdivision layer for the states where towns
     aren't incorporated places (Findings).
   - Checked in headless Chrome, 2026-11-10: with every state's file (a
     Vermont address, Vermont's map and a click on it, "Use my location" in
     Anchorage and on Attu east of the 180th meridian, Minnesota by hand) and
     as shipped, with California's only (San Francisco by location, the
     California map unchanged, Texas by location told to use an address, a
     Vermont address working with no Vermont map).
5. **SPEC.** Done: §3.3 spells out `jurisdiction` paths (ISO 3166 segments,
   the US district family keys, lettered and named ids). The sharded catalog
   is in the README, with the rest of the catalog's format.
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
- What the Census calls districts (TIGERweb `BASENAME`, probed 2026-11-10):
  numbers nearly everywhere, zero-padded in places (New Hampshire's Senate
  `02`, New Jersey's Assembly `05`); letters for Alaska's Senate (`A`-`T`);
  number and letter for Minnesota's House (`35A`) and Maryland's delegate
  subdistricts (`38C`, mixed with plain numbers); names for both chambers in
  Massachusetts (`Third Middlesex`, `19th Suffolk`) and Vermont (`Addison`,
  `Orleans-3`) and for New Hampshire's House (`Hillsborough 10`). One-seat
  states have `Congressional District (at Large)`. Water is `… not defined`
  (GEOID ending `ZZ`): New Hampshire, Louisiana, Puerto Rico and others have
  one. Nebraska and DC have no lower layer; DC's upper layer is its 8 wards.
- The address relay (`apps/poll-cache/src/geocode.ts`) dropped every district
  that wasn't a plain number, so a Vermont address came back with none and an
  at-large state with no congressional district. Fixed in `167acf6`.
- Boundary files, all 56 built 2026-11-10 at the same simplification as
  California's: see the size line in the progress log. Each is the raw JSON
  size; Cloudflare serves them brotli-compressed, about a quarter of that.
- In twelve states (New England, NJ, NY, PA, MI, MN, WI) most people live in
  a town or township that the Census calls a county subdivision, not an
  incorporated place. The boundary files have places only, so a lookup there
  finds the county and no town. TIGERweb layer 22 has them. Not built yet.
- The by-hand picker listed every district family any imported race used.
  With a national group's slate imported that would be 50 states' Congress
  pickers: it shows one state's at a time now.
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
- [ ] Step 3: nationwide boundary data. Build and app code done; files not
  served yet (open question 1). **Sizes, all 56, built 2026-11-10 about
  1:20 PM PST (21:20Z):** 59.7 MB of JSON, 21.8 MB gzipped. Largest: Texas
  4.8 MB, California 4.1 MB (with its council and supervisorial maps),
  Illinois 3.0 MB, North Carolina 2.5 MB; smallest: Guam 6 KB, DC 13 KB,
  American Samoa 28 KB. The outlines (`us.topo.json`, committed) are 648 KB,
  143 KB gzipped, and put all 20 probe points (border towns, islands, both
  sides of the 180th meridian) in the right state first. The build took
  about 2 hours, nearly all of it TIGERweb answering.
- [ ] Step 4: state-aware UI. Finding and choosing districts done; Results
  wording and the county-subdivision layer left.
- [x] Step 5: SPEC §3.3.
- [ ] Step 6: federal coverage.
- [ ] Step 7: a second state.
- [ ] Step 8: the world.

## Open questions for the user

1. Where do the states' boundary files live? Measured: see the progress
   log's size line (tens of MB of JSON in all, a few hundred KB to a few MB
   a state). Two ways, both ready in code:
   - **In this repo** (`apps/web/public/geo/`): copy the built files in, run
     `bun run geo:regions`, commit. Same origin, deploys with the app, no
     new moving part. Costs that much git history at each rebuild (yearly at
     most, or a mid-decade redistricting).
   - **A sibling repo** `openslate-geo`, published like the catalog: set
     `VITE_GEO_BASE` to its URL and run `bun run geo:regions --files all`.
     Keeps this repo small; adds a repo, a publish workflow and a second
     origin.
   My recommendation changed with the measurement: in this repo. It is
   smaller than I guessed, and the files change rarely. Say which, and it's
   one commit. Until then only California has a map; every state has the
   address lookup.
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
