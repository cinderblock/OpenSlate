import { describe, expect, test } from "bun:test";
import { ed25519 } from "@noble/curves/ed25519";
import { b64url, generateKeyPair, verify, verifyAsync } from "../src/crypto";
import { createSlate, verifySlate, verifySlateAsync } from "../src/slate";

function slate(name = "Researcher") {
  return createSlate({
    keyPair: generateKeyPair(),
    issuer: { name, kind: "researcher" },
    context: { election: "2026-11-03" },
    positions: [
      {
        subject: { title: "Oakland Mayor", jurisdiction: "us/ca/oakland", election: "2026-11-03" },
        stance: "endorse",
        choice: "Barbara Lee",
      },
    ],
  }).token;
}

/** A token with one character of a segment changed. */
function altered(token: string, segment: number): string {
  const parts = token.split(".");
  const s = parts[segment] ?? "";
  const at = Math.floor(s.length / 2);
  parts[segment] = s.slice(0, at) + (s[at] === "A" ? "B" : "A") + s.slice(at + 1);
  return parts.join(".");
}

describe("verifySlateAsync", () => {
  test("says what verifySlate says", async () => {
    const good = slate();
    const other = slate("Someone else");
    const cases = [
      good,
      altered(good, 1),
      altered(good, 2),
      // One signer's signature on another's slate.
      `${good.split(".").slice(0, 2).join(".")}.${other.split(".")[2]}`,
      "not a token",
      "a.b.c",
    ];
    for (const token of cases) {
      expect(await verifySlateAsync(token)).toEqual(verifySlate(token));
    }
    expect((await verifySlateAsync(good)).valid).toBe(true);
  });

  test("many at once agree too", async () => {
    const tokens = Array.from({ length: 20 }, (_, i) => (i % 3 ? slate() : altered(slate(), 2)));
    const results = await Promise.all(tokens.map((t) => verifySlateAsync(t)));
    expect(results.map((r) => r.valid)).toEqual(tokens.map((t) => verifySlate(t).valid));
  });
});

describe("verifyAsync", () => {
  test("agrees with noble, signed or not", async () => {
    const { publicKey, secretKey } = generateKeyPair();
    const message = new TextEncoder().encode("ballot");
    const signature = ed25519.sign(message, secretKey);
    expect(await verifyAsync(signature, message, publicKey)).toBe(true);
    const flipped = signature.slice();
    flipped[10] = (flipped[10] ?? 0) ^ 1;
    expect(await verifyAsync(flipped, message, publicKey)).toBe(
      verify(flipped, message, publicKey),
    );
    expect(await verifyAsync(signature, new TextEncoder().encode("ballots"), publicKey)).toBe(
      false,
    );
  });

  test("a key that isn't a point is noble's to judge, not an error", async () => {
    // y = 2 isn't on the curve: WebCrypto won't import it.
    const notAPoint = new Uint8Array(32);
    notAPoint[0] = 2;
    const signature = new Uint8Array(64);
    expect(await verifyAsync(signature, new Uint8Array(), notAPoint)).toBe(
      verify(signature, new Uint8Array(), notAPoint),
    );
  });

  test("bytes that are a view into a larger buffer", async () => {
    const { publicKey, secretKey } = generateKeyPair();
    const message = new TextEncoder().encode("view");
    const signature = ed25519.sign(message, secretKey);
    const big = new Uint8Array(200);
    big.set(signature, 7);
    const view = big.subarray(7, 71);
    expect(b64url.encode(view)).toBe(b64url.encode(signature));
    expect(await verifyAsync(view, message, publicKey)).toBe(true);
  });
});
