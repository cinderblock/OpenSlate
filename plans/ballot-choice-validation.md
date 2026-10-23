# Ballot-choice validation for endorsement bundles

## Goal

Stop an endorsement from naming a candidate in a way that doesn't match the
official ballot, so the same person never shows up as two rows (ISSUES.md:
"Donald P. (Don) Wagner" / "Don Wagner"). Two layers:

1. **A publish gate.** `openslate-public-endorsements` CI (`verify-positions.ts`,
   run on PRs and before signing in `publish.yml`) rejects any position whose
   race is in a jurisdiction an election authority covers but isn't on that
   authority's list, or whose `choice` isn't one of the ballot's names for that
   race. The web app's `/catalog` imports from that published repo by default,
   so nothing off-ballot reaches it.
2. **A check at creation time.** The endorsement-scraper skill runs the same
   check before it stops for review, and the check prints the ballot spelling
   it thinks was meant. A fixer script (`normalize-choices.ts`) rewrites the
   choices to the ballot spelling.

Unit tests (`bun test`) cover the name matcher (Wagner, Schultz, Brookter
cases) and the gate itself, so this can't quietly regress.

## Environment / context

- Endorsements repo: `C:\Users\camer\git\Personal Projects\openslate-public-endorsements`
  (`master`, scripts in `scripts/`, OpenSlate core vendored at `.openslate/`
  pinned by `.openslate-version`). No tests or `test` script existed before
  this work.
- Election authority bundles (`attribution.of.kind: "election-authority"`):
  `orgs/ca-secretary-of-state/2026-11-03/` (us/ca plus every cd-/sd-/ad-
  district jurisdiction) and `orgs/sf-department-of-elections/2026-11-03/`
  (us/ca/sf, BART). The web app treats them as ballot data.
- Scraper skill: `OpenSlate/.claude/skills/endorsement-scraper/SKILL.md`.
- Web app matching: races key on `subjectKey()` (`apps/web/src/lib/subjects.ts`:
  `subject.id` or title|jurisdiction|election); choices group on the exact
  `choice` string (`apps/web/src/lib/collate.ts`).

## Decisions already made (don't re-ask)

- **There is no candidate ID today, and this work doesn't add one.**
  `Subject.id` exists in the spec for races but no published bundle sets it
  (0 of 11,148 positions on 2026-11-03). Candidates are identified only by the
  `choice` string within a race. Within a race, the election authority's exact
  spelling acts as the candidate ID, and the gate enforces it. A real ID field
  would be a protocol change (SPEC.md §3.3/§3.4) and still needs the same
  name-to-ID matching at scrape time, so the validation is needed either way.
  Left as an open question for the user.
- The check lives in the endorsements repo's verify script, not in the zod
  schema. The schema validates one slate; whether a name is on the ballot is a
  cross-file fact. The protocol allows arbitrary subjects and write-ins, so the
  web app must not reject third-party slates on import.
- Races in jurisdictions no authority covers (county/city races: about 1,500
  titles) can't be checked yet. They pass the gate and get counted in the
  output.
- The org's verbatim wording stays in `statement`. `choice` is the normalised
  field, and rewriting it is existing practice (`normalize-choices --apply`).

## Plan / steps

1. Shared name matcher `scripts/names.ts`, taken from `normalize-choices.ts`
   and extended: nicknames in parentheses or quotes (`Donald P. (Don) Wagner`,
   `Nicholas "Nick" Schultz`), and a close-spelling fallback used only to
   *suggest* a ballot name, never applied automatically.
2. Ballot gate `scripts/ballot.ts`: load the authority lists for an election,
   check positions, and report problems with a suggestion.
3. Wire the gate into `verify-positions.ts` (fails CI) and add a `bun test`
   step to `verify.yml` and `publish.yml`.
4. `normalize-choices.ts`: snap choices to the authority spelling with the
   shared matcher, keeping cross-org clustering for uncovered races. Run it on
   the current data (69 positions, 8 names) and review the fuzzy ones by hand.
