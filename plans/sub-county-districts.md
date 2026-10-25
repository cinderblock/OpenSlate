# Sub-county races: put each on the ballots of the voters who have it

## Goal

My ballot lists every school board, water district and supervisor race in a
voter's county, because county registrars' ballot listings file them under the
county (`us/ca/orange-county`). Seen 2026-10-24 for a Huntington Beach voter:
111 races, 63 of them county-wide sub-county contests; the real ballot is about
50 (ISSUES.md, "My ballot lists every school, water and supervisor race in the
county"). The user: "fix this now" (2026-10-24).

Fix: say where each sub-county contest is decided, find the voter's school
district (and later supervisor district etc.) from the boundaries the map
picker already uses, and show what we can't place in a separate "Might be on
your ballot" section instead of on the ballot.

## Environment / context

- OpenSlate worktree `C:\Users\camer\.t3\worktrees\OpenSlate\fix-sub-county-districts`,
  branch `fix/sub-county-districts`, from local master `d05f906` (includes the
  ISSUES.md entry `d8f0914`).
- Data repos (shared checkouts, other threads work in them):
  - `C:\Users\camer\git\Personal Projects\openslate-public-endorsements`:
    registrar ballot listings `orgs/<registrar>/2026-11-03/positions.json`,
    signed in CI. At the start it was ahead 2 / behind 7 of origin with another
    thread's untracked `orgs/sd-green-party/`; leave that alone.
  - `C:\Users\camer\git\Personal Projects\openslate-ballot-ca-2026-11-03`:
    voter guides. Guide items attach to races by subject key, so they need no
    change.
- Repro scripts (not committed): `%TEMP%\hb-ballot\count.ts`, `collate.ts`,
  `noarea.ts`. Run from `apps/web` with `bun <script>`. A Huntington Beach
  point (-117.998, 33.668) → CD 42, SD 36, AD 72, CoA 4, localities
  `us/ca/huntington-beach` + `us/ca/orange-county` → 111 races, 63 on
  `us/ca/orange-county`; 48 without them.
- Ballot listings' county-wide counts: OC 164 positions, LA 376, Santa Clara 136,
  Alameda 112; San Diego files county and city both as `us/ca/san-diego` (677).
- Checks: `bun run typecheck`, `bun test`, Biome with a CRLF config copy
  (ISSUES.md: lint fails on Windows line endings), `bun run build`.

## Decisions already made (don't re-ask)

- **Subject identity doesn't change.** `subjectKey` is (title, jurisdiction,
  election); it keys races, saved picks and `adopts`. Re-filing races under a
  narrower jurisdiction would split them from every endorser's slate. So:
- **New optional `Subject.district`** (SPEC §3.3, changelog §10.1): a
  jurisdiction-style path naming the electorate when it is narrower than
  `jurisdiction`. Not part of identity. Ballot listings set it; collation takes
  it from a ballot source first, else any slate. The schema is closed (§3.8),
  so the app ships before any slate uses the field.
- **Path segments:** `fam-id` is a district of family `fam` scoped to the path
  before it (`us/ca/boe-2`, `us/ca/unsd-17760/ta-4`,
  `us/ca/orange-county/sup-4`); anything else is a locality slug
  (`us/ca/irvine-ranch-water-district`).
- **Placement is three-way** against the voter's Area: *in*, *out*, *unknown*.
  A family segment compares with `area.districts["<prefix>/<fam>"]` when set
  (`"none"` = known to be in none); unset → unknown. A slug segment continues
  when the area lists that locality, else unknown. *In* races show as now,
  *out* are hidden, *unknown* go in a "Might be on your ballot" section that
  says why.
- **School districts from Census TIGER** (unified `unsd`, elementary `elsd`,
  secondary `scsd`; 5-digit LEA ids from the GEOID; `"none"` when the point is
  in none of a family), set by the map/location/address lookups.

## Plan / steps

1. [x] **Core + spec:** `district` on Subject (zod, JSON schema export, SPEC
   §3.3 and §10.1, a positive vector). `ddb4072`
