# Position labels: endorsers' own words (`Position.label`, `labels`)

## Goal

Let every endorser describe a position in its own vocabulary ("Endorsed",
"Recommended", "Cautious recommendation", "Watch list") instead of being
coerced into the six-value stance enum. `stance` stays as the common scale
the app collates, counts and computes lean with; the label is what a voter
reads. Prompted by the Silicon Valley DSA bundle
([svdsa-endorsements.md](svdsa-endorsements.md)), whose majority-vote
"recommendations" were going to show up as "leans for".

User feedback that set this up (2026-10-26):

- "every endorser needs to be able to use their own language. we cannot
  'coax' a recommendation to a full yes/reject."
- Go-ahead: "as long as the spec change doesn't break existing users configs,
  go for it".

## Environment / context

- OpenSlate repo: `C:\Users\camer\git\Personal Projects\OpenSlate` (shared
  working tree; other threads commit and push master concurrently).
- Spec: `SPEC.md` §3.1, §3.4, §3.6 (note), §3.10 (adopted labels), new
  §3.17, §10.1 changelog.
- Schema: `packages/core/src/schema.ts` (zod, `labelDefinitionSchema`, a
  `superRefine` on the payload for uniqueness and membership) →
  `packages/core/scripts/export-schema.ts` → `packages/core/schema/openslate.schema.json`.
  Draft-07 JSON Schema can't express "label is in labels"; zod enforces it.
- Vectors: `packages/core/scripts/vectors-source.ts` → `vectors/positive/labels.json`,
  `vectors/negative/label-not-in-labels.json`, `vectors/negative/labels-duplicate.json`.
- CLI: `packages/cli/src/index.ts` passes `labels` through `sign` and
  `sign --batch`; `verify` prints them.
- App: `apps/web/src/lib/collate.ts` (`RacePosition.label`, `labelDescription`),
  `components/ChoiceRow.tsx` (chips), `components/RacePanel.tsx` (race page),
  `lib/ballotAgent.ts` (`get_race` returns `label`, `label_description`).
- The endorsements repo pins OpenSlate in `.openslate-version`; CI clones that
  commit to sign. Pinned to `53ad9c5` there (commit `d45d6e2`, local).

## Decisions already made (don't re-ask)

- Do the spec change (user go-ahead), additive and optional, amended in place
  like `rank` and `voted_in`. Every existing slate stays valid; nothing stored
  in users' browsers changes.
- `stance` keeps its meaning and stays required: it's the machine bucket.
- Label descriptions are the issuer's words only; don't write our own (the
  SVDSA "cautious"/"gentle" labels have none).

## Design (as built)

- `Position.label` (string, optional): the issuer's own term, any stance.
  Consumers show it in place of their stance wording, count by stance, and
  MUST NOT read a stance out of it.
- `SlatePayload.labels` (optional `{ label, description? }[]`), legend order.
  Unique; when present, every own position's label must be listed.
- Adopted positions keep their label; its definition comes from the source slate.
- App: chip reads `Silicon Valley DSA: “Recommended”, Shirley N. Weber`
  (no "~" lean marker when labelled); popover adds the definition; race page
  badge shows the label with the definition under it.

## Plan / steps

1. [x] Spec text — `6de93e4`.
2. [x] Schema, builder, vectors — `6de93e4`.
3. [x] CLI — `6de93e4`.
4. [x] App — `53ad9c5`.
5. [x] Checks: typecheck, 661 tests, lint all pass; vectors 32/32.
6. [x] Visual check in the dev app (incognito profile, throwaway-key slate):
   chips, popover and race page show labels and definitions.
7. [x] Scraper skill teaches labels — `f1e3a66`; README — `feba3ae`.
8. [x] SVDSA bundle labelled and pin bumped (endorsements repo `d45d6e2`).
9. [ ] **Current:** user OKs pushing the endorsements repo (publishes SVDSA)
   and OpenSlate's 4 local follow-ups (docs/issues only).

## Findings / gotchas

- My ballot's "Maybe" (`MyBallotPanel.tsx:145`, `ChoiceRow` OTHER_MARKS) is
  the voter's *own* mark, not an endorser's stance. The endorser wording is
  `ChoiceRow` STANCE_WORD ("leans for", plus a "~" on the chip) and
  `RacePanel` STANCE_LABEL ("Lean for").
- `6de93e4` and `53ad9c5` reached origin when another thread pushed master
  (2026-10-26 evening), before the user OKed a push. They were tested and
  are additive; nothing to undo.
- `vectors:generate` rewrites every vector with LF endings; git shows them
  modified but the content diff is empty. Don't commit those.
- The T3 preview's Default profile holds the user's real ballot; test imports
  belong in the Incognito profile.
- Statements render with doubled quotes (`“"…"”`) for every scraped bundle;
  logged in `ISSUES.md` (`3f3f22a`), not fixed here.

## Progress log

- [x] Spec, core, CLI, vectors, app, skill, README committed.
- [x] Verified end to end: throwaway-key batch sign of SVDSA, `verify` lists
  8 labels, app renders them.
- [ ] Push (waiting on the user).

## Open questions for the user

1. OK to push the endorsements repo (7 commits, see svdsa-endorsements.md)?
   Pushing signs and publishes SVDSA. Origin's pin already includes labels.
2. OK to push OpenSlate's 4 local commits (ISSUES fix and entry, scraper
   skill, README)?
3. Should the app's Compose panel let voters/orgs set labels on slates they
   publish? Not built; recommend a follow-up.

## Things not to do

- Don't reinterpret existing stances or make `label` required.
- Don't invent label descriptions.
- Don't push either repo without the user's OK.
