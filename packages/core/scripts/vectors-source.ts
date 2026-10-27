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
          choice_id: "vip:candidate-456",
          weight: 0.75,
          statement: "Strong record on transit.",
          source: "https://alice.example/endorsements/mayor",
        },
        {
          subject: {
            title: "Water Board Seat 2",
            kind: "race",
            jurisdiction: "us/ca/springfield-county",
            district: "us/ca/springfield-water/div-2",
          },
          stance: "endorse",
          choice: "C. Writein",
          write_in: true,
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
  {
    name: "ballot-listing",
    description:
      "A ballot listing (SPEC §8.2) with how the ballot prints each contest and choice (§3.14): heading, number, label, measure type, vote_for, ranks, retention; party, designation, incumbent.",
    signer: "bob",
    payload: {
      v: 1,
      issuer: { name: "Springfield Ballot Bot", kind: "researcher" },
      issued_at: "2026-09-01T00:00:00Z",
      context: { election: "2026-11-03", jurisdiction: "us/ca/springfield" },
      attribution: {
        of: { name: "Springfield Elections Office", kind: "election-authority" },
        mode: "transcribed",
        retrieved_at: "2026-08-31T12:00:00Z",
      },
      positions: [
        {
          subject: {
            title: "City Council",
            kind: "race",
            ballot: { heading: "Member, City Council", vote_for: 3 },
          },
          stance: "neutral",
          choice: "A. Candidate",
          choice_id: "springfield:2026-11-03/council/a-candidate",
          ballot: { party: "Democratic", designation: "Teacher", incumbent: true },
        },
        {
          subject: {
            title: "Mayor of Springfield",
            kind: "race",
            ballot: { heading: "Mayor", ranks: 10 },
          },
          stance: "neutral",
          choice: "B. Other",
          ballot: { designation: "Small Business Owner" },
        },
        {
          subject: {
            title: "Springfield Measure A",
            kind: "measure",
            ballot: {
              heading: "Measure A",
              number: "A",
              label: "Shall the city fix the monorail?",
              measure_type: "Bond Measure",
            },
          },
          stance: "neutral",
          choice: "Yes",
        },
        {
          subject: {
            title: "Springfield Municipal Court — Retain Judge C. Jurist",
            kind: "measure",
            ballot: {
              heading: "For Judge of the Municipal Court",
              label: "Shall Judge C. JURIST be elected to the office for the term provided by law?",
              retention: true,
            },
          },
          stance: "neutral",
          choice: "Yes",
        },
      ],
    },
  },
  {
    name: "articles",
    description:
      "Articles attached to ballot items (SPEC §3.15): to a contest, to one choice, every field populated. A slate may carry only articles.",
    signer: "alice",
    payload: {
      v: 1,
      issuer: {
        name: "Springfield Shopper",
        kind: "organization",
        uri: "https://shopper.example/",
      },
      issued_at: "2026-10-01T00:00:00Z",
      positions: [],
      articles: [
        {
          subject: { title: "Springfield Measure A", kind: "measure", election: "2026-11-03" },
          uri: "https://shopper.example/2026/09/measure-a-explained",
          title: "Measure A, explained",
          publisher: "Springfield Shopper",
          published_at: "2026-09-30",
          kind: "explainer",
          summary: "What the monorail bond would pay for, and what it costs.",
        },
        {
          subject: { title: "Mayor of Springfield", kind: "race", election: "2026-11-03" },
          choice: "A. Candidate",
          choice_id: "springfield:2026-11-03/mayor/a-candidate",
          uri: "https://shopper.example/2026/10/a-candidate-profile",
          title: "Who is A. Candidate?",
          published_at: "2026-10-01T08:30:00-07:00",
          kind: "news",
        },
      ],
    },
  },
  {
    name: "ranked",
    description:
      "Ranked preferences (SPEC §3.16): first and second choice in a ranked-choice contest, and a dual endorsement left unranked.",
    signer: "alice",
    payload: {
      v: 1,
      issuer: { name: "Alice", kind: "individual" },
      issued_at: "2026-10-01T00:00:00Z",
      positions: [
        {
          subject: { title: "Mayor of Springfield", kind: "race", election: "2026-11-03" },
          stance: "endorse",
          choice: "A. Candidate",
          rank: 1,
        },
        {
          subject: { title: "Mayor of Springfield", kind: "race", election: "2026-11-03" },
          stance: "lean_for",
          choice: "B. Candidate",
          rank: 2,
        },
        {
          subject: {
            title: "Springfield Council, District 4",
            kind: "race",
            election: "2026-11-03",
          },
          stance: "endorse",
          choice: "C. Candidate",
        },
        {
          subject: {
            title: "Springfield Council, District 4",
            kind: "race",
            election: "2026-11-03",
          },
          stance: "endorse",
          choice: "D. Candidate",
        },
      ],
    },
  },
  {
    name: "regional-measure",
    description:
      "A measure filed under a region whose path doesn't show what it contains, with the counties that vote on it (SPEC §3.3 `voted_in`).",
    signer: "alice",
    payload: {
      v: 1,
      issuer: { name: "Alice", kind: "individual" },
      issued_at: "2026-10-01T00:00:00Z",
      positions: [
        {
          subject: {
            title: "Springfield Region — Measure RT",
            kind: "measure",
            jurisdiction: "us/ca/springfield-region",
            voted_in: ["us/ca/shelbyville-county", "us/ca/springfield-county"],
            election: "2026-11-03",
          },
          stance: "endorse",
          choice: "Yes",
        },
      ],
    },
  },
  {
    name: "labels",
    description:
      "The issuer's own words (SPEC §3.17): two tiers of support, each with what it means, on positions whose stances say how they count.",
    signer: "alice",
    payload: {
      v: 1,
      issuer: { name: "Springfield Neighbors Club", kind: "organization" },
      issued_at: "2026-10-01T00:00:00Z",
      labels: [
        { label: "Endorsed", description: "Approved by a 75% vote of the membership." },
        { label: "Recommended", description: "Approved by a majority of the membership." },
        { label: "No recommendation" },
      ],
      positions: [
        {
          subject: { title: "Springfield Measure A", kind: "measure", election: "2026-11-03" },
          stance: "endorse",
          choice: "Yes",
          label: "Endorsed",
        },
        {
          subject: { title: "Mayor of Springfield", kind: "race", election: "2026-11-03" },
          stance: "lean_for",
          choice: "A. Candidate",
          label: "Recommended",
          statement: "We recommend A. Candidate.",
        },
        {
          subject: {
            title: "Springfield Council, District 4",
            kind: "race",
            election: "2026-11-03",
          },
          stance: "abstain",
          label: "No recommendation",
        },
      ],
    },
  },
  {
    name: "adopts-reference",
    description:
      "Slate adopting two positions of another (secondhand) slate by reference instead of " +
      "copying them (SPEC §3.10). The adopted slate is identified by its signer (bob), its " +
      "attributed entity and election, and fetched from uri.",
    signer: "alice",
    payload: {
      v: 1,
      issuer: { name: "Springfield Neighbors Club", kind: "organization" },
      issued_at: "2026-01-01T00:00:00Z",
      context: { election: "2026-11-03" },
      positions: [
        {
          subject: { title: "City Council, District 3", kind: "race" },
          stance: "endorse",
          choice: "B. Neighbor",
        },
      ],
      adopts: [
        {
          issuer: "ed25519:9hSR6S7WPtxmTojgo6GG3k4yDPecgJY292j7xrsUGWBu",
          of: "Springfield Sierra Club",
          election: "2026-11-03",
          uri: "https://slates.example/springfield-sierra-club/2026-11-03.slate",
          subjects: [
            { title: "Mayor of Springfield", kind: "race" },
            { title: "Measure Q", kind: "measure" },
          ],
          source: "https://neighbors.example/2026-guide",
        },
      ],
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
  {
    name: "javascript-uri",
    description:
      "Validly signed token whose `issuer.uri` is a `javascript:` URL. URLs MUST be http: or https:; MUST be rejected (SPEC §3.13).",
    build: (h) => {
      const key = h.pubkey("alice");
      return h.sign(
        { alg: "EdDSA", typ: "openslate+jws", kid: key },
        {
          v: 1,
          issuer: { key, uri: "javascript:alert(document.cookie)" },
          issued_at: "2026-01-01T00:00:00Z",
          positions: [],
        },
        h.seed("alice"),
      );
    },
    expect: { error_contains: ["issuer.uri", "http"] },
  },
  {
    name: "incumbent-false",
    description:
      "Validly signed token with `ballot.incumbent: false`. Only `true` is allowed; MUST be rejected (SPEC §3.14).",
    build: (h) => {
      const key = h.pubkey("alice");
      return h.sign(
        { alg: "EdDSA", typ: "openslate+jws", kid: key },
        {
          v: 1,
          issuer: { key },
          issued_at: "2026-01-01T00:00:00Z",
          positions: [
            {
              subject: { title: "Mayor" },
              stance: "neutral",
              choice: "A",
              ballot: { incumbent: false },
            },
          ],
        },
        h.seed("alice"),
      );
    },
    expect: { error_contains: ["incumbent"] },
  },
  {
    name: "retention-false",
    description:
      "Validly signed token whose subject's `ballot` has `retention: false`. Only `true` is allowed; MUST be rejected (SPEC §3.14).",
    build: (h) => {
      const key = h.pubkey("alice");
      return h.sign(
        { alg: "EdDSA", typ: "openslate+jws", kid: key },
        {
          v: 1,
          issuer: { key },
          issued_at: "2026-01-01T00:00:00Z",
          positions: [
            {
              subject: { title: "Retain Judge A", ballot: { retention: false } },
              stance: "neutral",
              choice: "Yes",
            },
          ],
        },
        h.seed("alice"),
      );
    },
    expect: { error_contains: ["retention"] },
  },
  {
    name: "vote-for-and-ranks",
    description:
      "Validly signed token whose subject's `ballot` has both `vote_for` and `ranks`. MUST be rejected (SPEC §3.14).",
    build: (h) => {
      const key = h.pubkey("alice");
      return h.sign(
        { alg: "EdDSA", typ: "openslate+jws", kid: key },
        {
          v: 1,
          issuer: { key },
          issued_at: "2026-01-01T00:00:00Z",
          positions: [
            {
              subject: { title: "Mayor", ballot: { vote_for: 1, ranks: 10 } },
              stance: "endorse",
              choice: "A",
            },
          ],
        },
        h.seed("alice"),
      );
    },
    expect: { error_contains: ["vote_for", "ranks"] },
  },
  {
    name: "article-without-title",
    description:
      "Validly signed token with an article that has no `title`. MUST be rejected (SPEC §3.15).",
    build: (h) => {
      const key = h.pubkey("alice");
      return h.sign(
        { alg: "EdDSA", typ: "openslate+jws", kid: key },
        {
          v: 1,
          issuer: { key },
          issued_at: "2026-01-01T00:00:00Z",
          positions: [],
          articles: [{ subject: { title: "Prop 12" }, uri: "https://news.example/prop-12" }],
        },
        h.seed("alice"),
      );
    },
    expect: { error_contains: ["articles.0.title"] },
  },
  {
    name: "write-in-false",
    description:
      "Validly signed token with `write_in: false`. Only `true` is allowed; MUST be rejected (SPEC §3.4).",
    build: (h) => {
      const key = h.pubkey("alice");
      return h.sign(
        { alg: "EdDSA", typ: "openslate+jws", kid: key },
        {
          v: 1,
          issuer: { key },
          issued_at: "2026-01-01T00:00:00Z",
          positions: [
            { subject: { title: "Mayor" }, stance: "endorse", choice: "A", write_in: false },
          ],
        },
        h.seed("alice"),
      );
    },
    expect: { error_contains: ["write_in"] },
  },
  {
    name: "rank-on-oppose",
    description:
      "Validly signed token ranking a choice it opposes. A rank is a vote for the choice; MUST be rejected (SPEC §3.16).",
    build: (h) => {
      const key = h.pubkey("alice");
      return h.sign(
        { alg: "EdDSA", typ: "openslate+jws", kid: key },
        {
          v: 1,
          issuer: { key },
          issued_at: "2026-01-01T00:00:00Z",
          positions: [{ subject: { title: "Mayor" }, stance: "oppose", choice: "A", rank: 1 }],
        },
        h.seed("alice"),
      );
    },
    expect: { error_contains: ["rank"] },
  },
  {
    name: "rank-zero",
    description:
      "Validly signed token with `rank: 0`. Ranks start at 1; MUST be rejected (SPEC §3.16).",
    build: (h) => {
      const key = h.pubkey("alice");
      return h.sign(
        { alg: "EdDSA", typ: "openslate+jws", kid: key },
        {
          v: 1,
          issuer: { key },
          issued_at: "2026-01-01T00:00:00Z",
          positions: [{ subject: { title: "Mayor" }, stance: "endorse", choice: "A", rank: 0 }],
        },
        h.seed("alice"),
      );
    },
    expect: { error_contains: ["rank"] },
  },
  {
    name: "label-not-in-labels",
    description:
      "Validly signed token that lists its labels but uses one it doesn't list. MUST be rejected (SPEC §3.17).",
    build: (h) => {
      const key = h.pubkey("alice");
      return h.sign(
        { alg: "EdDSA", typ: "openslate+jws", kid: key },
        {
          v: 1,
          issuer: { key },
          issued_at: "2026-01-01T00:00:00Z",
          labels: [{ label: "Endorsed" }],
          positions: [
            { subject: { title: "Mayor" }, stance: "lean_for", choice: "A", label: "Recomended" },
          ],
        },
        h.seed("alice"),
      );
    },
    expect: { error_contains: ["label"] },
  },
  {
    name: "labels-duplicate",
    description:
      "Validly signed token that defines the same label twice. Labels are unique; MUST be rejected (SPEC §3.17).",
    build: (h) => {
      const key = h.pubkey("alice");
      return h.sign(
        { alg: "EdDSA", typ: "openslate+jws", kid: key },
        {
          v: 1,
          issuer: { key },
          issued_at: "2026-01-01T00:00:00Z",
          labels: [{ label: "Endorsed" }, { label: "Endorsed", description: "Again." }],
          positions: [],
        },
        h.seed("alice"),
      );
    },
    expect: { error_contains: ["labels"] },
  },
  {
    name: "voted-in-empty",
    description:
      "Validly signed token with an empty `voted_in`. It names at least one jurisdiction; MUST be rejected (SPEC §3.3).",
    build: (h) => {
      const key = h.pubkey("alice");
      return h.sign(
        { alg: "EdDSA", typ: "openslate+jws", kid: key },
        {
          v: 1,
          issuer: { key },
          issued_at: "2026-01-01T00:00:00Z",
          positions: [
            {
              subject: {
                title: "Measure RT",
                jurisdiction: "us/ca/springfield-region",
                voted_in: [],
              },
              stance: "endorse",
              choice: "Yes",
            },
          ],
        },
        h.seed("alice"),
      );
    },
    expect: { error_contains: ["voted_in"] },
  },
  {
    name: "choice-id-without-choice",
    description:
      "Validly signed token whose position has a `choice_id` but no `choice`. MUST be rejected (SPEC §3.4).",
    build: (h) => {
      const key = h.pubkey("alice");
      return h.sign(
        { alg: "EdDSA", typ: "openslate+jws", kid: key },
        {
          v: 1,
          issuer: { key },
          issued_at: "2026-01-01T00:00:00Z",
          positions: [{ subject: { title: "Mayor" }, stance: "endorse", choice_id: "vip:c-1" }],
        },
        h.seed("alice"),
      );
    },
    expect: { error_contains: ["choice"] },
  },
  {
    name: "adopts-no-target",
    description:
      "Validly signed token with an adoption that has neither uri nor an embedded slate. " +
      "Schema MUST reject (SPEC §3.10).",
    build: (h) => {
      const key = h.pubkey("alice");
      return h.sign(
        { alg: "EdDSA", typ: "openslate+jws", kid: key },
        {
          v: 1,
          issuer: { key },
          issued_at: "2026-01-01T00:00:00Z",
          positions: [],
          adopts: [{ issuer: h.pubkey("bob"), of: "Some Org" }],
        },
        h.seed("alice"),
      );
    },
    expect: { error_contains: ["adopts"] },
  },
];
