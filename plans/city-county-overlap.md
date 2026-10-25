# City and county paths that overlap

## Goal

Every city and county race should be filed under a path that means one place,
and My ballot should give each voter every path that's theirs. Today some
county races sit under a city's path (or a city's under the county's), and the
app picks only one of a place's spellings. So some voters get another place's
races and others miss their own. Seen first in San Diego (ISSUES.md, split out
of `plans/sub-county-districts.md`). The user asked on 2026-10-25 to "keep going
on overlap issues". The election is Nov 3.

## Environment / context

- App: OpenSlate, this thread's worktree
  `C:\Users\camer\.t3\worktrees\OpenSlate\fix-sub-county-districts`, branch
  `fix/city-county-overlap` (from origin/master `4d07256`).
- Catalog: openslate-public-endorsements, worktree
  `C:\Users\camer\.t3\worktrees\openslate-public-endorsements\fix-city-county-overlap`,
  branch `fix/city-county-overlap` (from origin/master `7623d18`). Its main
  checkout is another thread's (ahead 3, behind 16): leave it alone.
- Voter guides: openslate-ballot-ca-2026-11-03 (`county/sd/items/*.json` and
  `guide.json` carry 99 `us/ca/san-diego` subjects). Main checkout, even with
  origin.
- Survey scripts: `$TEMP/hb-ballot/survey-overlap.py`, `survey-misfiled.py`.
- Path conventions: counties `us/ca/<name>-county`, cities `us/ca/<name>`
  (sometimes `city-of-<name>`), San Francisco `us/ca/sf`.
- The app's place lookup: `localityCandidates` and `areaFromHit` in
  `apps/web/src/lib/geo.ts`. A county falls back to the bare name when
  `<name>-county` isn't in the catalog; a city tries `<name>` then
  `city-of-<name>`; only the first one the catalog uses is kept.
- Subject identity is `title|jurisdiction|election` (no ids), so re-filing a
  race changes its key. Marks (`openslate.ballotDraft.v1`, rankings) are keyed
  by it. The area (`openslate.area.v1`) stores locality paths only, and only the
  ones the catalog used at lookup time.

## Findings from steps 1 and 2

- Rewriting bundles with `JSON.stringify` reformats hand-formatted ones
  (`courage-california` went +4372 lines). Edit as text
  (`scripts/position-edit.ts`'s `positionSpan`); the re-file is then
  line-for-line.
- LA's college board (and LAUSD in June) sat under the City of Los Angeles.
  The listing built them under the county, but its subject matcher reused the
  org bundles' misfiled subject. The matcher now skips misfiled subjects.
- Once under the county, Sierra Club San Diego's "San Dieguito … Area 3/5"
  were checked against the ballot for the first time and failed: the ballot
  says "Trustee Area". Renamed.
- Bundle contexts only move for San Diego: elsewhere a bundle scoped to a
  city's path really is the city's (LA Forward, the SB Independent).
- The guide items take their subjects from the ballot sources, so a sync
  script there (match by title) beats copying the rule into a third place.

## Findings (survey of the catalog at `7623d18`, 2026-10-25)

24 counties share a name with a city. Problems found:

| Path | What's there | Effect |
| --- | --- | --- |
| `us/ca/san-diego` | ~110 county subjects and the City of San Diego's (council D2/4/6/8 in November; Measure A was June's), no `san-diego-county` at all | the county is filed under the city's name, so everyone in the county got the city's races (as maybes in November) |
| `us/ca/alameda` | 9 county subjects (BoS, AC Transit, Oro Loma, Zone 7, Superior Court); the City of Alameda is under `city-of-alameda` | county residents never see the 9 (their county is `alameda-county`); City of Alameda residents get the bare path and so miss their mayor, council and measures |
| `us/ca/imperial` | 4 county subjects; the city is `city-of-imperial` | same as Alameda |
| `us/ca/orange` | City of Orange, plus "Orange County Board of Supervisors, District 5" | D5 only shows to City of Orange residents |
| `us/ca/santa-barbara` | City of Santa Barbara, plus 3 county offices | same |
| `us/ca/contra-costa`, `us/ca/marin` | county subjects (3 and 1) | nobody gets them: the county is `-county` |
| `us/ca/ventura` | City of Ventura council | the Census calls it "San Buenaventura (Ventura)", so nobody gets them |
| `us/ca/paso-robles` | Paso Robles council | Census: "El Paso de Robles (Paso Robles)", same |
| `us/ca/san-dieguito-uhsd` | a school board filed as a locality | nobody gets it |

Also cross-county races filed twice: EBRPD wards 3 and 5 (`alameda-county` from
the registrar, `ebrpd` from orgs) and Fullerton JUHSD TA 1 and 5 (LA's and OC's
registrars).

