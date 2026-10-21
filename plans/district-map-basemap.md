# District map: street / satellite background

## Goal

The user (2026-10-21, after the four-colour fills shipped): "I like the colors
for the map areas, but I think the districts need to be a mostly transparent
layer on top of a satellite/street map." Districts are hard to place on a bare
map; streets, towns and terrain underneath make "where do I live" obvious.

Follows `plans/district-map-readability.md` (fills, four-colouring, labels),
and the follow-up logged in `plans/find-my-districts.md`: "Opt-in
OpenStreetMap basemap under the map (tiles reveal roughly where you look, so
it needs its own consent)."

## Environment / context

- Main checkout `C:\Users\camer\git\Personal Projects\OpenSlate`, branch
  `master`; a push to master deploys openslate.us (Workers Builds), so ask
  first.
- Map: `apps/web/src/components/DistrictMap.tsx` (own SVG renderer: viewBox
  pan/zoom, pointer + keyboard), used only by `FindDistricts.tsx`
  (`MapPanel`). CSS `.district-map*`, `.map-*` in `apps/web/src/styles.css`.
- Projection was Albers (`src/lib/projection.ts`), only used by the map.
- CSP (`apps/web/public/_headers`): `img-src 'self' data: blob: https:`,
  `script-src 'self'`, `worker-src 'self'`, `Referrer-Policy: no-referrer`.
- Service worker (vite-plugin-pwa) only runtime-caches same-origin `/geo/`;
  cross-origin tiles fall to the browser's HTTP cache.

## Decisions

- **Tiles from USGS The National Map**: `USGSTopo` (streets) and
  `USGSImageryTopo` (aerial imagery with roads and names), at
  `https://basemap.nationalmap.gov/arcgis/rest/services/<svc>/MapServer/tile/{z}/{y}/{x}`
  (row before column). Public domain, no key, `Access-Control-Allow-Origin: *`,
  `Cache-Control: max-age=86400`, ~50–100 ms per tile, cached to z16
  (1:9,028). A US government source suits a US civic app and needs no
  referrer.
  - Rejected: OpenStreetMap's tile.openstreetmap.org (its usage policy
    needs a Referer, which our `no-referrer` policy strips, and discourages
    app use); Esri World Imagery (needs an ArcGIS key now); CARTO (usage
    caps, commercial terms).
- **Opt-in, off by default, remembered.** A "Background" choice (Off / Streets /
  Satellite) next to the map, with the disclosure shown before choosing:
  tiles tell USGS roughly which area you're viewing; where you click is
  still worked out on the device. Picking Streets or Satellite is the consent;
  choosing Off withdraws it. Stored in localStorage
  (`openslate.basemap.v1`).
- **Own renderer, not MapLibre/Leaflet.** Raster tiles as SVG `<image>`s under
  the existing layers keep all of the current interaction, colouring, labels
  and accessibility. MapLibre would also need a CSP change (`worker-src
  blob:`) and ~200 KB gz.
- **Web Mercator for the whole map** (tiles are Mercator; switching
  projection with the background would reshape the state). Albers removed.
- With a background on: fills mostly transparent, each district outlined in
  its own colour so edges stay clear on any imagery; without one, the
  current opaque look the user liked stays as is.

## Plan / steps

1. `projection.ts`: Web Mercator in tile units (world = 1×1); tests.
2. `src/lib/basemap.ts`: basemap list, tile URL, `tilesFor(view, px, max)`,
   choice store; tests.
3. `DistrictMap.tsx`: `basemap` prop, tile layer (each tile still loading
   backed by the one a zoom out, `tilesToDraw`, so zooming never flashes
   blank), credit, transparent styling.
4. `FindDistricts.tsx`: Background control + disclosure; method summary.
5. CSS; README sentence about the map.
6. Check in the browser (Streets, Satellite, Off; statewide, Bay Area, a pick,
   phone width), then checks, commit, ask to push.

## Findings / gotchas

- First tile fetch test 404'd: wrong tile maths on my side (ArcGIS wants
  `tile/{z}/{row}/{col}`); SF City Hall is z13 row 3166 col 1310.
- USGS z9 tiles come back as PNG, z13+ as JPEG; either renders.
- **Imagery is transparent offshore** (USGSImageryTopo/ImageryOnly serve
  RGBA PNGs from z10 over water; USGSTopo is always opaque JPEG). The first
  version always drew the zoom-out tiles underneath, which showed through:
  "San Francisco" labelled twice at two sizes, a second map ghosting under
  the first. Fix: draw a backdrop tile only under tiles not loaded yet
  (`tilesToDraw`, load tracking by URL in DistrictMap), and give the
  satellite view a dark-sea background (`#0d1f2d`) for open water.
- USGS's own imagery has pale strips and the odd dark square along the coast
  and bay at z9–11 (source mosaic, not our seams); at street zoom it's clean.
- The Census district polygons run out to sea (e.g. SD 11 to the Farallons),
  so tints cover water; that's the real boundary, left as is.
- React Aria's radios time out on a Playwright click (visually hidden
  input); clicking the `.ui-segment` label in the page works.

## Progress log

- [x] 1 Projection (Web Mercator; Albers removed)
- [x] 2 basemap.ts (+ `tilesToDraw`), tests
- [x] 3 DistrictMap
- [x] 4 FindDistricts (Background control, disclosure, method summary)
- [x] 5 CSS, README (Cloud paragraph, architecture diagram)
- [x] 6 Checked on localhost:5202: Off (no tile requests), Streets
      statewide and Bay Area, Satellite Bay Area and street level in
      Alameda, a pick in Oakland (SD 7 outlined, others dimmed), 390 px
      phone width. Typecheck (5 packages), 234 tests, Biome on changed
      files, build. Committed.
- [ ] Push (needs the user's yes; push = deploy)

## Open questions for the user

1. Push to master (deploys openslate.us)? Recommendation: yes.
2. Keep the background off by default (the earlier plan's privacy rule), or
   default to Streets? Recommendation: keep it off; one click turns it on
   and it's remembered.

## Things not to do

- Don't load any tile before the user picks a background: the map's
  "nothing leaves this device" promise is the default.
- Don't touch the boundary data or four-colouring (see the readability plan).