2. [x] **App placement:** a `placeDistrict(path, area)` helper (tri-state) in
   `jurisdictions.ts`; collation carries `district` and a placement; My ballot
   renders the unknown ones in their own section. `bac1ff9`
3. [x] **School district boundaries:** `scripts/build-geo.ts` adds TIGER
   unsd/elsd/scsd layers (in their own file if size warrants); `locate` and
   `areaFromHit` set the families; the found summary names the districts.
   `76b917c`
4. [ ] **Registrar listings:** ← current tag each sub-county contest with `district`
   (school district by LEA id, trustee area as `/ta-N`, supervisors as
   `<county>/sup-N`, water/special districts by slug). OC first, then LA,
   Santa Clara, Alameda, San Diego, SF. BOE districts on the Secretary of
   State's listing (`us/ca/boe-N`).
5. [ ] Ship order: app first (deployed, verified), then the re-signed slates.
6. [ ] Later phases: supervisor and BOE boundaries; community college
   districts; water service areas; San Diego's city/county path collision (an
   identity change, its own task).

## Findings / gotchas

- `subjectKey` = `subject.id ?? t:<title>|j:<jurisdiction>|e:<election>`
  (`apps/web/src/lib/subjects.ts`).
- With no area set the Nov 3 catalog collates to 1,941 races; the wizard's
  "Loading endorsements… N of M" counts slates (346 live), not races.
- Previous spec addition to copy: `26b5cc1` (SPEC, `schema.ts`,
  `scripts/export-schema.ts`, `scripts/vectors-source.ts`, `vectors/`).

- District segment grammar (SPEC): `<family>-<id>`, family lowercase letters,
  id digits or ONE letter (Cypress SD's trustee areas are lettered); ids that
  are digits compare as numbers. Anything else is a place slug.
- `Race.maybe` is optional (`true` when unknown) rather than a required
  placement field, so other threads' Race fixtures don't break on merge.
- Maybe races: excluded from counts and focus mode, shown only under the
  "All" filter, collapsed; ones you've marked still print and export.
- TIGERweb layers: unsd 14, scsd 16, elsd 18; 346 / 112 / 517 CA features;
  GEOID = `06` + 5-digit LEA code. Names repeat across counties (two "Ocean
  View Elementary School District": 28170 OC, 28140 Ventura), so map
  contests to ids by county, never by name alone.
- Boundary file 1.76 → 2.90 MB (gzip 594 → 988 KB, brotli 480 → 763 KB);
  decode 105 → 129 ms in Bun. `--check`: 6/13/3 of 20,000 random city points
  differ from full resolution for unsd/elsd/scsd (cd 5, ad 7).
- Census truth (geocoder `geographies/coordinates`, layers 14,16,18) for HB
  (-117.998, 33.668): HB City Elementary 18030 + HB Union High 18060; SF City
  Hall: SFUSD 34410; LA City Hall: LAUSD 22710; Irvine: IUSD 84500. The
  shipped file agrees (test/geo.test.ts).
- The Census address relay (`apps/poll-cache/src/geocode.ts`, deployed) only
  returns cd/sd/ad/county/place; rather than redeploy it, Census matches take
  school districts from the shipped file at the matched point.
- The PWA caches `/geo/` stale-while-revalidate: a returning map user gets the
  old file (no school layers) once. Then `GeoHit.schools` is undefined, no
  school family is set, and school races read as maybe: safe.
- The service worker precaches the app (`registerType: autoUpdate`), so after
  deploying, wait for clients to update before publishing slates with
  `district` (old clients reject them: closed schema).

## Progress log

- [x] Diagnosed and logged in ISSUES.md (`d8f0914`).
- [x] Steps 1–3 (2026-10-24 PDT): typecheck, 473 tests, Biome (CRLF copy;
  only the 3 pre-existing errors), build all pass.
- [ ] Step 4 (registrar listings), 5 (ship), 6 (later phases).

## Open questions for the user

None yet.

## Things not to do

- Don't change any subject's title or jurisdiction to fix placement.
- Don't publish slates with `district` before the app that accepts it is live.
- Don't touch other threads' work in the shared checkouts (`git status` first;
  commit with explicit paths).