5. Tests: `scripts/names.test.ts`, `scripts/ballot.test.ts`.
6. Update the endorsements README and the scraper skill (new step: run the
   ballot check before stopping).
7. Close the ISSUES.md entry in OpenSlate.

## Findings / gotchas

- Measured 2026-10-22: every race title in an authority-covered jurisdiction
  already matches the authority list, so the race check can be a hard error
  from day one.
- 69 positions, 8 distinct names, are off-ballot today:
  - Nickname forms the matcher should catch: `Don Wagner` → `Donald P. (Don) Wagner`,
    `Nick Schultz` → `Nicholas "Nick" Schultz`, `DJ Brookter` → `Dionjay (DJ) Brookter`.
  - Need a human to confirm: `Mano Raju` → `Manohar Raju`,
    `David Liu` → `Long David Liu`, and the typos `Annamarie Avila Farias` →
    `Anamarie Avila Farias`, `Gerald Bourisquot` → `Gerald C. Boursiquot`,
    `Andrae Gonzalez` → `Andrae Gonzales`.
- `normalize-choices.ts` only clustered names that two orgs disagreed on, and
  nothing ran it as a gate. Its matcher couldn't see a nickname inside
  parentheses or quotes, so `Don Wagner` never clustered with the ballot name.
- `orgs/sd-green-party/2026-11-03/` is untracked in the endorsements repo.
  It's another thread's work, so leave it alone. The gate will still scan it
  locally.

- 2026-10-23: applying the fixer made 71 edits. 69 were off-ballot choices.
  The other 2 came from the new nickname parsing, which also groups
  `Jocelyn "Joz" Sida` with `Joz Sida` and `Gabriel "Gabe" Teran` with
  `Gabe Teran` on uncovered races, rewritten to the majority spelling. All 18
  suggestions were checked against each race's other names before
  `--suggested`. Every race has one or two names, and the other one is plainly
  someone else (another party, or unopposed).
- The repo's `tsc` wasn't clean before this work: 22 errors remain in
  `adopt.ts`, `ca-sos-ballot.ts` and others, and Biome format errors in
  `build-site.ts`, `fetch-logos.ts` and others. The new and changed files pass
  both. `lib` went to `ES2024` for `Map.groupBy`, which the old
  normalize-choices already used.
- `bun test` with no path would also pick up OpenSlate's own tests under
  `.openslate/`, so the script is `bun test scripts`.

## Progress log

- [x] Investigate: no candidate IDs, so match on title and choice; measure the current failures
- [x] names.ts + tests (`b0455d2`)
- [x] ballot.ts + tests (`b0455d2`)
- [x] normalize-choices on the shared matcher (`b0455d2`); 71 edits applied (`6fb9c52`)
- [x] verify-positions gate, plus CI test steps in verify.yml and publish.yml, and README (`531a90a`)
- [x] Scraper skill step 4b (OpenSlate)
- [x] ISSUES.md entry marked fixed, pending push
- [ ] Push openslate-public-endorsements (publishes to Pages: needs the user's go-ahead), then remove the ISSUES.md entry

## Open questions for the user

1. Add a real candidate ID (for example `Subject`-style `choice_id` minted by
   the authority bundle)? Recommendation: not now. The exact-spelling gate gets
   the same guarantee without a protocol change. Revisit if a second catalog,
   such as VIP ids, starts being used.
2. Write-in candidates: the gate would reject an endorsement for a certified
   write-in, because the authority bundles don't list them. Recommendation:
   add the certified write-in list to the authority bundles when one is
   published, rather than an exception list.
3. Should the web app also flag an imported slate whose choices aren't on the
   ballot (a warning, not a rejection)? Recommendation: yes, as a follow-up.

## Things not to do

- Don't apply fuzzy (typo-distance) matches automatically. They're
  suggestions for a human.
- Don't rewrite an election authority's own list. It's the reference.
- Don't touch `orgs/sd-green-party/` (another thread's uncommitted bundle).
