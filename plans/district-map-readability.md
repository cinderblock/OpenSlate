# District map readability

## Goal

The "Pick on a map" view (Find your districts) is hard to read: the user
reported (2026-10-21) "I don't recognize all the areas… almost like the areas
are disjoint". Make each district read as one area you can recognise, without
changing the boundary data or the lookup.

## Environment / context

- Main checkout `C:\Users\camer\git\Personal Projects\OpenSlate`, branch
  `master` (pushing to master deploys openslate.us through Workers Builds).
- Map: `apps/web/src/components/DistrictMap.tsx`, CSS in
  `apps/web/src/styles.css` (`.district-map*`, `.map-*`). Data decoding:
  `apps/web/src/lib/geo.ts` (`decodeStateGeo`), tests in
  `apps/web/test/geo.test.ts`. Boundaries: `apps/web/public/geo/us-ca.topo.json`
  (one topology for all five layers, so neighbours share arcs).
- The app is dark-only (`:root` in styles.css; surface `#1a1d24`).
- Background on the data: `plans/find-my-districts.md`.

## Diagnosis

- **The data is right.** Filling each Senate district with its own colour on
  the live site shows 40 contiguous districts that match the real map.
  Polygon counts per layer are sane (islands only: CD 24, SD 21, LA County…).
- **The drawing is the problem.** Districts were drawn as unfilled 1px
  `--muted` lines on top of counties outlined in 1.5px `--border`: two
  near-identical line styles, nothing filled. The eye reads the cells
  between *any* two lines (county ∩ district fragments) as the areas.
- Only 13 of 40 Senate districts got a number at the statewide view (label
  threshold `size > (view.w / 12)²`), and the label sat at the centroid of the
  largest ring, which can fall outside a concave district.

## Decisions

- Fill every district (or county, in Counties view) with one of four colours,
  chosen so no two that touch share one, corners included (adjacency from
  shared arc endpoints, `touching` in geo.ts; falls back to shared borders
  only if four colours can't be found that way). Coloured once at decode
  time by backtracking search (`fourColor`); greedy DSatur needs 5 for CD
  and AD.
- Colours: the dataviz reference dark slots yellow / magenta / green / violet
  blended at 90% over the surface: `#b87b04,#c24c78,#037904,#847bd5`.
  Validator (`--mode dark --surface #1a1d24 --pairs all`): all checks pass;
  CVD worst pair 6.4 (protan) is in the 6–8 floor band, legal only with
  secondary encoding. We have that: a 1.5px background-coloured gap
  between districts and a number label on every district that fits. Blue is
  left out because it's the accent, used for the selection.
- County lines become thin, dashed and faint, above the fills, for
  orientation only (hidden in Counties view, where counties are the fills).
- City limits are not shaded any more (only named when zoomed in, and the
  picked spot's city gets a dashed outline): their patchwork broke each
  district into pieces again, the same symptom the user reported.
- Labels are sized in screen pixels (11 px, district numbers 1.3×), not as a
  fraction of the view, so a phone shows fewer but readable labels.
- Labels go at the pole of inaccessibility (`polylabel`), and show only when
  the label fits inside the shape's largest inscribed circle at the
  current zoom.
- Selection: the picked district keeps its colour, others dim, and the pick
  gets a bright outline.

## Plan / steps

1. `geo.ts`: `colorShapes` (four-colouring over `neighbors`), `GeoShape.color`;
   tests (neighbours differ, ≤ 4 colours, deterministic).
2. `DistrictMap.tsx`: fills by colour class, gap borders, faint county lines,
   polylabel labels sized to fit, selection dimming.
3. CSS.
4. Check on a local dev server: Congress / Senate / Assembly / Counties, a
   zoomed Bay Area and LA view, a picked spot, phone width.
5. Checks (typecheck, tests, Biome with CRLF config, build), commit, ask to
   push (push = deploy).

## Findings / gotchas

- The validator's all-pairs check fails every low-alpha tint (35–50%):
  chroma below floor and normal-vision ΔE < 8. Muted pastel fills aren't an
  option on this surface; near-full-strength fills are.
- Of 35 four-hue combos × 4 alphas from the reference dark slots, only
  yellow/magenta/green/violet at alpha ≥ 0.9 passes.
- Shared-arc adjacency (`topojson-client` `neighbors`) matches a geometric
  check (vertices within 20 m) everywhere except AD 38 / AD 40, which meet
  at a single point; with arcs alone both came out green. Point contacts
  always fall on arc endpoints in a topology, so checking endpoints catches
  them cheaply (hashing every vertex cost 40–60 ms per layer on desktop).
- Vite can't fast-refresh DistrictMap.tsx (it exports `LAYER_NAMES`), so
  every edit remounts the map at the statewide view; a click in a test
  script right after an edit lands somewhere else.
- The full-repo Biome run with the CRLF config flags files this change
  doesn't touch (LF files in this checkout, `apps/web/.wrangler/tmp`); the
  changed files pass on their own.

## Progress log

- [x] Diagnosis (live site, colour-filled check)
- [x] Palette chosen and validated
- [x] Steps 1–4: `68af945` (fills, colouring, labels, selection);
      checked on localhost:5202 in Senate, Assembly and Counties views,
      zoomed Bay Area, a pick in San Jose, and at 390 px
- [x] `cb73c1c`: the map's screen-reader label said "countys"
- [x] Checks: typecheck (5 packages), 229 tests, Biome on changed files,
      build
- [ ] Push to master (deploys openslate.us)  ← waits on the user

## Open questions for the user

1. Push `68af945` and `cb73c1c` to master? That deploys openslate.us.
   Recommendation: yes, after a look at the map on the dev server.

## Things not to do

- Don't touch the simplification or rebuild the topology: the shapes are
  correct.
- Don't put pastel tints back without re-running the validator.
