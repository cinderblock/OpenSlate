# Find my districts: on-device and opt-in online lookups

## Goal

Make *Where you vote* (My ballot and the wizard) fill itself in, instead of
sending people to an external page (findyourrep.legislature.ca.gov) and making
them copy numbers back. Offer several ways to do it, every one opt-in and clear
about what leaves the device:

| Method | Runs | What is sent, to whom |
| --- | --- | --- |
| Pick on a California map | on device | nothing |
| Use my location | on device (after the browser's location prompt) | nothing from us; the browser/OS may consult its own location service |
| Address via OpenStreetMap (Nominatim) | browser → OSM directly | the typed address, to the OpenStreetMap Foundation |
| Address via the Census Bureau | browser → OpenSlate relay (polls.openslate.us) → US Census geocoder | the typed address, through our worker (kept nowhere) to census.gov |
| Address via your own server | browser → self-hosted apps/server → Google Civic | the address, to your server and Google (existing) |
| Set by hand | on device | nothing |

Also fix the district picker: list every real district, and when yours has no
race this election, *say so* (e.g. "No State Senate race in district 13 this
election; only even-numbered seats are up") rather than hiding it, which
"makes it look broken" (user, 2026-10-20).

## Environment / context

- Worktree `C:\Users\camer\.t3\worktrees\OpenSlate\feat-find-my-districts`,
  branch `feat/find-my-districts`, from local master `e07192b`. **Contains a
  merge of `ui/custom-controls` (`5882942`)**, the other thread's finished
  custom-controls kit, which this UI is built on.
- Web app `apps/web`. New: `src/lib/geo.ts` (boundaries + lookup),
  `src/lib/lookups.ts` (consent + Nominatim/Census clients),
  `src/lib/projection.ts` (Albers), `src/components/FindDistricts.tsx`,
  `DistrictMap.tsx`, `AddressLookupsPanel.tsx` (Settings). Changed:
  `AreaPicker.tsx`, `MyBallotPanel.tsx`, `Wizard.tsx`, `jurisdictions.ts`
  (`DISTRICT_COUNTS`, `allDistricts`, `noRaceReason`; `DISTRICT_LOOKUP`
  removed). `AddressLookup.tsx` deleted (folded into FindDistricts).
- Data: `apps/web/public/geo/us-ca.topo.json`, built by
  `bun run --filter '@openslate/web' geo` (`apps/web/scripts/build-geo.ts`;
  `--check` reports accuracy, `--refresh` refetches). Service worker keeps it
  (stale-while-revalidate) once used; not precached.
- Worker `apps/poll-cache` (Cloudflare, `https://polls.openslate.us`, deployed
  by Workers Builds on every push to master): new `src/geocode.ts`,
  `POST /api/geocode/census`. `apps/server` mounts the same handler
  (workspace dep `@openslate/poll-cache/geocode`).
- Hosted CSP (`apps/web/public/_headers`): `script-src 'self'`,
  `connect-src 'self' https:`, `Referrer-Policy: no-referrer`. Unchanged.
- Census: TIGERweb `tigerWMS_Current` layers 54 (120th Congressional
  Districts), 56 (2026 SLD Upper), 58 (2026 SLD Lower), 82 (Counties),
  28 (Incorporated Places); "January 1, 2026 vintage". Geocoder:
  `geocoding.geo.census.gov/geocoder/geographies/onelineaddress`, keyless,
  no CORS, 100-character address limit.
- Checks: `bun run typecheck`, `bun test`, Biome with a CRLF config copy
  (`bunx biome check --config-path="$TEMP/biome-crlf" apps packages`),
  `bun run build`.
- Local testing: dev server on port **5201**. Port 8787 is held by something
  outside this worktree (left alone), so the server ran as
  `PORT=8791 bun run apps/server/src/index.ts` and Vite with
  `VITE_POLLS_BASE=http://localhost:8791`.

## Decisions already made (don't re-ask)

- **Support all the options, each with a clear opt-in** (user, 2026-10-20).
  Online methods name the recipient and what is sent before first use; the
  button reads "Allow X and look up"; consent is remembered per service and
  revocable (Settings → Address lookups, or "Stop allowing" in place).
- **On-device options are wanted** (user): map picker and "use my location"
  match against boundary data shipped with the app.
- **Use our worker** for the Census lookup (user: "we do have workers
  server"). No JSONP: CSP `script-src 'self'` stays; it backs the usage
  telemetry guarantee (plans/usage-analytics.md).
- **Show a district with no race; don't hide it** (user).
- **A map of California to pick from** (user).
- **No native form controls** (user memory, 2026-10-20): built on the
  `ui/custom-controls` kit, merged into this branch.
- Don't push without asking: a push to master deploys the worker.
- Relay is **POST** so the address never sits in a URL or request log.

## Plan / steps

1. [x] Plan doc (`21de6f8`).
2. [x] Geo data + build script (`bb61833`).
3. [x] `lib/geo.ts` lookup, near-line warning, COA from county, locality
   slugs, merge into an existing area; tests against Census answers
   (`bb61833`).
4. [x] Every real district, `noRaceReason` (`711e644`); picker badges and
   My-ballot "no race" sections (`d6faa46`).
5. [x] Worker relay (`187bfee`), same route in apps/server (`5150c5c`).
6. [x] Clients + consent store (`0e0e2c3`; server/Google entry in `d6faa46`).
7. [x] UI: FindDistricts + DistrictMap in AreaPicker, so the wizard gets it
   (`d6faa46`); Settings panel (`2553f4a`); phone-width fix.
8. [x] README, ISSUES, plan; checks; browser walkthrough.
9. [x] Merge to master and push (user: "yes", 2026-10-20). `ui/custom-controls`
   had already landed on master (`eead22d`) via its own thread; merged
   `origin/master` into this branch, re-ran every check, pushed as a
   fast-forward. Workers Builds deploys both workers from there.
10. [x] Workers Logs pinned off in `apps/poll-cache/wrangler.toml` (user: yes).
11. [x] Verified live (2026-10-21): `polls.openslate.us/api/health` lists
    `/api/geocode/census`; a production POST for Palo Alto City Hall returns
    CD 16 / SD 13 / AD 23 with `Cache-Control: no-store`; openslate.us serves
    the new bundle and `geo/us-ca.topo.json` (614 KB brotli on the wire).

## Findings / gotchas

- **SD 13 isn't missing by mistake:** California elects odd-numbered Senate
  seats in presidential years; on 2026-11-03 only even ones are up (Const.
  art. IV §2). The catalog has `us/ca/sd-2` … `sd-40`, all even. The picker
  only offered districts with endorsements, so 13 wasn't listed, and "not
  set" then claimed Senate races were hidden. `noRaceReason` uses that rule
  for the Senate and infers staggering from the data elsewhere.
- **The maps are the post-Prop 50 ones:** Census places Santa Rosa in CD 1
  and Palm Springs in CD 48 (both moved under Prop 50); SF City Hall is
  CD 11 / SD 11 / AD 17, Palo Alto City Hall CD 16 / SD 13 / AD 23, LA City
  Hall CD 34 / SD 26 / AD 54. These five are unit tests on the shipped file.
- **Census geocoder has no CORS** (no `Access-Control-Allow-Origin`, OPTIONS
  answers without it); it only offers JSONP, which our CSP blocks. Hence the
  relay. **Nominatim does send `Access-Control-Allow-Origin: *`.**
- **Simplification trade-off (measured with `--check`, 20,000 random points
  inside cities per layer):** Visvalingam weight 5e-10 → 3.08 MB, 0–3 misses;
  1e-8 → 2.56 MB, 4–5; **1e-7 → 1.76 MB (594 KB gzipped), 4–5 misses (≈1 in
  4,000), chosen**; 1e-6 → 1.15 MB, 10–13. TIGERweb's own
  `maxAllowableOffset` simplifies each polygon alone (borders stop
  coinciding), so the script fetches at ~1 m and simplifies topologically.
- Catalog locality slugs: counties `<name>-county` (sometimes bare, e.g.
  `marin`, `contra-costa`), cities by name (sometimes `city-of-<name>`), SF
  `sf`. `localityCandidates` tries each; only slugs some imported race uses
  are set.
- Court of Appeal district comes from the county (Gov. Code §69100–69106);
  a test checks all 58 counties map exactly once.
- BART, EBMUD and other special districts aren't in the boundary data; the
  result says "Not found this way: BART district" and keeps whatever was set.
- **Git Bash `sed -i` rewrote CRLF files as LF** in this checkout; edit with
  Python (`newline=''`) or run Biome with the CRLF config afterwards.
- Biome 1.9: a `biome-ignore` for a JSX attribute rule must be a `//`
  comment on the line before the attribute, inside the tag.
- Fieldsets default to `min-inline-size: min-content`; the area picker
  overflowed a 390 px screen until `min-width: 0`.
- `@cloudflare/workers-types` default entry is the oldest compat date; the
  worker now uses `/latest` (fetch's `cache: "no-store"`).
- Headless preview: clicking a kit Segmented's hidden radio times out; click
  the `.ui-segment` label instead.

## Progress log

- [x] Diagnosis (SD 13 parity, hosted app never had a lookup, CSP blocks JSONP)
- [x] Steps 1–8
- [x] Walkthrough on `localhost:5201` (2026-10-20): wizard → map click on Palo
      Alto City Hall → CD 16, SD 13 "no race … only even-numbered seats are
      up", AD 23, COA 6, Palo Alto + Santa Clara County chips; Census
      address lookup (real relay → census.gov) and OpenStreetMap lookup both
      gave the same districts, consent stored per service; location with a
      stubbed fix at SF City Hall → CD 11 / SD 11 / AD 17 / COA 1; declined
      permission shows a message; My ballot shows "State Senate district 11 ·
      no race" between Congress and Assembly; Settings lists both consents
      and the remembered address; phone width (390 px) fits.
- [x] Checks: 5 packages typecheck, 225 tests, Biome clean, build OK.
- [x] Deployed and checked live (2026-10-21).
- [x] Merge + push (2026-10-20), after a clean merge of `origin/master` and
      a full re-check (225 tests, typecheck, Biome, build, wrangler dry run).

## Open questions for the user

None open. Answered 2026-10-20 ("yes"): merge and push; pin Workers Logs
off for poll-cache.

## Follow-ups (not started)

- ~~Opt-in OpenStreetMap basemap under the map~~: done as an opt-in USGS
  street/satellite background, see plans/district-map-basemap.md.
- BART and other special-district boundaries (BART publishes them).
- Region containment (`us/ca/bay-area` ⊃ SF) from the county the lookup
  finds; see plans/ui-two-modes-refactor.md.
- Other states: `GEO_FILES` and the build script are per state.

## Things not to do

- Don't loosen CSP `script-src` (no JSONP, no third-party scripts).
- Don't cache or log addresses in the worker (`Cache-Control: no-store`,
  `cache: "no-store"` upstream, POST only).
- Don't send anything to an online lookup before the user opted in to that
  service.
- Don't add usage events that reveal a location, district or lookup choice.
- Don't build a second form-control kit; use `ui/custom-controls`'.
- Don't touch whatever holds port 8787 on this machine.
