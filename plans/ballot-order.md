# Candidates in the order the voter's ballot prints them

`plans/ballot-order.md`

## Goal

The user (2026-11-02, the night before the November 3 election): "It's
important to be able to put the options in the same order" as the actual
ballot. Today the app lists a race's candidates in the order the ballot source
lists them, which for the Secretary of State's certified list is plain
alphabetical, and nobody's real ballot.

## Environment / context

- Web app `apps/web`. Candidate order within a race: `collate.ts`
  (`ballotOrder`, filled from ballot-source slates in listing order).
  Race order: `compareRaces` (jurisdiction rank, offices / retention /
  measures, then title alphabetically).
- The voter's districts: `Area.districts["us/ca/ad"]`, `["us/ca/cd"]`,
  `["us/ca/sd"]`, `["us/ca/boe"]` (jurisdictions.ts).
- SoS ballot listing: `openslate-public-endorsements/scripts/ca-sos-ballot.ts`
  from `cert-list-candidates.pdf`, alphabetical (Governor: Becerra, Hilton).
- Geo: `apps/web/scripts/build-geo.ts`, TIGERweb `tigerWMS_Current` layers
  54 (120th CDs, the Prop 50 lines), 56 (2026 SLDU), 58 (2026 SLDL), 82
  (county); BOE from services.gis.ca.gov.

## The law (Elections Code §13111, §13112)

Fetched 2026-11-02 from law.onecle.com (leginfo.legislature.ca.gov blocks
scripted fetches) and the SoS randomized-alphabet page.

- **Randomized alphabet** for 2026-11-03, drawn by the SoS 2026-08-13:
  `H X K W C P J O Z A L D N S Q B I R Y G V E F M T U`
  ([release](https://www.sos.ca.gov/administration/news-releases-and-advisories/2026-news-releases-and-advisories/california-secretary-state-shirley-n-weber-phd-announces-results-randomized-alphabet-drawing-november-3-2026-general-election)).
  Applied to the whole name, last name first, then first name, then middle,
  letter by letter.
- (c) **Statewide offices**: the alphabet's order in AD 1; each following AD
  moves the first name to the bottom. So the order in AD n is the AD 1 order
  rotated by n − 1.
- (d) **Congress and Board of Equalization**: the alphabet's order in the
  lowest-numbered AD where the race is voted on, then rotating through each
  following AD in which it is voted on. So the offset is the voter's AD's
  index among the ADs the district touches.
- (e) **State Senate and Assembly**: the alphabet, no rotation, when the
  district is within one county. (i) A district spanning counties uses each
  county's own drawing ("county randomized ballot"), which we don't have.
- (f) Offices wholly within one county but not countywide (city, district,
  supervisor): the alphabet, no rotation. (g)/(h) countywide offices rotate by
  supervisorial district (≤ 4 ADs in the county) or by AD (≥ 5).
- (j) Supreme Court / Court of Appeal: the alphabet, no rotation (in November
  these are yes/no retention questions anyway).
- Charter cities (SF, LA, Oakland…) may set their own rules for their own
  offices.

## Decisions already made (don't re-ask)

1. Compute the order on the device from the law, the drawn alphabet and the
   voter's districts. No server, nothing sent anywhere.
2. Where the order can't be known (multi-county legislative districts,
   charter-city offices, no area set), keep the listing's order and say the
   ballot's order may differ, rather than guess.

## Plan / steps

1. Data: CD → ADs, BOE → ADs, which SDs/ADs lie in one county, from TIGERweb
   geometry (`apps/web/scripts/ca-district-overlaps/`, output
   `src/lib/ballotOrderCa.ts`). Done.
2. `lib/ballotOrder.ts`: alphabet compare, rotation, rules per office;
   `test/ballotOrder.test.ts`. Done.
3. Wired into `collate` (`printedOrder` rewrites `ballotIndex`; `orderBasis`,
   `orderNote` on `Race`); `RaceOrderNote` on My ballot and the printed
   ballot says when the order may differ. Done.
4. §13109 office order within a section (`officeRank`, used by
   `compareRaces`). Done.
5. Deploy. ← current
6. Follow-ups (not started): county randomized alphabets for multi-county
   legislative districts; Civic `orderOnBallot`; check against a printed
   sample ballot; local offices.

## Findings / gotchas

- SoS cert list is alphabetical, not AD 1 order: Governor lists Becerra
  before Hilton, but the drawn alphabet puts H first.
- November is top-two for every state office, so most races have two names:
  rotation reduces to the parity of the offset.
- Census `rel2020/cd-sld` relationship files stop at CD119; Prop 50's CD120
  lines aren't there, so the CD → AD table comes from geometry.
- Overlap method: polygon intersection at ~1 m. Pieces narrower than 2 m are
  generalization slivers (all were ≤ 0.5 m; the next widest real piece was
  9.5 m). Every remaining pair was checked against 2020 Census block
  populations (TIGERweb tigerWMS_Census2020 layer 10, POP100 at each block's
  interior point): ≥ 100 people counts, 1–99 is "unsure", 0 is dropped. Unsure
  CD/AD pairs (people): 8/13 15, 10/14 24, 10/18 53, 28/34 11, 30/39 11,
  30/43 25, 39/47 6, 40/73 12, 51/77 3. A voter in an AD at or after an
  unsure one in their CD gets "may differ" instead of a guess.
- A legislative district is multi-county by composition, not population:
  SD 14 reaches 7 people in Tulare and still counts as multi-county. 12 of 40
  SDs and 44 of 80 ADs are within one county; the rest show "may differ".
- The Civic API result only feeds the voter's Area today
  (`civicArea.ts`); its contests aren't matched to catalog races, so
  `orderOnBallot` would need that matching first. Deferred.
- No printed 2026 sample ballot was in the cached county documents (SF's
  pamphlet has no sample ballot; Alameda's guide has only a party-history
  table). The order is checked against the law, not a ballot.
- Retention questions keep title order: §13111(j) orders judicial names by
  the alphabet, but whether that orders separate retention questions isn't
  clear. Measures keep number order (numeric collation).

## Progress log

- [x] Law and 2026 alphabet confirmed
- [x] Overlap data
- [x] ballotOrder.ts + tests
- [x] collate wiring + UI note
- [x] §13109 race order
- [ ] Deploy
- [ ] Follow-up: county alphabets for multi-county SD/AD
- [ ] Follow-up: Civic `orderOnBallot`
- [ ] Follow-up: sample-ballot check
- [ ] Follow-up: local offices (§13111(f), charter cities)

## Open questions for the user

1. Gather county randomized alphabets (each county posts its own drawing) so
   multi-county Senate and Assembly races get an order too? Recommended for
   the biggest counties first; needs the voter's county from the Area.
2. Order local races by the SoS alphabet (§13111(f)) except in charter cities
   with their own rules? Needs a per-city check.

## Things not to do

- Don't trust the cert list's order as anyone's ballot order.
