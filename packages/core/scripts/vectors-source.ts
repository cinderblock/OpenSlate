/**
 * Single source of truth for OpenSlate conformance test vectors.
 *
 * Editing this file and running `bun run vectors:generate` regenerates the
 * JSON files under `vectors/` at the repo root. Those files are the
 * cross-language interoperability artifact: any conforming OpenSlate
 * implementation in any language MUST be able to round-trip them.
 *
 * Test seeds here are deliberately obvious (`0x01 * 32`, `0x02 * 32`, …) so
 * that they read as test material. They are not secret.
 */

import type { SlatePayload } from "../src/schema";

/** Test seeds: name → 32-byte hex Ed25519 seed. */
export const SEEDS: Record<string, string> = {
  alice: "0101010101010101010101010101010101010101010101010101010101010101",
  bob: "0202020202020202020202020202020202020202020202020202020202020202",
};

/** A positive vector: input payload that should round-trip cleanly. */
export interface PositiveDef {
  name: string;
  description: string;
  /** Key in SEEDS used to sign. The vector's issuer.key is derived from this. */
  signer: keyof typeof SEEDS;
  /**
   * The payload as the author would construct it, EXCEPT `issuer.key` is
   * left out (filled by the generator from `signer`). All other required and
   * any optional fields the vector exercises must be present.
   */
  payload: Omit<SlatePayload, "issuer"> & { issuer: Omit<SlatePayload["issuer"], "key"> };
}

/** A negative vector: a fixed token that MUST fail to verify. */
export interface NegativeDef {
  name: string;
  description: string;
  /**
   * How to produce the bad token. The function receives a helpers object with
   * the test signing primitives so derived tokens (tampered, wrong-kid, etc.)
   * can be built from a known-good base.
   */
  build: (helpers: NegativeHelpers) => string;
  expect: {
    /** Substring(s) that MUST appear (case-insensitive) in the joined errors. */
    error_contains: string[];
  };
}

export interface NegativeHelpers {
  /** Sign an arbitrary {header, payload} with the given seed; canonicalizes both. */
  sign: (
    header: Record<string, unknown>,
    payload: Record<string, unknown>,
    seedHex: string,
  ) => string;
  /** Public key (ed25519:base58) for a seed name. */
  pubkey: (signer: keyof typeof SEEDS) => string;
  /** Seed hex for a name. */
  seed: (signer: keyof typeof SEEDS) => string;
}

// ─── Positive vectors ────────────────────────────────────────────────────────

export const POSITIVES: PositiveDef[] = [
  {
    name: "minimal",
    description: "Minimal valid slate: required fields only, empty positions.",
    signer: "alice",
    payload: {
      v: 1,
      issuer: { name: "Alice" },
      issued_at: "2026-01-01T00:00:00Z",
      positions: [],
    },
  },
  {
    name: "all-stances",
    description: "One position per stance value; exercises the stance enum.",
    signer: "alice",
    payload: {
      v: 1,
      issuer: { name: "Alice", kind: "individual" },
      issued_at: "2026-01-01T00:00:00Z",
      positions: [
        { subject: { title: "Endorsed Race" }, stance: "endorse" },
        { subject: { title: "Opposed Race" }, stance: "oppose" },
        { subject: { title: "Lean For Race" }, stance: "lean_for" },
        { subject: { title: "Lean Against Race" }, stance: "lean_against" },
        { subject: { title: "Neutral Race" }, stance: "neutral" },
        { subject: { title: "Abstained Race" }, stance: "abstain" },
      ],
    },
  },
  {
    name: "all-position-fields",
    description: "Every optional Position and Subject field populated.",
    signer: "alice",
    payload: {
      v: 1,
      issuer: {
        name: "Alice",
        kind: "individual",
        uri: "https://alice.example/",
      },
      issued_at: "2026-01-01T00:00:00Z",
      expires_at: "2027-01-01T00:00:00Z",
      context: {
        election: "2026-11-03",
        jurisdiction: "us/ca/sf",
        title: "November 2026 General",
      },
      positions: [
        {
          subject: {
            title: "Mayor of Springfield",
            id: "vip:contest-123",
            kind: "race",
            jurisdiction: "us/ca/springfield",
            election: "2026-11-03",
            uri: "https://example.org/contest/123",
          },
          stance: "endorse",
          choice: "A. Candidate",
          weight: 0.75,
          statement: "Strong record on transit.",
          source: "https://alice.example/endorsements/mayor",
        },
      ],
      nonce: "n1",
    },
  },
  {
    name: "endorsed-by",
    description: "Candidate-style slate carrying claimed cross-endorsements.",
    signer: "bob",
    payload: {
      v: 1,
      issuer: { name: "B. Candidate", kind: "candidate" },
      issued_at: "2026-01-01T00:00:00Z",
      positions: [],
      endorsed_by: [
        {
          issuer: "ed25519:1111111111111111111111111111111111111111111111",
          name: "Springfield Sierra Club",
          uri: "https://sierra.example/endorsements",
          note: "Endorsed at 2025-12 chapter meeting.",
        },
      ],
    },
  },
  {
    name: "unicode-titles",
    description:
      "Non-ASCII titles and key sort behavior. Exercises JCS UTF-16 ordering and JSON escaping.",
    signer: "alice",
    payload: {
      v: 1,
      issuer: { name: "Älice" },
      issued_at: "2026-01-01T00:00:00Z",
      positions: [
        { subject: { title: "市長選挙" }, stance: "endorse" },
        { subject: { title: "Café Measure 🌳" }, stance: "oppose" },
      ],
    },
  },
  {
    name: "attribution-scraped",
    description:
      "Researcher-signed slate reporting another organization's stated stance (secondhand). " +
      "Signer is the researcher; attribution.of names the reported entity.",
    signer: "bob",
    payload: {
      v: 1,
      issuer: { name: "OpenSlate Research Bot v0", kind: "researcher" },
      issued_at: "2026-01-01T00:00:00Z",
      context: { election: "2026-11-03", jurisdiction: "us/ca/sf" },
      positions: [
        {
          subject: { title: "Mayor of Springfield", kind: "race" },
          stance: "endorse",
          choice: "A. Candidate",
          source: "https://sierra.example/endorsements/2026/mayor",
        },
      ],
      attribution: {
        of: {
          name: "Springfield Sierra Club",
          uri: "https://sierra.example/",
          kind: "organization",
        },
        mode: "scraped",
        retrieved_at: "2025-12-15T18:30:00Z",
        sources: ["https://sierra.example/endorsements/2026"],
      },
    },
  },
];

