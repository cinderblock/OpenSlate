# Ballot order checked against a real San Mateo County ballot

`plans/ballot-order-san-mateo-check.md` (follow-up to `plans/ballot-order.md`)

## Goal

The user filled out their real ballot with the app on 2026-11-03 (election day)
and found the order "mostly in order, but many things were not." Make My
ballot and the printed ballot follow the paper ballot's order.

## Environment / context

- Voter: San Mateo County, CD 16, AD 23 (SD 13: no Senate race this year).
- Race order: `compareRaces` in `apps/web/src/lib/collate.ts:606` sorts
  jurisdiction first (`jurisdictionRank`: state 1, districts 2, local 3), then
  offices / retention / measures, then `officeRank` (§13109), then title.
- Retention questions: `ballotOrderFor` returns `undefined` for them, so each
  judge is its own race, sorted by title ("… Retain Justice <First Last>"),
  i.e. by first name.
- Data: SoS listing `openslate-public-endorsements/orgs/ca-secretary-of-state/2026-11-03`
  carries `ballot.heading` per judge ("For Presiding Justice, Court of Appeal,
  First District, Division Two"). San Mateo listing
  `orgs/san-mateo-county-elections/2026-11-03` (script `scripts/smc-elections-ballot.ts`).

## The real ballot (from the user, 2026-11-03)

Section order:

1. Governor (statewide offices)
2. Congressional District 16
3. Assembly District 23
4. Associate Justice of the Supreme Court
5. Court of Appeal District 1
6. Superintendent of Public Instruction
7. Measures (state propositions)
8. Bay Area RTM
9. Measure V (San Mateo County Community College District)
10. Measure L (county)
11. Measure AA (county)
12. Measure J (county)
13. Measure U (county)

Court of Appeal, First District:
Wilson, Smiley, Banke (Div. 1); Stewart (PJ), Desautels (Div. 2); Petrou,
Rodriguez (Div. 3); Brown (PJ, Div. 4); Chou, Simons, Burns (Div. 5).

## Findings

- **Judges**: the printed order is division by division, the presiding
  justice first, then associates by the drawn alphabet
  (`HXKWCPJOZALDNSQBIRYGVEFMTU`: W < S < B; P < R; C < S < B all check). The
  app sorts them by first name. Supreme Court by the same rule would be
  Groban, then Evans (G before E in the drawing).
- **Sections**: the paper ballot is ordered by office type across
  jurisdictions: partisan offices, Congress, Legislature, judges, SPI (school
  section), then all measures, state first. The app groups by jurisdiction,
  so Supreme Court, SPI and the props all sit in "California" ahead of
  Congress and the Assembly.
- **Local measures**: L, AA, J, U is not letter order. It matches the order
  the county's current-election page lists the county measures in
  (`evidence/documents.json`). The SMCCD bond (V) and RTM come before them on
  the ballot, but after them on that page, so the page order alone isn't the
  ballot order. Contest codes (M206, M307 …) don't sort into ballot order either.

## Decisions already made (don't re-ask)

1. (User, 2026-11-03) "Being in the order that my real printed ballot is in
   is critical. Do not group things just because they seem together." Printed
   order, display order, focus mode: all the same order. This replaces
   `plans/retention-ballot-order.md` decision 2 (sections per jurisdiction)
   and its Candidates / Judges / Measures subheadings on My ballot and print.
2. (User) A race the voter skips shows as skipped, not hidden: under "Only
   races I've marked" the rest print as one "skipped" line.

## Plan / steps

1. Judges in division / presiding / drawn-alphabet order. Done
   (`lib/ballotSequence.ts` `compareJudges`).
2. Race order across jurisdictions: `lib/ballotSequence.ts`
   (`compareBallotOrder`, `ballotSections`), used by `compareRaces`, My
   ballot, Might be on your ballot, and print. Parts: State offices, Congress
   and Legislature, Judges, School (SPI first), County, City, Districts, then
   State, Regional, School, County, City, District measures. Done.
3. Local measures: San Mateo's order from its drawing document
   (`ballotOrderCounties.ts` `measures`); elsewhere by letter, A–Z then AA.
   Done.
4. Skipped races print as one line. Done.
5. **CD 16 name order** (Soulé above Liccardo on the paper, flipped in the
   app). Cause found (below); rebuild `cd` / `boe` from the official block
   equivalency files. Done: `scripts/ca-district-overlaps/block-equivalency.ts`
   writes `cd` / `boe`; the `*Unsure` lists are gone.
6. Tests, deploy, headless check. Current step.

## CD 16: why the names were flipped

Research agent, 2026-11-03 evening. The rotation rule (`acrossAds`) is right;
the `cd` table drops ADs where a CD has map territory but under 100 residents.
CD 16 shares one census block with AD 21: `060816057003020`, 0.12 km²,
0 residents, Crystal Springs watershed. So CD 16 = [21, 23, 25, 26, 28], AD 23
is index 1, and Soulé leads, as printed. The SoS counts territory, not voters
(SWDB June 2026 precincts show no CD 16 voters in AD 21).

Sources: Prop 50 block file `statewidedatabase.org/pub/data/d25/AB604.zip`;
2021 Assembly block file from wedrawthelines.ca.gov. TIGERweb layer 54 is the
Prop 50 map ("January 1, 2026 vintage"). Join script kept at
`%TEMP%\clsos380\s\join.ts` (temporary).

Wrong in the table (all omissions): CD 4 (+1), 8 (+13), 10 (+14, 18), 11 (+12,
18), 16 (+21), 28 (+34), 30 (+39, 43), 39 (+47), 40 (+73), 50 (+80), 51
(+77), 52 (+77, 78); BOE 4 (+45). The other 40 CDs and 3 BOE districts match.
Caveat: only the zero-population case is proven by a ballot.

County reach (`sdCounties`, `adCounties`) stays people-based. By blocks alone,
SD 2, SD 7, AD 12 and AD 18 would also reach San Francisco, through bay water,
and AD 18 would turn multi-county, giving Alameda County voters Alameda's own
letter order. Alameda's document says only "multi-county legislative
districts"; San Mateo's names AD 19 and 23, both with people in both counties.
A county with no voters in a district prints no ballot for it.

## Progress log

- [x] Diagnosis against the user's ballot
- [x] Judge order
- [x] Section order
- [x] Local measure order
- [x] Skipped races shown, not hidden
- [x] CD / BOE tables from official block files (12 CDs and BOE 4 changed)
- [ ] Deploy

## Open questions for the user

(none open; the section question was answered: paper ballot order, strictly.)

## Things not to do

- Don't sort local measures by letter: San Mateo's ballot doesn't.
