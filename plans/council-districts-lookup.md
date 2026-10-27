# City council districts in the district lookup

`plans/council-districts-lookup.md`

## Goal

ISSUES.md "No lookup places a voter in a city council district": registrar
listings file district council races as `district: us/ca/<city>/council-<n>`,
but no lookup layer has council districts, so every district race in a
voter's city is a *Might be on your ballot*, their own included (a Sunnyvale
voter's report, `plans/ballot-feedback-sunnyvale.md`). An address or map
lookup should place them.

## Environment / context

- Main checkout, `master`, shared with other threads (chain: `plans/issues-burndown.md`).
- Boundary build: `apps/web/scripts/build-geo.ts` (`OTHER_SOURCES`: ArcGIS
  layers queried as GeoJSON, cached in `%TEMP%\openslate-geo-cache`), output
  `apps/web/public/geo/us-ca.topo.json` (3.83 MB). Lookup: `apps/web/src/lib/geo.ts`
  (`LOOKUP_LAYERS`, `lookupsAt`, `areaFromHit`). Placement: `placeRace` in
  `lib/jurisdictions.ts` compares segment `council-3` of
  `us/ca/sunnyvale/council-3` with `area.districts["us/ca/sunnyvale/council"]`.
- Listings with council districts (endorsements `origin/master`, 2026-10-27):
  89 cities in 6 registrars' listings: Alameda (9 cities), LA (27), OC (25),
  San Mateo (13), Santa Clara (8; Morgan Hill's are lettered `council-b`), San Diego (16).

## Decisions

- New lookup layer `council`, like `sup`: one layer for every city we have,
  ids `<Place>|<district>` with the place as TIGER names it (BASENAME, e.g.
  `Sunnyvale`, `La Cañada Flintridge`), looked up only among the found city's
  districts, filed under the city's locality path (`us/ca/sunnyvale/council`).
- Not a complete layer: a point in the city but in none of its districts
  (a gap in the data) stays unknown; a point near a council line stays unknown
  (`NEAR_LINE_METERS`).
- Only boundaries in force for the Nov 3, 2026 election, from the city or
  county (or its registrar). A wrong line hides a race, so a city with no
  trustworthy machine-readable source is left out (its races stay maybes;
  the voter can still answer *On my ballot*).

## Plan / steps

1. [x] Source research per county (subagents): ArcGIS layer per city (or a
   county-wide one), id field, district count, vintage.
2. [x] `build-geo.ts`: council sources, `council` layer; `--check`; size.
3. [x] `geo.ts`: `LOOKUP_LAYERS` + `council`, `lookupsAt` takes the place,
   `areaFromHit` files it under the city path; label "Sunnyvale council district 3".
4. [x] Callers (`FindDistricts.tsx`: address path passes the place), tests.
5. [x] Truth check: points vs full-resolution sources; e2e Sunnyvale.
6. [x] README, gates (lint, typecheck, 683 tests), commit, push; ISSUES entry closed. Browser check not done: the found summary shows the new label through the same path as supervisorial districts (tested in `geo.test.ts`).

## Findings / gotchas

- Orange County (2026-10-27): one Registrar layer covers every city,
  `services3.arcgis.com/slX5MYawmKdsiRUf/.../Map_Central_District_Dissolved_Public_City_Council/FeatureServer/1657`
  (owner `OCROV_WEBADMIN`, edited 2026-09-22), `District_Name='<City>'`,
  district in `Subdistrict_ID` (the integer `Sub_District_ID` is wrong for
  Laguna Hills). Don't use CSUF CDR's Dec 2025 copy (no Laguna Hills, old
  Buena Park line).
- Newport Beach's districts are residency districts, voted citywide, yet the
  OC listing tags its races `council-N`. Left out of the layer (a lookup
  would hide races the voter has); the listing's tags are a data bug
  (ISSUES.md).
- Alameda County: Registrar layer `services5.arcgis.com/ROBnTHSNjoZ2Wm1P/.../City_Council_Districts/FeatureServer/0`
  (edited 2026-10-07), `DIST_NAME LIKE 'CITY OF <NAME>,%'`, number after the
  `#` in `DIST_NAME`. Its sibling `City_Council_District_Boundaries`
  (2023) lacks Hayward's 2024 districts: don't use it.
- San Leandro: Measure F (June 2, 2026) moved it to district elections; 1, 3,
  5 vote by district this November. Whether "District 2 (Short Term)" is
  voted citywide is unconfirmed.
- San Mateo County has no county-wide council layer: each city's own GIS.
  Pacifica and Woodside publish their adopted maps only as PDFs or inside a
  consultant's web map.
- Santa Clara + San Diego: SANDAG `geo.sandag.org/.../Hosted/Council_Districts/FeatureServer/0`
  covers every San Diego County city with districts (`jur_name`, `district`;
  Solana Beach has a NULL offshore strip). San José `OPN_OpenDataService/MapServer/120`,
  Santa Clara `DistrictElectionZone/MapServer/0`, Gilroy layer 1 (not 0).
  Campbell (no public layer; 2019 map re-adopted 2022) and Los Altos (parcel
  layer without geometry) left out.
- Adopted maps published only in NDC's (the cities' demographer's) web maps,
  beside dozens of drafts: Sunnyvale ("101 V2 C Adopted Map"), Pacifica,
  Woodside. `build-geo.ts` reads a web map layer by exact title
  (`webMapLayer`), Web Mercator → lon/lat. Their rings don't keep Esri's
  winding rule (Woodside's all run the other way: 0 polygons at first), so
  holes are found by nesting depth (even-odd), not orientation.
- Morgan Hill's NDC map ("Adopted 2022") is 80–116 pieces per district with
  no vertex within 2 m of another piece: gaps throughout, every point "near a
  line". Left out. (`dissolve` via topojson `merge` kept: it joins pieces
  that do share borders.)
- San José's MapServer answered one heavy query with HTTP 500, then 200:
  `fetchGeoJSON` retries 5xx three times.
- The cache was keyed by source index (`council-24`): removing a source would
  have fed one city's cached map to another. Now keyed by a hash of
  url/where/webMapLayer.
- The OC and SANDAG layers also bring cities with no council race this
  election (Dana Point, Laguna Niguel): harmless, the lookup is per city.
- First build (before LA): 328 districts in 65 cities, 3,740 → 4,076 KB.
- LA County: the Registrar-Recorder's `Incorporated_Cities1/FeatureServer/1`
  (31 cities, "Last Update: August 2023", `DIV_CITY`, `ABBR LIKE '08XX%'`)
  for 8 cities that haven't redrawn since and publish nothing of their own
  (Bellflower, Claremont, Compton, Downey, Duarte, El Monte, La Verne, South
  Pasadena); each other city's own layer. Duarte really has 7 districts.
  Downey's 2025 five-district map starts in 2028: 2026 uses the old four.
  Alhambra has two layers with different lines: `Alhambra_Base/FeatureServer/12`
  (matches the county's), not `Alhambra_Districts`. Inglewood splits
  District 2 into two features (joined by id). Santa Clarita (only a
  consultant's "Map_113", final unconfirmed) left out.
- Huntington Park (districts new this November, "Adopted (Magenta) Map" in
  NDC's web map) and San Leandro (Measure F) left out for now: each has a
  District 2 seat on the listing that may still be voted citywide, and a
  wrong district tag would hide it once the city's map is in. ISSUES.md.
- Final build: 433 districts in 84 cities, 4,111 KB (brotli 931 → ~1,019 KB,
  +9%); decode time unchanged (~260 ms in Bun). `--check`, 20,000 random city
  points: council 0 wrong of 3,360 placed, 535 unknown. Of the unknowns, most
  are within 75 m of a council line (council districts are small); the rest
  are in water TIGER counts as the city (Foster City, Berkeley, Oakland,
  Hayward bay) that council maps leave out.
- Spot checks against the full-resolution sources all agree (Sunnyvale
  Lakewood 6, Ortega Park 3, Cherry Chase 2; San José Willow Glen 6; Oakland
  Rockridge 1; LA Silver Lake 13; SD North Park 3; Irvine Woodbridge 5;
  Anaheim 3; Pacifica Linda Mar 4; Duarte 4): pinned in `test/geo.test.ts`.

## Progress log

- [x] Claimed (`bf41246`).
- [x] Sources, build, lookup, tests, README; follow-ups in ISSUES.md
  ("Council seats voted citywide may be tagged as districts", "Some cities'
  council districts have no usable map").

## Things not to do

- Don't guess a district from a stale (pre-2022) map.
