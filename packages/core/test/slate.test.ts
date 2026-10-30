import { describe, expect, test } from "bun:test";
import { canonicalize } from "../src/canonical";
import { encodePublicKey, generateKeyPair } from "../src/crypto";
import { encodeToken } from "../src/envelope";
import {
  createIdentity,
  deserializeIdentity,
  identityToIssuer,
  serializeIdentity,
} from "../src/identity";
import { createSlate, parseSlate, verifySlate } from "../src/slate";

describe("canonicalize", () => {
  test("sorts object keys", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  test("omits undefined members", () => {
    expect(canonicalize({ a: undefined, b: 1 })).toBe('{"b":1}');
  });

  test("is order-independent and recursive", () => {
    expect(canonicalize({ x: [1, 2], y: { d: 4, c: 3 } })).toBe(
      canonicalize({ y: { c: 3, d: 4 }, x: [1, 2] }),
    );
  });
});

describe("sign + verify round trip", () => {
  test("the signature covers an attribution's capture", () => {
    const capture = {
      run: "2026-10-30T1700Z",
      manifest_sha256: "b".repeat(64),
      provenance: "https://example.org/provenance/state-party/2026-11-03.json",
    };
    const { token } = createSlate({
      keyPair: generateKeyPair(),
      issuer: { name: "Researcher", kind: "researcher" },
      positions: [],
      attribution: {
        of: { name: "State Party" },
        mode: "scraped",
        retrieved_at: "2026-10-30T17:00:00Z",
        capture,
      },
    });
    const result = verifySlate(token);
    expect(result.valid).toBe(true);
    expect(result.payload?.attribution?.capture).toEqual(capture);

    // Swapping the capture breaks the signature, as any other payload edit does.
    const [header, body, signature] = token.split(".");
    const decoded = JSON.parse(Buffer.from(body as string, "base64url").toString("utf8"));
    decoded.attribution.capture.manifest_sha256 = "c".repeat(64);
    const edited = Buffer.from(JSON.stringify(decoded)).toString("base64url");
    expect(verifySlate(`${header}.${edited}.${signature}`).valid).toBe(false);
  });

  test("a freshly signed slate verifies", () => {
    const { token, payload } = createSlate({
      keyPair: generateKeyPair(),
      issuer: { name: "Jane Voter", kind: "individual" },
      positions: [
        { subject: { title: "Mayor 2026", kind: "race" }, stance: "endorse", choice: "A" },
        { subject: { title: "Prop 12", kind: "measure" }, stance: "oppose" },
      ],
    });

    const result = verifySlate(token);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.issuerKey).toBe(payload.issuer.key);
    expect(result.payload?.positions).toHaveLength(2);
  });

  test("tampering with the payload breaks verification", () => {
    const { token } = createSlate({
      keyPair: generateKeyPair(),
      issuer: { name: "Jane" },
      positions: [{ subject: { title: "Mayor" }, stance: "endorse" }],
    });

    const [headerSeg, , signatureSeg] = token.split(".");
    const forged = parseSlate(token).payload;
    const first = forged.positions[0];
    if (!first) throw new Error("expected a position to tamper with");
    first.stance = "oppose";
    const forgedSeg = Buffer.from(JSON.stringify(forged)).toString("base64url");
    const tampered = `${headerSeg}.${forgedSeg}.${signatureSeg}`;

    const result = verifySlate(tampered);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("signature");
  });

  test("verify rejects unknown payload fields even when validly signed", () => {
    const keyPair = generateKeyPair();
    const key = encodePublicKey(keyPair.publicKey);
    const token = encodeToken(
      { v: 1, issuer: { key }, issued_at: new Date().toISOString(), positions: [], surprise: "x" },
      { alg: "EdDSA", typ: "openslate+jws", kid: key },
      keyPair.secretKey,
    );

    const result = verifySlate(token);
    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("payload");
  });

  test("a garbage string fails cleanly", () => {
    const result = verifySlate("not-a-token");
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});

describe("identity serialization", () => {
  test("round-trips through StoredIdentity", () => {
    const id = createIdentity({ name: "Org", kind: "organization" });
    const restored = deserializeIdentity(serializeIdentity(id));
    expect(restored.keyPair.publicKey).toEqual(id.keyPair.publicKey);
    expect(restored.keyPair.secretKey).toEqual(id.keyPair.secretKey);
    expect(identityToIssuer(restored).name).toBe("Org");
  });
});

describe("expiry", () => {
  test("expired slate warns but stays structurally valid", () => {
    const { token } = createSlate({
      keyPair: generateKeyPair(),
      issuer: {},
      positions: [],
      issuedAt: new Date("2020-01-01T00:00:00Z"),
      expiresAt: new Date("2020-02-01T00:00:00Z"),
    });

    const result = verifySlate(token);
    expect(result.valid).toBe(true);
    expect(result.warnings.join(" ")).toContain("expired");
  });
});
