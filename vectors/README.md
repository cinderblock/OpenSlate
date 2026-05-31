# OpenSlate conformance test vectors

This directory is the **cross-language conformance bar** for the OpenSlate wire
format. A conforming implementation in any language MUST be able to:

1. **Round-trip every positive vector byte-for-byte.** Sign the documented
   `payload` with the documented seed and reproduce `canonical_header`,
   `canonical_payload`, `signing_input`, `signature`, and `token` exactly.
2. **Reject every negative vector**, returning at least one error whose text
   contains each substring listed in `expect.error_contains` (case-insensitive
   match is fine).

If you reimplement OpenSlate and the vectors pass, your implementation is
interoperable with the TypeScript reference at `packages/core`.

## Files

```
vectors/
  keys.json           — test seeds and the public keys they derive to
  positive/*.json     — round-trip vectors
  negative/*.json     — tokens that MUST NOT verify
```

### `keys.json`

```jsonc
{
  "alice": {
    "seed_hex": "0101…01",          // 32-byte Ed25519 seed
    "public_key_hex": "8a88…6f5c",  // 32-byte public key
    "public_key": "ed25519:AKnL…"   // OpenSlate canonical encoding (base58btc)
  },
  ...
}
```

Seeds are deliberately obvious (`0x01 * 32`, `0x02 * 32`, …) so nobody confuses
them with real material. They are **not secret**.

### Positive vector shape

```jsonc
{
  "name": "minimal",
  "description": "…",
  "signer": "alice",                    // key from keys.json used to sign
  "payload": { ... },                   // SlatePayload (issuer.key already filled)
  "header": { "alg": "EdDSA", "typ": "openslate+jws", "kid": "ed25519:…" },
  "canonical_header":  "{\"alg\":\"EdDSA\",…}",   // JCS bytes of header
  "canonical_payload": "{\"issued_at\":…}",       // JCS bytes of payload
  "signing_input": "<b64url(header)>.<b64url(payload)>",  // ASCII; the bytes Ed25519 signs
  "signature": "<base64url-no-pad>",
  "token":     "<header>.<payload>.<signature>"
}
```

The `canonical_*` strings let you diff your JCS implementation against the
reference output **before** worrying about signing. If `canonical_payload`
matches and `signature` doesn't, your Ed25519 wiring is the bug. If
`canonical_payload` doesn't match, your JCS is the bug. (The most common
mistakes: keys not sorted by UTF-16 code unit, insignificant whitespace
included, base64url emitted **with** padding.)

### Negative vector shape

```jsonc
{
  "name": "tampered-payload",
  "description": "…",
  "token": "ey…",
  "expect": {
    "error_contains": ["signature"]   // verify() must produce ≥1 error containing each
  }
}
```

## What's covered

| Vector                       | Exercises |
| --- | --- |
| `positive/minimal`           | Required fields only, empty positions |
| `positive/all-stances`       | Every `Stance` enum value |
| `positive/all-position-fields` | Every optional Subject/Position field; `context`; `expires_at`; `nonce` |
| `positive/endorsed-by`       | `endorsed_by` references |
| `positive/unicode-titles`    | Non-ASCII titles; JCS UTF-16 key ordering and JSON escaping |
| `negative/tampered-payload`  | Payload edited after signing |
| `negative/tampered-signature`| Signature bit-flipped |
| `negative/kid-mismatch`      | `header.kid` ≠ `payload.issuer.key` |
| `negative/wrong-alg`         | Non-EdDSA `alg` |
| `negative/unknown-payload-field` | Closed-schema rejection of smuggled fields |
| `negative/not-three-segments`| Missing token segments |
| `negative/garbage-string`    | Completely unstructured input |

## Regenerating

```sh
bun run vectors:generate   # rewrite vectors/ from packages/core/scripts/vectors-source.ts
bun run vectors:check      # round-trip every file against the TS reference
```

`vectors:check` is also run as part of `bun test` (`packages/core/test/vectors.test.ts`).

If you intentionally change the schema or signing pipeline, regenerate and
review the diff carefully — the byte-equality of these files is the contract.

## Implementing the check in your language

```
for each file in vectors/positive/:
  payload    = file.payload
  seed       = keys[file.signer].seed_hex
  jcs(header)  must equal file.canonical_header
  jcs(payload) must equal file.canonical_payload
  b64url(jcs(header)) + "." + b64url(jcs(payload)) must equal file.signing_input
  Ed25519-sign(seed, ASCII(file.signing_input)) must base64url-encode to file.signature
  full token must equal file.token
  verify(file.token) must return valid=true

for each file in vectors/negative/:
  result = verify(file.token)
  result.valid must be false
  for each needle in file.expect.error_contains:
    at least one of result.errors must contain needle (case-insensitive)
```

## Adding a vector

Edit `packages/core/scripts/vectors-source.ts`, add an entry to `POSITIVES` or
`NEGATIVES`, run `bun run vectors:generate`, commit both the source change and
the regenerated JSON.
