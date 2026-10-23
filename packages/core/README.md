# @openslate/core

The reference implementation of the [OpenSlate](../../SPEC.md) standard. Pure
TypeScript, runs anywhere Bun/Node/browsers do. This package is the single source
of truth for the format — every OpenSlate app imports it.

```ts
import { createSlate, verifySlate, generateKeyPair } from "@openslate/core";

const { token } = createSlate({
  keyPair: generateKeyPair(),
  issuer: { name: "Jane Voter", kind: "individual" },
  positions: [
    { subject: { title: "Mayor 2026", kind: "race" }, stance: "endorse", choice: "A. Candidate" },
    { subject: { title: "Prop 12", kind: "measure" }, stance: "oppose" },
  ],
});

const result = verifySlate(token);
// { valid: true, payload: {...}, issuerKey: "ed25519:...", errors: [], warnings: [] }
```

## Modules

- `schema` — zod schemas + inferred types; the canonical data model.
- `canonical` — RFC 8785 (JCS) canonical JSON + UTF-8 helpers.
- `crypto` — Ed25519 keygen/sign/verify, key encoding (`ed25519:<base58>`).
- `envelope` — JWS-compact encode/decode + signature check.
- `slate` — high-level `buildSlate` / `signSlate` / `createSlate` / `verifySlate` / `parseSlate`.
- `identity` — key pair + metadata, with secure-storage (de)serialization.
- `ballot` — ballot listings (SPEC §8.2) and `resolveChoice`: where a position's
  choice stands against them (listed by `choice_id`, name or nickname rule; a
  suggestion only; an uncertified write-in; off the ballot).
- `names` — candidate-name matching behind `resolveChoice` (`samePerson`,
  `matchBallotName`).

## Dependencies

Minimal and audited: [`@noble/curves`](https://github.com/paulmillr/noble-curves)
(Ed25519), [`@scure/base`](https://github.com/paulmillr/scure-base) (base58 /
base64url), [`zod`](https://zod.dev) (validation). JCS is implemented in-house.

Run `bun run schema` to emit `schema/openslate.schema.json` for other-language
implementers.
