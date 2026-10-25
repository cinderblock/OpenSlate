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
| `us/ca/san-diego` | ~110 county subjects and 5 City of San Diego ones (council D2/4/6/8, Measure A), no `san-diego-county` at all | everyone in the county gets the city's Measure A; the county is filed under the city's name |
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
  does master's (logged in that repo's ISSUES.md).
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
- [ ] Step 4, ship.
- [ ] Step 5, cross-county duplicates.

## Open questions for the user

None yet.

## Things not to do

- Don't move the county back under a bare name to save churn: every other
  county uses `-county`, and the app's lookup depends on it.
- Don't touch the endorsements repo's main checkout (another thread's).
