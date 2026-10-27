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
  working tree; other threads have uncommitted edits, including in
  `packages/cli/src/index.ts`; stage only our hunks).
- Spec: `SPEC.md` §3.1 (payload), §3.4 (Position), §3.6 (Stance), §3.10
  (adoption), §10.1 (changelog).
- Schema: `packages/core/src/schema.ts` (zod) → `packages/core/scripts/export-schema.ts`
  → `packages/core/schema/openslate.schema.json`.
- Test vectors: `packages/core/scripts/vectors-source.ts` → `vectors/`.
- CLI: `packages/cli/src/index.ts` (`SignInput`, `cmdSign`, `cmdSignBatch`).
- Core builder: `packages/core/src/slate.ts` (`BuildSlateInput`, `buildSlate`).
- App: `apps/web/src/lib/collate.ts` (`RacePosition`), `components/ChoiceRow.tsx`
  (source chips, "leans for"), `components/RacePanel.tsx` ("Lean for").
- The endorsements repo pins OpenSlate in `.openslate-version`; CI clones that
  commit to sign. So: push OpenSlate first, then bump the pin, then push the
  bundle.

## Decisions already made (don't re-ask)

- Do the spec change (user go-ahead), additive and optional, amended in place
  like `rank` and `voted_in`. Every existing slate stays valid; nothing stored
  in users' browsers changes.
- `stance` keeps its meaning and stays required: it's the machine bucket.

## Design

- `Position.label` (string, optional): the issuer's own term for the
  position, as it wrote it. Any stance. Consumers show it in place of their
  own stance wording, and MUST NOT read a stance out of it.
- `SlatePayload.labels` (optional `LabelDefinition[]`): `{ label, description? }`,
  in the order the issuer wants them shown (a legend). Labels MUST be unique.
  When `labels` is present, every own position's `label` MUST be one of
  them (catches typos; a slate can omit `labels` entirely).
- Adopted positions keep their `label`; its definition comes from the slate
  they were adopted from.

## Compatibility

- Existing slates, identities, ballots and settings: unaffected (all fields
  optional, no meaning changed).
- Closed schema (§3.8): verifiers built before this revision reject a slate
  that uses `label`/`labels`. The web app ships with the new core, but a stale
  cached copy would drop just the labelled slate until it reloads. Same
  trade-off as every earlier field addition; noted in the changelog.

## Plan / steps

1. [ ] **Current:** Spec text (§3.1, §3.4, new §3.17, §3.6 note, §3.10 note, §10.1).
2. [ ] Schema (zod + JSON Schema export), builder, vectors (positive + negatives).
3. [ ] CLI: pass `labels` through single and batch sign; inspect shows them.
4. [ ] App: carry `label` + definition into `RacePosition`; ChoiceRow and
   RacePanel show the label instead of "leans for"/"Lean for"; agent tools
   include it.
5. [ ] Checks (typecheck, lint, tests), commit in logical pieces.
6. [ ] SVDSA bundle: add labels ("Endorsed", "Recommended", "Cautious
   recommendation", "Gentle recommendation", "Not recommended", "No
   recommendation", "Neutral") with the guide's own definitions.
7. [ ] Ask the user to OK pushing OpenSlate, then bump `.openslate-version`
   and push the endorsements repo.

## Findings / gotchas

- My ballot's "Maybe" (`MyBallotPanel.tsx:145`, `ChoiceRow` OTHER_MARKS) is
  the voter's *own* mark, not an endorser's stance. The endorser wording is
  `ChoiceRow` STANCE_WORD ("leans for", plus a "~" on the chip) and
  `RacePanel` STANCE_LABEL ("Lean for").

## Progress log

- [x] Design agreed in principle (user go-ahead 2026-10-26).

## Open questions for the user

1. Should the app's own Compose panel let a voter or org set labels on the
   slates they publish? Not in this pass; recommend a follow-up.

## Things not to do

- Don't reinterpret existing stances or make `label` required.
- Don't push either repo without the user's OK.
