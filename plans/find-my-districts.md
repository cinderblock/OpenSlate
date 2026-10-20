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
  branch `feat/find-my-districts`, from local master `e07192b`.
- Web app `apps/web` (React 18, Vite 6, TanStack Router/DB/Query). Area model
  and helpers: `src/lib/jurisdictions.ts` (Area = localities + district number
  per `<state>/<family>`), `src/lib/collate.ts` (`areaOptionsOf`),
  `src/components/AreaPicker.tsx`, `AddressLookup.tsx` (self-hosted Civic),
  `src/lib/civicArea.ts`, wizard area step in `Wizard.tsx`, My ballot's
  "Hidden until you set your district" in `MyBallotPanel.tsx`.
- Worker `apps/poll-cache` (Cloudflare, `https://polls.openslate.us`, deployed
  by Workers Builds on every push to master). Hosted build points at it via
  `apps/web/.env.production` (`VITE_POLLS_BASE`).
- Hosted CSP (`apps/web/public/_headers`): `script-src 'self'`,
  `connect-src 'self' https:`, `img-src … https:`, `Referrer-Policy:
  no-referrer`.
- Census: TIGERweb `tigerWMS_Current` MapServer layers 54 (120th
  Congressional Districts), 56 (2026 State Legislative Districts – Upper),
  58 (– Lower), 82 (Counties), 28 (Incorporated Places). Geocoder:
  `geocoding.geo.census.gov/geocoder/geographies/onelineaddress` (keyless,
  no CORS, JSONP only).
- Checks: `bun run typecheck`, `bun test`, Biome with a CRLF config copy
  (`bunx biome check --config-path=<dir with lineEnding crlf> <files>`),
  `bun run build`. Dev server for this worktree: port **5201**.

## Decisions already made (don't re-ask)

- **Support all the options, each with a clear opt-in** (user, 2026-10-20).
  Online methods name the recipient and what is sent before first use; the
  consent is remembered per method and revocable.
- **On-device options are wanted** (user): map picker and "use my location"
  match against boundary data shipped with the app.
- **Use our worker** for the Census lookup (user: "we do have workers
  server"). No JSONP: CSP `script-src 'self'` stays, it backs the usage
  telemetry guarantee (plans/usage-analytics.md).
- **Show a district with no race; don't hide it** (user).
- **A map of California to pick from** (user).
- **No native form controls** (user memory, 2026-10-20). Another thread is
  building the kit on `ui/custom-controls` (react-aria-components,
  `apps/web/src/components/ui/`). New controls here use that kit; this branch
  merges it in once its Select/TextField land rather than duplicating it.
- Don't push without asking: a push to master deploys the worker.

## Plan / steps

1. [ ] Plan doc (this).
2. [ ] Geo data: `apps/web/scripts/build-geo.ts` fetches the five TIGERweb
   layers for CA, simplifies topologically, quantizes, writes
   `apps/web/public/geo/us-ca.topo.json` (lazy-loaded, not precached by the
   PWA). Records source vintages in the file.
3. [ ] `src/lib/geo.ts`: load + decode, point-in-polygon per layer, distance
   to nearest boundary (near-line warning), county → Court of Appeal district,
   places/counties → known locality slugs → an `Area`. Unit tests.
4. [ ] Districts: every real district per family (`DISTRICT_COUNTS`), "no race
   this election" in the picker and on My ballot, parity explanation derived
   from the data.
5. [ ] Worker: `/api/geocode/census?address=` relay (no-store, no logging of
   the address, trimmed response), tests.
6. [ ] Clients: Nominatim (direct, `referrerPolicy: "origin"`, 1 req/s,
   attribution) and Census relay; consent store (localStorage, revocable in
   Settings).
7. [ ] UI: "Find my districts" box (map, my location, address with provider
   choice, self-hosted Civic) in AreaPicker, so the wizard gets it too. Map:
   SVG of our polygons, pan/zoom, click → districts. Uses the custom-controls
   kit.
8. [ ] README, ISSUES, full checks, browser walkthrough.

## Findings / gotchas

- **SD 13 isn't missing by mistake:** California elects odd-numbered Senate
  seats in presidential years; on 2026-11-03 only even ones are up. The
  catalog has `us/ca/sd-2` … `sd-40`, all even. The picker only offered
  districts with endorsements, so 13 wasn't listed, and "not set" then claimed
  Senate races were hidden.
- **Census geocoder** for SF City Hall: CD 11, SD 11, AD 17, San Francisco
  city/county. Layers named "120th Congressional Districts" and "2026 State
  Legislative Districts", the maps in force for the Nov 2026 election.
- **Census geocoder has no CORS** (no `Access-Control-Allow-Origin`, OPTIONS
  answers without it); it only offers JSONP, which our CSP blocks. Hence the
  relay.
- **TIGERweb sizes (CA, `maxAllowableOffset` 0.0002°):** CD 1.29 MB, SD 1.09,
  AD 1.33, counties 1.04, places (483) 1.70 MB of GeoJSON. As one TopoJSON
  quantized 1e5: 1.64 MB, 499 KB gzipped. But the server-side offset
  simplifies each polygon alone, so shared borders stop coinciding; simplify
  topologically after building the topology instead.

## Progress log

- [x] Diagnosis (SD 13 parity, hosted app never had a lookup, CSP blocks JSONP)
- [ ] Steps 2–8

## Open questions for the user

(none yet)

## Things not to do

- Don't loosen CSP `script-src` (no JSONP, no third-party scripts).
- Don't cache or log addresses in the worker (`Cache-Control: no-store`, no
  `cf.cacheTtl` on the geocode route).
- Don't send anything to an online lookup before the user opted in to that
  method.
- Don't add usage events that reveal a location, district or method choice
  combined with anything identifying (plans/usage-analytics.md).
- Don't build a second form-control kit; use `ui/custom-controls`'.
