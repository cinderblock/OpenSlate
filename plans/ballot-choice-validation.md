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

- **Phase 1 added no candidate ID; phase 2 does** (the user's call,
  2026-10-23, see below). `Subject.id` exists in the spec for races but no
  published bundle sets it (0 of 11,148 positions on 2026-11-03). Candidates
  were identified only by the `choice` string within a race.
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
- Phase 2: `bun run lint` still fails on CRLF files (ISSUES.md). To lint
  changed files, copy `biome.json` with `formatter.lineEnding: "crlf"` to a
  temp dir and run `biome check --config-path=<dir> <files>`. New files
  written LF pass the default config.
- `apps/web/tsconfig.json` includes only `src`, so `tsc` doesn't check test
  fixtures; `bun test` is what catches them.
- The web's `openFeedback` is used as `onClick={openFeedback}`, so it can't
  take arguments (it would get the click event). The prefilled version is a
  separate `reportFeedback(kind, message)`; the prefill is read, not taken,
  so StrictMode's double-run initializers see it, and cleared on open/close.

## Progress log

- [x] Investigate: no candidate IDs, so match on title and choice; measure the current failures
- [x] names.ts + tests (`b0455d2`)
- [x] ballot.ts + tests (`b0455d2`)
- [x] normalize-choices on the shared matcher (`b0455d2`); 71 edits applied (`6fb9c52`)
- [x] verify-positions gate, plus CI test steps in verify.yml and publish.yml, and README (`531a90a`)
- [x] Scraper skill step 4b (OpenSlate)
- [x] ISSUES.md entry marked fixed, pending push
- [ ] Push openslate-public-endorsements (publishes to Pages: needs the user's go-ahead), then remove the ISSUES.md entry

## Phase 2: candidate ids, write-ins, import translator (started 2026-10-23)

The user answered the open questions on 2026-10-23: "We don't have users yet
really. This is a good time for a spec change. Include a translator if you
can. Or at least a detector and tell people to tell admin if the import
doesn't work. We do need to support write-ins."

Work happens on branch `feat/choice-ids` (its own worktree), then the
endorsements repo follows with a `.openslate-version` bump.

### Design (decided)

- **Spec (v1, amended in place like the 2026-05-31 change; still unadopted):**
  - `Position.choice_id` (string, optional): the catalog id of the chosen
    candidate or option, source-namespaced like `Subject.id`. Compared only
    within one subject. `choice` is required when `choice_id` is present, so a
    slate stays readable without the catalog.
  - `Position.write_in` (`true`, optional; `false` is invalid, omit it): the
    choice isn't printed on the ballot and has to be written in. Requires
    `choice`.
  - New §3.11 *Choice identity*: equal `choice_id` = same choice. Without
    one, a consumer holding a ballot listing SHOULD resolve the name against
    it, MUST NOT treat a mere resemblance (typo distance) as certain, and
    SHOULD show a name it can't resolve as unmatched, never silently as
    another candidate.
  - New §3.12 *Write-ins*: a listing MAY list certified write-in candidates
    with `write_in: true`. A write-in for a name the listing doesn't certify
    is shown with a warning that it may not be counted, but still shown.
  - New §8.2 *Ballot listings*: formalises the existing convention (an
    `election-authority` slate, one `neutral` position per choice, the ballot
    designation in `statement`), now with a `choice_id` on every choice.
  - §8.1 gets the listing id prefixes (`ca-sos:`, `sf-elections:`); §4 notes
    the one boolean; §10.1 changelog. Old verifiers reject the new fields
    (closed schema), so **the web app must deploy before the endorsements
    repo publishes slates that use them.**
- **Ids** are readable slugs, `<prefix>:<election>/<race-slug>/<choice-slug>`,
  minted once by the endorsements repo and never changed afterwards (a
  spelling correction keeps the id). Measures' Yes/No get ids too.
- **Races keep `(title, jurisdiction, election)` identity.** Setting
  `Subject.id` on listings would split every race from the id-less
  endorsements and change every race key in the app; the gate already
  enforces exact titles (0 mismatches). Open question 1.
- **The name matcher moves into `@openslate/core`** (`names.ts`, plus a
  `ballot.ts` resolver) so the web app's translator and the endorsements gate
  share one implementation.
- **Web app translator** runs over the decoded slates (`useDecodedSlates`):
  a position whose `choice_id` or name resolves surely to a listed choice is
  shown under the listing's spelling; the signed payload is untouched, the
  rewrite is in memory only. Anything else stays as written and is flagged.
- **Detector:** a race's choice that isn't on its listing (and isn't a
  write-in) is tagged "Not on the ballot", with a link to report it through
  the existing feedback dialog ("Wrong information"). Importing a slate with
  such names shows a notice saying so, with the same report link.
- **Voters can write in a name** on My ballot; their own slate marks it
  `write_in: true`.
- **Endorsements repo:** listings get `choice_id`s; `normalize-choices
  --apply` writes `choice_id` on every endorsement it resolves; the gate
  requires a listed `choice_id` (or `write_in: true`) in covered races.

### Phase 2 progress

- [x] Spec text (SPEC.md §3.4, §3.11, §3.12, §4, §8.1, §8.2, §10.1), schema,
      JSON Schema `dependencies`, vectors (+2 negatives) (`26b5cc1`)
- [x] Core `names.ts` + `ballot.ts` (`resolveChoice`), with tests (`6eb1f3d`)
- [x] Web: `translateSlates` in `useDecodedSlates`; ChoiceGroup `writeIn` /
      `suggestion`, Race `unlisted`; `reportFeedback` prefill (`304f7da`)
- [x] Web: "Not on the ballot" / "Write-in" tags with Report it; My ballot
      notice; per-entry line in the catalog browser (`4eac74d`)
- [x] Web: voter write-in on My ballot; Compose signs `write_in` and the
      listing's `choice_id`; print and export carry it (`e8064d6`)
- [x] Repo checks: `bun run typecheck` clean, `bun test` 380 pass; README
      (`25b8b92`). Checked in the running app (port 5291, live catalog):
      CAGOP's "Don Wagner" lands on "Donald P. (Don) Wagner"; CAGOP's
      "David Liu" (AD-49) is tagged Not on the ballot with "Long David Liu"
      suggested, and its Report it opens the dialog prefilled; a write-in
      shows "Write-in, not certified"; writing in "Shirley Weber" picks the
      printed Shirley N. Weber instead.
- [ ] Scraper skill: `choice_id` / `write_in` in step 2 and 4b
- [ ] Endorsements repo: ids on listings, ids on endorsements, gate on ids,
      `.openslate-version` bump (after OpenSlate is pushed)
- [ ] Certified write-in lists in the listings (CA SoS publishes one late
      October)

## Open questions for the user

1. Races: give listings a `Subject.id` too? Recommendation: not now (see
   Design). Revisit with a translator for race titles if a second catalog
   appears.
2. Push order: OpenSlate (web app) has to deploy before the endorsements repo
   publishes slates with `choice_id`, or the live app rejects them. Needs the
   user's go-ahead for both pushes.

## Things not to do

- Don't apply fuzzy (typo-distance) matches automatically. They're
  suggestions for a human.
- Don't rewrite an election authority's own list. It's the reference.
- Don't touch `orgs/sd-green-party/` (another thread's uncommitted bundle).
