# Porting OpenSlate to another language

OpenSlate is intentionally small so that a competent developer can implement
it in any language in an afternoon. This guide is the shortest path from
"never seen this format" to "passing the conformance test vectors."

The normative reference is [SPEC.md](../SPEC.md); this guide is informative.

## What you need

Just four primitives, all standard:

| Primitive | Used for |
| --- | --- |
| **Ed25519 / EdDSA** ([RFC 8032](https://www.rfc-editor.org/rfc/rfc8032)) | Sign and verify |
| **JCS canonical JSON** ([RFC 8785](https://www.rfc-editor.org/rfc/rfc8785)) | Stable bytes for the header and payload |
| **Base64URL without padding** ([RFC 7515 §2](https://www.rfc-editor.org/rfc/rfc7515)) | Token segments |
| **Base58btc** | Encoding `ed25519:<base58>` public/secret keys |

Most languages have all four in their standard library or a single mainstream
package. No JOSE library is required — the JWS-compact shape is three
base64url segments joined by `.`, nothing more.

## Five-minute mental model

A signed OpenSlate token is just:

```
b64u( jcs(header) ) "." b64u( jcs(payload) ) "." b64u( ed25519_sign(secret, ascii(b64u(header) "." b64u(payload))) )
```

That's the whole format. The header is a JWS header with three fields; the
payload is the [`SlatePayload`](../packages/core/schema/openslate.schema.json)
schema. Both are canonicalized (JCS) before encoding.

## Sign (pseudocode)

```text
function sign(payload, secret_key):
    assert payload conforms to SlatePayload         # closed schema
    header = { alg: "EdDSA", typ: "openslate+jws", kid: payload.issuer.key }

    header_jcs  = jcs(header)                       # canonical JSON bytes
    payload_jcs = jcs(payload)
    header_seg  = base64url_no_pad(utf8(header_jcs))
    payload_seg = base64url_no_pad(utf8(payload_jcs))

    signing_input = header_seg + "." + payload_seg  # ASCII string
    signature = ed25519_sign(ascii(signing_input), secret_key)
    sig_seg = base64url_no_pad(signature)

    return signing_input + "." + sig_seg
```

## Verify (pseudocode)

```text
function verify(token):
    segs = token.trim().split(".")
    if len(segs) != 3: reject("expected 3 segments")
    header_seg, payload_seg, sig_seg = segs

    header   = parse_json(utf8_decode(base64url_no_pad_decode(header_seg)))
    payload  = parse_json(utf8_decode(base64url_no_pad_decode(payload_seg)))
    sig      = base64url_no_pad_decode(sig_seg)

    if header.alg != "EdDSA":           reject("unsupported alg")
    if header.typ != "openslate+jws":   warn  ("unexpected typ")    # warn, not reject
    if header.kid != payload.issuer.key: reject("kid does not match issuer.key")

    if not payload matches SlatePayload schema (closed): reject("schema")

    pubkey = decode_ed25519_key(payload.issuer.key)         # "ed25519:" + base58btc(32 bytes)
    signing_input = header_seg + "." + payload_seg          # exact bytes from the wire
    if not ed25519_verify(sig, ascii(signing_input), pubkey): reject("signature")

    if payload.expires_at present and in the past: warn("expired") # still valid
    return ok(payload)
```

Verification uses the **wire bytes** of `header_seg.payload_seg` directly —
do NOT re-canonicalize the parsed header/payload before verifying. (Re-canonicalizing
would be redundant and would mask any sender bug; verifying the bytes that were
actually signed is the whole point.)

## The four pitfalls

These are the bugs every porter hits at least once. If your conformance run
fails, suspect these in order:

1. **Object key sort.** JCS sorts by **UTF-16 code unit**, not by byte value or
   by Unicode codepoint. For ASCII these all agree, but `"é"` and `"é"`
   normalize differently and surrogate-pair characters sort by their UTF-16
   units, not codepoints. Most languages' built-in sort works if your string
   comparison is on UTF-16 code units (JavaScript: native; Python: `sorted`
   over `str`; Go: `sort.Strings` is byte-wise — needs care for non-ASCII).
2. **Base64URL with padding.** RFC 7515 mandates **no** trailing `=`
   characters. Many base64url helpers default to padding. Strip it.
3. **JSON number formatting.** OpenSlate only uses one bounded number
   (`weight ∈ [0, 1]`); format it as you would a JavaScript `Number` (no
   trailing zeros, no `+`/leading-zero exponents). Stick to the ECMAScript
   `Number.prototype.toString` rules and you're fine.
4. **Closed schema.** Verifiers MUST reject payloads carrying fields not
   defined in the schema. If your validator silently drops unknown fields,
   add a strict-mode flag. The `negative/unknown-payload-field` vector
   exercises this directly.

A fifth, smaller pitfall: **`issuer.key` and `header.kid` must be byte-identical.**
Trim whitespace and normalize neither one — the bytes the wire carries are
authoritative.

## Test against the conformance vectors

The repository ships [`vectors/`](../vectors/) — JSON test vectors that the TS
reference passes byte-for-byte. Run your implementation against them:

```text
for each file in vectors/positive/:
    payload = file.payload
    seed    = vectors/keys.json[file.signer].seed_hex
    jcs(file.header)  must equal file.canonical_header
    jcs(file.payload) must equal file.canonical_payload
    sign(payload, seed) must equal file.token
    verify(file.token) must succeed

for each file in vectors/negative/:
    verify(file.token) must fail
    each substring in file.expect.error_contains must appear (case-insensitive) in your errors
```

If all positive vectors round-trip byte-for-byte and all negative vectors
fail with matching errors, your implementation is interoperable with the
reference. See [`vectors/README.md`](../vectors/README.md) for the file
shapes.

## Minimum viable port

For a brand-new port, implement in this order — each step is independently
testable:

1. **`encode_public_key` / `decode_public_key`** — `ed25519:` + base58btc round
   trip. Test: the keys in `vectors/keys.json` decode to the documented
   `public_key_hex`.
2. **`jcs(value)`** — recursive sort + minimal JSON. Test: produce
   `file.canonical_header` and `file.canonical_payload` for every positive
   vector.
3. **`sign(payload, seed)`** — wire the JCS output through Ed25519. Test:
   produce `file.token` for every positive vector.
4. **`verify(token)`** — implement the verify pseudocode. Test: accept every
   positive vector, reject every negative.

After step 4 you're done. The schema validation can be as thorough as your
language's tooling allows; the canonical JSON schema lives at
[`packages/core/schema/openslate.schema.json`](../packages/core/schema/openslate.schema.json)
and has a stable `$id` you can `$ref` from your own tests.

## Things you do NOT need

- A JWS or JOSE library. Implement the three-segment dot-join directly.
- A JWT library. OpenSlate is JWS-compact, not a JWT (no `exp` claim format,
  no Base64URL of JSON-of-headers).
- A canonical-CBOR or COSE implementation. Stay in JSON.
- A revocation framework. There is no revocation in v1; use `expires_at` and
  re-issue. Key rotation is announced via `/.well-known/openslate.json`
  (informative; see SPEC §7).
