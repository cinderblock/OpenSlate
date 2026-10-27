# Council districts for the cities with no usable map

`plans/council-maps-missing-cities.md`

## Goal

ISSUES.md "Some cities' council districts have no usable map": Campbell,
Los Altos, Morgan Hill and Santa Clarita have `council-N` races in the
catalog but no source in the council lookup (`OTHER_SOURCES` in
`apps/web/scripts/build-geo.ts`), so their district races stay *Might be on
your ballot*. Add each city whose lines in force for Nov 3, 2026 can be
proven; leave out (and say why) any that can't. A wrong line hides a race.

Races in the catalog (endorsements `origin/master`, 2026-10-27):
Campbell 3, 4, 5; Los Altos 2, 4; Morgan Hill B, D; Santa Clarita 2, 4, 5.

## Environment / context

- Background: `plans/council-districts-lookup.md` (the lookup, how sources
  were checked, the `--check` numbers). Chain plan: `plans/issues-burndown.md`.
- Rebuild: `bun run geo --check` from `apps/web` (~2 min warm).
- ArcGIS Online search: `https://www.arcgis.com/sharing/rest/search?q=...&f=json`
  (`owner:NDCuser1` finds the demographer NDC's maps). A web map's layers:
  `/sharing/rest/content/items/<id>/data`.
- Santa Clara County Registrar of Voters' ArcGIS org:
  `services2.arcgis.com/nJEmhZphYC5TKA7K` (`E147_Voting_Precincts`,
  `Precinct_Boundaries_`, `Cities_Merge_120525`).

## Verification method

- Santa Clara County cities: precincts nest within council districts, so the
  map in force must not cut any current precinct (and a draft or stale map
  will). Numbering checked against the city's own published map.
- Santa Clarita: LA County's interactive sample ballot data
  (`isb.lavote.gov/parsed/4348/…`) gives each address its contests; check
  sample addresses in each candidate district.

## Candidate sources

- Campbell: NDC web map `92ae7d18…` ("Campbell 2019 Districting", layer
  "Council-Selected 111b"); NDC web map `2f0371e7…` ("Campbell City
  Redistricting 2022", layer "Existing Districts").
- Morgan Hill: NDC web map `75612c64…`, layer "2022 - 2030 Council Election
  Districts (Adopted 2022)" (pieces with gaps, per the earlier plan).
- Santa Clarita: NDC web map `4f8f751b…` ("Santa Clarita 2023 Districting"),
  layers "Council" and "Map_113 (new May 16th option)".
- Los Altos: nothing found yet.

## Progress log

- [x] Claimed (`1111477`).
- [x] Campbell, Los Altos, Morgan Hill: registrar precincts by district
  (`build-geo.ts`, the precinct table checked address by address)
- [x] Santa Clarita: the city's own layer
- [x] `dissolve` drops seam rings
- [x] Spot checks pinned in `test/geo.test.ts` (one registrar- or
  sample-ballot-checked address per district)
- [x] Build `--check` (council: 1 wrong of 3,590, 617 unknown; the wrong
  point is San Diego/Chula Vista, see below), gates, README, issue closed

## Findings / gotchas

- (2026-10-27, ~2:30 AM PDT (09:30Z)) **Santa Clarita has its own layer**:
  the city's GIS, `maps.santa-clarita.com/arcgis/rest/services/Boundary/MapServer/17`
  ("City Council Districts", `District` 1–5, named "CITY OF SANTA CLARITA
  1ST COUNCIL" like the LA registrar's). Found via the city's /residency
  page → web app `4b3cfb27…` → web map `91927dff…`. Checked against LA's
  sample ballot data: 129 of 131 geocoded addresses agree (council contest or
  none); the 2 misses are on Orchard Village Rd, 7 m from the line (the
  lookup's near-line rule already says "unknown" there).
- **Santa Clara County Registrar's address lookup** works from a script in
  T3's preview browser (plain fetch gets a 500; the page's own
  `SearchAddress(num, street, dir, '', type, CITY, zip, full)` populates the
  form): `rovservices.sccgov.org/Home/IndexPost?selected=dt&electionId=148…`.
  It needs a ZIP and a USPS type ("AVE", not "AV"), and returns the precinct
  and "City Council Member - District N" (data "last updated July 17, 2026").
  Addresses to try: the county's `Address_Points_Search_and_Labels_VIEW`
  (`services2.arcgis.com/tcv2cMrq63AgvbHF`).
- Precinct test on candidate maps (`Precinct_Boundaries_`, registrar, edited
  2026-07): share of a map's internal lines within 30 m of a precinct line.
  Sunnyvale (in the lookup) 99.8%; Campbell "Existing Districts" (2022 web
  map, identical to 2019's "Council-Selected 111b") 99.1%; Campbell drafts
  92.5% and 73.4%. Morgan Hill's 2018 map also passes (99.3%): the precinct
  lines keep old district lines, so this test can't tell a stale map.
- Sample of 121 addresses 40–600 m from candidate lines against the
  registrar's lookup: Campbell (NDC 2022) and Los Altos (F2A) all agree;
  Morgan Hill's NDC map is wrong at 260 Dunne Ave (map C, registrar A,
  precinct 4816) and leaves 5.5 km² of the city in no district.
- **Los Altos**: the city's `map.losaltosca.gov/.../PublicGISLayers/MapServer/75`
  is a per-parcel APN → DISTRICT table (no geometry); `/56` TaxParcel has the
  geometry. Redistricting Partners' F2A file (linked from the city's Find Your
  District page: `redistrictingpartners.com/wp-content/uploads/2024/10/Los-Altos-Final-Map-F2A.html`)
  embeds the five districts as GeoJSON: all 11,278 parcels it covers agree,
  18 edge parcels fall ≤25 m outside.
- Chosen approach for Campbell, Los Altos and Morgan Hill: districts as the
  union of the registrar's current precincts, each precinct's district read
  from the registrar's own lookup (an address inside every precinct). That
  is the registrar's geometry and numbering, every precinct checked, rather
  than a consultant's census-block map.
- Precinct reads (186 polygons, 2–6 addresses each): the lookup often returns
  a *consolidated* precinct number for this election (3862 → 3861, 4810 →
  4803): harmless, same ballot. Two polygons (3851, 3867) first showed two
  districts: the odd address was 17–34 m from the edge, on a district-line
  street; four more addresses deep inside each settled them. Some Campbell
  addresses carry another city's mailing address (3839: Los Gatos 95032,
  3868: San José 95125). Every precinct's district agrees with the
  consultant map's majority district for it. Precincts with no address
  points (Campbell 3866, Morgan Hill 4865, Los Altos 2315, 2350; all under
  4.5 ha) stay out: "unknown" there.
- Dissolving precincts left hairline rings along seams (the server
  generalizes each precinct alone): every one under 0.4 m mean width, the
  narrowest real hole (a county pocket) 11 m. `dissolve` now drops rings
  under 2 m mean width (2·area/perimeter); that also cleaned other cities'
  dissolved districts (output 4,137 → 4,050 KB). A 1 m² area cut-off didn't
  work: seams run up to ~190 m² (long ones).
- Near-line ("unknown") share of random city points after: Campbell 30%,
  Los Altos 25%, Morgan Hill 23%, Santa Clarita 9% (Sunnyvale 12%, Glendora
  16%). Campbell's is its geometry: small, ragged edge, county pockets.

- `--check`'s council "wrong" (2026-10-27, ~3:20 AM PDT): with 100,000
  points the only one was at -117.03367, 32.58804: the check's truth looks
  across every city's districts (Chula Vista|3) while the app looks only in
  the TIGER city (San Diego|8). SANDAG's city line differs a little from
  Census's there; not from this change.

## Things not to do

- Don't guess a district from a stale (pre-2022) map or a draft.
- Don't trust the precinct-line test alone: precinct lines keep old
  district lines too (Morgan Hill's 2018 map passes it).
- Don't cut dissolve seams by area: long seams reach ~190 m²; use width.
