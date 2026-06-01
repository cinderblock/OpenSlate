# Interop kit + research bot

`plans/interop-and-research-bot.md`

## Goal

Make OpenSlate's wire format easy for *anyone* to reimplement in any language
(Part 1), then build the tooling and spec extension that lets AI / volunteers
publish *secondhand* endorsement slates from public sources (Part 2). The two
parts are coupled: Part 2 introduces an additive schema field (`attribution`),
and Part 1's conformance vectors will protect that change going forward.

## Environment / context

- Repo: `C:\Users\camer\git\Personal Projects\OpenSlate` (branch `master`).
- Bun workspaces monorepo; pure TS; deps in core kept minimal (noble-curves,
  scure-base, zod).
- Spec lives at `SPEC.md`; reference impl at `packages/core`; CLI at
  `packages/cli`.
- JSON Schema is generated from zod via `bun run schema` →
  `packages/core/schema/{openslate,header}.schema.json`.
- Format is **early** — pushed once, not in use anywhere. Breaking-but-additive
  spec changes within `v: 1` are fair game while we're pre-adoption.

## Decisions already made (don't re-ask)

1. **Part 1 first, then Part 2.** Vectors land before the attribution field so
   the field's first appearance is locked in by a vector.
2. **Attribution model = option (b)**: optional top-level `attribution` block
   on `SlatePayload`. Researcher is the *issuer*; attribution declares whose
   public stance is being reported and when it was observed.
3. **Skip a spec revision for the attribution field.** Format has been published
   for ~5 minutes and is not in use; we amend v1 in place rather than minting
   v1.1. Document the change in SPEC.md changelog.
4. **Bring-your-own researcher key.** No project-blessed bot identity. Each
   researcher publishes their own `/.well-known/openslate.json`. The repo may
   ship example bots, but no single key is canonical.
5. **Commit per subtask.** Each Part 1 step is its own commit so the history
   reads as a checklist.

## Plan / steps

Tracked in TaskList; mirror here for durability.

### Part 1 — interop kit — **DONE**

- [x] **Plan doc** — this file.
- [x] **Conformance test vectors.** `vectors/{positive,negative}/*.json` +
  `keys.json`. Generated from `packages/core/scripts/vectors-source.ts`;
  driven by `bun run vectors:generate` and `vectors:check`. Checker also
  wired into `bun test` via `packages/core/test/vectors.test.ts`.
  Coverage: minimal, all stances, every optional field, endorsed_by,
  unicode + JCS UTF-16 ordering, tampered payload/signature, kid mismatch,
  wrong alg, closed-schema rejection, malformed token shapes.
  (Commit `598b299`.)
- [x] **`openslate validate` command.** Schema-only check (no crypto) on a
  SlatePayload JSON, accepts a path or `-` for stdin, exits non-zero with
  per-issue paths on schema failure. (Commit `37ba4b7`.)
- [x] **`.slate` extension + `application/openslate+jws` media type.**
  SPEC §11; README mention; deferred a multi-slate collection format.
  (Commits `062d43a`, `1982737`.)
- [x] **Schema bundle.** `openslate.schema.json` now ships both
  `SlatePayload` and `JwsHeader` under `definitions`, with stable `$id`s
  on both files (raw GitHub URLs). (Commit `7cafc0b`.)
- [x] **`docs/PORTING.md`.** Four-primitive list, sign/verify pseudocode,
  four pitfalls, four-step minimum-viable-port plan. (Commit `719f357`.)

### Part 2 — research bot (after Part 1)

- [ ] **Add `attribution` field to `slatePayloadSchema`** + SPEC.md §3.x.
  Shape (locked decision):
  ```
  attribution: {
    of: { name?, uri?, kind? },        // who the slate purports to report
    mode: "scraped" | "transcribed" | "inferred",
    retrieved_at: rfc3339,
    sources?: string[]                  // top-level URLs; Position.source is per-position
  }
  ```
  Issuer remains the researcher's key; verifiers MUST surface the
  attribution prominently so consumers see "secondhand by X" not "from Y."
### Part 2 — research bot — **DONE**

