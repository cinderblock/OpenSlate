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

## Findings / gotchas

- Measures with a ballot listing but no `number`: all 66 are retention questions
  except the Bay Area RTM, in the Santa Clara and San Mateo registrar listings.

## Progress log

- [ ] Step 1: OpenSlate schema/SPEC/collate/tests
- [ ] Step 1: deployed
- [ ] Step 2: endorsements repo data + pin bump

## Things not to do

- Don't read retention out of title wording ("Retain Justice"): the code's
  rule is that ballot facts come from `ballot`, not the title.
- Don't publish data with `retention` before the app accepting it is deployed.