// ─── Negative vectors ────────────────────────────────────────────────────────

export const NEGATIVES: NegativeDef[] = [
  {
    name: "tampered-payload",
    description:
      "A valid signed token whose payload segment was edited after signing. Signature MUST fail.",
    build: (h) => {
      const key = h.pubkey("alice");
      const original = h.sign(
        { alg: "EdDSA", typ: "openslate+jws", kid: key },
        {
          v: 1,
          issuer: { key, name: "Alice" },
          issued_at: "2026-01-01T00:00:00Z",
          positions: [{ subject: { title: "Mayor" }, stance: "endorse" }],
        },
        h.seed("alice"),
      );
      // Re-encode the payload with `stance: oppose`, splice it in, keep original signature.
      const [headerSeg, , sigSeg] = original.split(".");
      const tampered = {
        v: 1,
        issuer: { key, name: "Alice" },
        issued_at: "2026-01-01T00:00:00Z",
        positions: [{ subject: { title: "Mayor" }, stance: "oppose" }],
      };
      const tamperedSeg = Buffer.from(JSON.stringify(tampered), "utf8").toString("base64url");
      return `${headerSeg}.${tamperedSeg}.${sigSeg}`;
    },
    expect: { error_contains: ["signature"] },
  },
  {
    name: "tampered-signature",
    description:
      "A valid token whose signature segment was bit-flipped. MUST fail signature check.",
    build: (h) => {
      const key = h.pubkey("alice");
      const original = h.sign(
        { alg: "EdDSA", typ: "openslate+jws", kid: key },
        { v: 1, issuer: { key }, issued_at: "2026-01-01T00:00:00Z", positions: [] },
        h.seed("alice"),
      );
      const [hSeg, pSeg, sSeg] = original.split(".") as [string, string, string];
      // Flip the first character of the signature segment.
      const firstChar = sSeg[0] as string;
      const flipped = (firstChar === "A" ? "B" : "A") + sSeg.slice(1);
      return `${hSeg}.${pSeg}.${flipped}`;
    },
    expect: { error_contains: ["signature"] },
  },
  {
    name: "kid-mismatch",
    description: "header.kid points to a different key than payload.issuer.key. MUST be rejected.",
    build: (h) => {
      const realKey = h.pubkey("alice");
      const otherKey = h.pubkey("bob");
      return h.sign(
        { alg: "EdDSA", typ: "openslate+jws", kid: otherKey },
        { v: 1, issuer: { key: realKey }, issued_at: "2026-01-01T00:00:00Z", positions: [] },
        h.seed("alice"),
      );
    },
    expect: { error_contains: ["kid"] },
  },
  {
    name: "wrong-alg",
    description: "header.alg is not EdDSA. MUST be rejected.",
    build: (h) => {
      const key = h.pubkey("alice");
      return h.sign(
        { alg: "HS256", typ: "openslate+jws", kid: key },
        { v: 1, issuer: { key }, issued_at: "2026-01-01T00:00:00Z", positions: [] },
        h.seed("alice"),
      );
    },
    expect: { error_contains: ["alg"] },
  },
  {
    name: "unknown-payload-field",
    description: "Validly signed token whose payload carries an unknown field. MUST be rejected.",
    build: (h) => {
      const key = h.pubkey("alice");
      return h.sign(
        { alg: "EdDSA", typ: "openslate+jws", kid: key },
        {
          v: 1,
          issuer: { key },
          issued_at: "2026-01-01T00:00:00Z",
          positions: [],
          // closed schema — this extra field must be rejected
          surprise: "smuggled data",
        },
        h.seed("alice"),
      );
    },
    expect: { error_contains: ["payload"] },
  },
  {
    name: "not-three-segments",
    description: "String with only two dot-separated segments. Not a token.",
    build: () => "ey.ey",
    expect: { error_contains: ["3 segments"] },
  },
  {
    name: "garbage-string",
    description: "Completely unstructured input.",
    build: () => "this-is-not-a-token-at-all",
    expect: { error_contains: ["segments"] },
  },
  {
    name: "attribution-bad-mode",
    description:
      "Validly signed token whose attribution.mode is not in the enum. Closed schema MUST reject.",
    build: (h) => {
      const key = h.pubkey("bob");
      return h.sign(
        { alg: "EdDSA", typ: "openslate+jws", kid: key },
        {
          v: 1,
          issuer: { key, kind: "researcher" },
          issued_at: "2026-01-01T00:00:00Z",
          positions: [],
          attribution: {
            of: { name: "Some Org" },
            mode: "guessed", // not in {scraped, transcribed, inferred}
            retrieved_at: "2025-12-15T18:30:00Z",
          },
        },
        h.seed("bob"),
      );
    },
    expect: { error_contains: ["attribution"] },
  },
];
