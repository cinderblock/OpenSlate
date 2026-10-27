# Judicial retention questions sort among the measures

## Goal

A friend's report (2026-10-27): on a California ballot, the Supreme Court
retention questions ("Shall Associate Justice … JOSHUA GROBAN be elected …?")
sit among the propositions, while the Court of Appeal gets its own section.
Retention questions belong with the offices, ahead of the measures, as the
paper ballot prints them (judicial block before state measures).

## Environment / context

- App: `apps/web`. Section/race order is `compareRaces` in
  `apps/web/src/lib/collate.ts`: jurisdiction rank, then offices before
  measures (`subject.kind === "measure"`), then title.
- Data: retention questions are `kind: "measure"` everywhere: the SoS ballot
  listing (`openslate-public-endorsements/scripts/ca-sos-ballot.ts`, judicial
  block) and ~15 endorser slates. Supreme Court ones are filed under `us/ca`,
  so they land in the California section after the statewide offices, but
  among the props by title.
- `kind` isn't part of subject identity (`subjectKey` = id or title|jurisdiction|election).
- `ballot` (SPEC §3.14) is strict in `packages/core/src/schema.ts`; a ballot
  source's `ballot` wins in collate.
- The endorsements repo pins OpenSlate by commit in `.openslate-version`; CI
  clones it to sign and verify.
- Web deploys from `master` via Cloudflare Workers Builds.

## Decisions already made (don't re-ask)

1. **Add `ballot.retention: true`** (SPEC §3.14, core schema) rather than an
   app heuristic. "Listed without a number" misfires: the Santa Clara and San
   Mateo registrar listings give the Bay Area RTM no number. Retagging `kind`
   was rejected: ~18 `kind === "measure"` checks would each need a decision.
2. **Keep sections per jurisdiction.** Supreme Court stays in the California
   section, now after the offices and before the propositions. The Court of Appeal stays its own
   district section.

## Plan / steps

1. OpenSlate: schema + SPEC §3.14 `retention`; `compareRaces` orders offices,
   then retention questions, then measures; tests. Commit, push (deploys).
2. Endorsements repo: SoS script sets `retention: true` on the judicial block;
   regenerate positions.json; bump `.openslate-version` to step 1's commit; run
   verify/tests; commit, push (CI signs and publishes).
   **Order matters:** the app's strict schema must accept the field before the
   signed data carrying it is published.

## Follow-up: subsections (same friend, 2026-10-27)

"Break each section (like California) into people to vote for and measures."
Each section with more than one kind now splits into **Candidates**, **Judges**
(retention questions) and **Measures** subheadings, each with a count, using
`contestGroup` (collate.ts, the same function the sort uses) and
`contestGroups` (ballotView.ts). Applies on screen (`BallotSection`) and in
the print ballot (`PrintBallot`, an `h3` per group). A section with one kind
(e.g. a Court of Appeal district, or a congressional district) gets no
subheading. Checked in the local dev server with every race shown: California
reads Candidates · 12, Judges · 2, Measures · 14.

## Findings / gotchas

- Measures with a ballot listing but no `number`: all 66 are retention questions
  except the Bay Area RTM, in the Santa Clara and San Mateo registrar listings.
- **Don't rerun `ca-sos-ballot.ts --apply` over the committed listing.** Its
  output drops the 480 `choice_id`s, 8 `district` tags and `retrieved_at` that
  later commits added to the file by hand. The flags were added with a one-off
  JSON edit instead, touching only the 128 retention positions.
- The endorsements repo's main checkout had 7 unpushed commits from another
  thread (SV DSA), so this work went through a separate worktree off
  `origin/master`, pushed as a fast-forward. That checkout is now further
  behind origin and needs a rebase from whoever owns it.
- Biome in the endorsements repo fails on a Windows checkout over CRLF
  alone. `biome check --line-ending=crlf <file>` is clean. CI doesn't lint.

## Progress log

- [x] Step 1: OpenSlate schema/SPEC/collate/tests (`2416fe3`). Tests,
  typecheck, lint and vectors pass.
- [x] Step 1: pushed. The live bundle at openslate.us contains `retention`.
- [x] Step 2: endorsements `b4b81e4`, 128 positions flagged, pinned at
  `2416fe3`. CI signed and published it (run 40569755753, success), and the
  Pages copy has 128 `"retention": true`.
- [x] Follow-up: Candidates / Judges / Measures subsections, on screen and in
  print. Tests, typecheck and lint pass, and it looks right in the local dev server.

## Things not to do

- Don't read retention out of title wording ("Retain Justice"): the code's
  rule is that ballot facts come from `ballot`, not the title.
- Don't publish data with `retention` before the app accepting it is deployed.
