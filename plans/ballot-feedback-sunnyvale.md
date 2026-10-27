# A friend's ballot feedback (Sunnyvale)

`plans/ballot-feedback-sunnyvale.md`

## Goal

User relayed a friend's report (2026-10-26), a Sunnyvale voter:

1. "You need a link to the SOS measure text for all the measures, especially the
   local ones."
2. "I can't get any info on Sunnyvale Measure G, H & I with any of the links you
   provide."
3. "The council seat races with district maps vs at-large candidates, while
   correct for my address, did pull up the other 3 districts that I'm not in as
   things that might be on my ballot."
4. "There isn't a button for 'this isn't on my ballot'."
5. "Similarly for things in the maybe section, there is no way to promote it up
   to 'on my ballot'."

## Environment / context

- Worktree `C:\Users\camer\.t3\worktrees\OpenSlate\fix-ballot-feedback`, branch
  `fix/ballot-feedback`, from `origin/master` `5cc657c`. The main checkout is
  another thread's (local master ahead 2 / behind 16, untracked
  `ballotAgent.ts`, `plans/webmcp.md`): leave it alone.
- Data: the Santa Clara voter guide (`openslate-ballot-ca-2026-11-03`,
  `county/santa-clara/items/sunnyvale-measure-{g,h,i}.json`) is live and listed
  in the catalog's `guides.json` (covers `us/ca/sunnyvale`). Each item has the
  question, Yes/No meanings, the City Attorney's impartial analysis, the full
  text and the arguments. Its `source` is OmniBallot's published JSON
  (`ca.omniballot.us/published/06085/1968/vg/728_md.json`), not a page a person
  can read.
- The Santa Clara ballot listing (catalog `origin/master`) files the council
  races with `district: us/ca/sunnyvale/council-{1,3,5}`.
- Placement: `placeRace` in `apps/web/src/lib/jurisdictions.ts`. A district
  segment `council-3` looks up `area.districts["us/ca/sunnyvale/council"]`;
  no lookup layer sets that family (`LOOKUP_LAYERS` in `lib/geo.ts`: school,
  BOE, college, supervisorial), so all three are "unknown" → "Might be on your
  ballot" (`MyBallotPanel.tsx`).
- Read up links (`lib/researchLinks.ts`): "Official guide" only for statewide
  (`us/ca`) races; for a local measure the card offers Ballotpedia, CalMatters
  and news searches only. The guide's content is shown only on the race page
  (`RacePanel.tsx`: `GuideOverview`, `GuideDetails`), which the card links to
  only through its heading.

## Root causes

- (1, 2) The app has the official text of every measure a county guide covers,
  but My ballot never says so: no link on the card points at it, and the guide
  item's own `source` link is raw JSON for Santa Clara.
- (3) Nothing can place a voter in a city council district, so every district
  race of the voter's city is a maybe, their own included.
- (4, 5) The maybe section has no way to answer "is this on my ballot?".

## Plan / steps

1. **Answers on the area** (`Area.answers`, district path → on my ballot yes/no),
   applied by `placeRace`. "Yes" on `us/ca/sunnyvale/council-3` also says the
   voter's council district is 3, so councils 1 and 5 leave the ballot. "No"
   rules out that district only. Pure helpers + tests in `jurisdictions.ts`.
   Kept by `mergeFoundArea`; a lookup's own district for a family wins over an
   answer.
2. **Buttons on maybe races**: "On my ballot" / "Not on my ballot", undo notice,
   and a line to bring back races answered "no".
3. **Official guide link on the card**: when a loaded guide lists the race, Read
   up leads with "Full text and arguments" (measures) or "Candidate statements"
   (races), to the race page's guide (`#official`, scrolled to once it loads).
   The external SOS "Official guide" link for propositions stays beside it.
   A passage whose `source` is a data file (`.json`/`.xml`) is labelled
   "Source data", and the overview drops its "Read it in the guide" link.
4. Check the friend's flow in the browser (Sunnyvale address), tests, typecheck,
   lint touched files, README, commit.

## Findings / gotchas

- (false alarm) Python's default cp1252 decoding made the Santa Clara items look
  mojibake'd (`Â§`); read as UTF-8 they are clean (`§ 1309`), live too.

- Browser check 2026-10-26 ~8:55 PM PDT (03:55Z Oct 27), dev server :5297,
  fresh profile, area Sunnyvale, CADEM followed: before the fix, Sunnyvale
  council 1/3/5 were all under Might be; Measure G's card offered only
  Ballotpedia · CalMatters · News; the race page's "Read it in the guide"
  opened OmniBallot JSON. After: *On my ballot* on District 3 moved it up
  (with "On your ballot because you said so · Not sure after all") and took
  1 and 5 off; Undo restored all three; *Not on my ballot* on District 1 hid
  it with "One you said isn't on your ballot is hidden · Show it again",
  which brought it back. Measure G's card leads with "Full text and
  arguments", landing scrolled to the guide; Prop 1 shows that plus SOS's
  "Official guide".

## Follow-ups (in ISSUES.md, not this task)

- No lookup places a voter in a city council district (boundary data per city).
- Local measures in counties without a voter guide have no official text.

## Progress log

- [x] 1. Area answers (`jurisdictions.ts`, tests)
- [x] 2. Maybe buttons (`MyBallotPanel.tsx`)
- [x] 3. Official guide link (`guides.ts` `useGuideListed`, `RacePanel`, `GuideContent`)
- [x] 4. Browser check, typecheck, 620 tests, Biome (CRLF) on touched files, README
- [x] 5. Commit `43c5f2c` on `fix/ballot-feedback`
- [ ] 6. Push to `origin/master` (deploys openslate.us): waits on the user

## Open questions for the user

1. Push `fix/ballot-feedback` to master so it deploys? Recommendation: yes;
   it's a fast-forward of `origin/master` `5cc657c` by one commit.

## Things not to do

- Don't touch the main checkout or the endorsements repo's main checkout.