- [x] **Attribution field on `SlatePayload`** (commit `6c0bd3d`). Added
  `attribution: { of: { name, uri?, kind? }, mode: scraped|transcribed|inferred,
  retrieved_at, sources? }` to schema + SPEC §3.9. Amended v1 in place
  (changelog at §10.1). Folded `attribution.of` consolidates the inputs into
  a single `of` object instead of separate `positions.json` + `attribution.json`
  sidecars — simpler and the data lives where the signer reads it.
- [x] **Attribution conformance vectors** (commit `bc0ce4e`). Positive
  `attribution-scraped` exercises the field; negative `attribution-bad-mode`
  exercises closed-enum rejection. 14/14 vectors pass.
- [x] **CLI sign + verify support** (commit `2217408`). `sign` reads
  `attribution` from the input JSON wrapper; `verify` prints a
  `SECONDHAND REPORT` banner.
- [x] **Researcher identity convention (BYO)** in SPEC §7.1 (commit
  `7159152`). No project-blessed key. Researchers publish
  `/.well-known/openslate.json`, use `kind: "researcher"`, rotate per
  election cycle. Verifiers SHOULD supersede secondhand reports with
  firsthand slates when the named entity publishes one.
- [x] **`endorsement-scraper` skill + bundle layout** (commit `16e7565`).
  `.claude/skills/endorsement-scraper/SKILL.md` walks an AI through
  fetch → extract → draft → validate → STOP. Layout:
  `research-bot/orgs/<slug>/<election>/{positions.json, evidence/, signed.slate}`,
  documented in `research-bot/README.md`. Bundles are self-contained and
  publishable anywhere.
- [x] **Batch sign + `index.json`** (commit `2273e68`).
  `openslate sign --batch <dir> --key <id>` walks the tree, signs each
  bundle, emits `<dir>/index.json` with one entry per signed.slate
  (issuer, attribution summary, positions count). Idempotent: skips
  pre-existing signed.slate unless `--force`.

The earlier sub-bullet about "verify-against-source UX recipe" landed in
SPEC §3.9 "Consumer requirements" and §7.1 (the supersede rule), plus the
CLI's `SECONDHAND REPORT` banner. No standalone doc needed.

## Findings / gotchas

- The schema is **strict / closed** (`additionalProperties: false`). Adding the
  attribution field is a schema change *and* a code change — older verifiers
  will reject newer slates. Acceptable now (pre-adoption); won't be later.
- `@scure/base` is already imported for base58btc / base64url — no new deps
  needed for vectors or attribution.
- JCS is implemented in-house (`canonical.ts`). It only handles the value
  shapes OpenSlate uses; vectors must avoid edge cases outside that subset
  (no `NaN`, no `-0`, no `bigint`).
- `header.kid` must equal `payload.issuer.key` — vectors must keep these in
  sync or verification fails.
- Bun runs `.ts` directly, so vector scripts can stay as TS without a build
  step.

## Progress log

- [x] Read SPEC, core src, CLI, existing schema export to confirm scope.
- [x] Part 1 — interop kit (vectors, validate, schema bundle, .slate, porting).
- [x] Part 2 — attribution field, researcher identity convention, scraper
      skill, research-bot/ layout, batch sign + index.
- [ ] **Next: nothing planned.** Possible follow-ups: a v2 of `endorsed_by`
      that cross-links researcher slates as soft attestations; a "supersede"
      lookup helper in `@openslate/core` that, given a slate set, returns the
      preferred slate per `(election, jurisdiction, subject)`.

## Open questions for the user

None right now. Will surface here if any arise mid-implementation.

## Things not to do

- Don't add the attribution field before vectors land — vectors must witness
  the change so a future regression is obvious.
- Don't pick a single project-blessed researcher key; BYO key is the model.
- Don't introduce new runtime deps in `@openslate/core` for vectors or for
  attribution — keep the reimplementation surface tiny.
- Don't bump `v` for the attribution field — we agreed to amend v1 in place
  while the format is pre-adoption.
- Don't mock JCS in tests; round-trip through the real `canonicalize`
  function so vectors witness any drift.