Who files them: registrar listings (`sd-rov-ballot.ts` deliberately files the
City of San Diego under the county's `COUNTY`, Alameda and OC listings too) and
org bundles that reused the listings' subjects.

## Decisions already made (don't re-ask)

- Keep going in this thread, not a new one (the user offered either).
- Other threads' commits riding along on a push are fine (user, 2026-10-25).

## Plan / steps

1. **Catalog re-file** (endorsements repo): one script with an explicit table
   (old path + title rule → new path), applied to every `positions.json`
   (`subject.jurisdiction`, `context.jurisdiction`, and `district` paths under
   the old path). San Diego: everything to `us/ca/san-diego-county` except the
   city's titles. Alameda, Imperial, Orange, Santa Barbara, Contra Costa,
   Marin: county subjects to `<name>-county`. San Dieguito to San Diego County.
   Then fix the listing scripts so a rebuild agrees, re-run assign-districts,
   and add a verify check (county titles under a bare path; bare county names
   with no same-named city).
2. **Voter guides repo**: the same re-file for its San Diego subjects (and
   whatever else matches), and its scraper.
3. **App**:
   - `localityCandidates`: a county's bare name only when no city shares it;
     a Census "A (B)" name tries B too; keep every candidate the catalog uses,
     not the first.
   - Re-key marks and rankings whose race was re-filed (same election and title,
     one race left with that title).
   - Saved areas: a load-time migration (an area with an old county path gains
     the new one, and its `sup` family moves), plus a notice to look up again
     where it can't tell city from county (the bare `san-diego` only).
   - Store what a lookup found (place and county names), so localities follow
     the catalog from now on instead of freezing at lookup time.
4. **Ship**: app first (so marks and areas migrate), then the catalog and the
   guides, each checked live.
5. Cross-county duplicates (EBRPD, Fullerton JUHSD): decide after 1 to 4.

## Progress log

- [x] Survey (2026-10-25).
- [x] Step 1, catalog re-file (2026-10-25, branch `fix/city-county-overlap`,
  not pushed): `2bf1066` rule, check, script, listing fixes; `c915f02` the
  re-file itself (143 subjects, 707 positions, 66 bundles, both elections);
  `91c4694` guides.json. Verify 376 OK, 36 tests pass. SD, Alameda and OC
  listings rebuild byte-identical; LA's rebuild renames four seats, but so
  does master's (logged in that repo's ISSUES.md; fixed later that day by
  its `0847c47`, see `plans/listing-rebuild-renames.md` there).
- [x] Step 2, guides (2026-10-25, branch `fix/city-county-overlap`, not
  pushed): `68e0920`, `scripts/sync-subjects.ts` (103 items plus the SD
  guide's context). `bun run check` passes for all 8 guides.
- [x] Step 3, app (2026-10-25, `fe84aac`): candidates, `found`,
  `upgradeArea` with the "Do you live in the City of …?" question (shown only
  once the county's path is in use), `refiledRows`. 515 tests, lint and
  types pass. Checked in a dev server against the live (old) catalog: a
  Chula Vista lookup stores `found` with `san-diego-county`; an old
  `["us/ca/san-diego"]` area reads as San Diego and San Diego County.
- Ship order: app, then catalog and guides at once. Between the two, a *new*
  San Diego County lookup gets no county races (the app no longer takes the
  city's path for the county, and the old catalog has nothing else); they
  arrive by themselves when the data lands (`found`). Data first would hide
  county races from every *saved* SD area instead, so app first.
- [x] Step 4, ship (2026-10-25): app `c873159` pushed 12:53 PM PDT
  (19:53Z) and live; catalog `df24caf` and guides `68e0920` pushed 12:54 PM
  PDT, both publish runs green by 12:55. Checked live on openslate.us in a
  fresh incognito tab: an old `["us/ca/san-diego"]` area with a mark on the
  old Alpine USD race reads "San Diego · San Diego County", asks "Do you live
  in the City of San Diego?", and the mark moved to the `san-diego-county`
  key (it prints). "No" drops the city and its four council maybes (110 to
  106) and keeps supervisorial district 2 under the county's path. A new
  Chula Vista lookup gets Chula Vista and San Diego County, nothing of the
  City of San Diego's.
- [x] Step 5 (2026-10-25): EBRPD wards 3 and 5's org endorsements moved onto
  Alameda's listed races (`5439a18`, published 12:59 PM PDT). Ward 7 (Contra
  Costa, no listing) and Fullerton JUHSD's LA and OC copies need a subject
  for races that cross a county line: logged in the endorsements repo's
  ISSUES.md, not fixed.
- [x] ISSUES.md: the San Diego entry removed (fixed).
- [x] Step 5, done properly (2026-10-25, user: "keep going"): a school
  district that crosses a county line is one race under its county of record
  (`homeCounty`: the Census district's county, CDE's for Center JUSD and
  Lowell Joint, where the area heuristic was wrong). Catalog `43e31d6`
  (Fullerton JUHSD TA 1/5, Rowland USD TA 5, Paso Robles Measure G-26, EBRPD
  ward 7 under Contra Costa with its ward district); app `ed5e0ef` (a
  district segment that matched the user's area outranks the filing county,
  so the LA side of Fullerton still gets the race as a maybe); guides
  `e78dc51`. Cross-county entry removed from the catalog's ISSUES.md.
  Shipped 1:28–1:30 PM PDT (20:28–20:30Z), all three publishes green.
  Checked live: a La Habra Heights (LA County) lookup lands in Fullerton
  JUHSD and Lowell Joint, and My ballot's maybes now carry an "Orange
  County · 6" group: Fullerton TA 1 and 5 with both candidates each, Lowell
  Joint TA 4 and the North Orange County CCD seats.

## Open questions for the user

None. LA's listing rebuild renaming four seats (it did so again during
step 5; I reverted that part rather than ship renamed ids by accident) was
fixed afterwards in the endorsements repo (`0847c47`: a listing keeps its own
last build's titles when no other bundle names a contest).

## Things not to do

- Don't move the county back under a bare name to save churn: every other
  county uses `-county`, and the app's lookup depends on it.
- Don't touch the endorsements repo's main checkout (another thread's).
