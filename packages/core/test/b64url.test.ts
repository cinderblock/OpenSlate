import { describe, expect, test } from "bun:test";
import { base64urlnopad } from "@scure/base";
import { b64url } from "../src/crypto";

/** Deterministic bytes, so a failure reproduces. */
function bytes(length: number, seed: number): Uint8Array {
  const out = new Uint8Array(length);
  let s = seed;
  for (let i = 0; i < length; i++) {
    s = (Math.imul(s, 1103515245) + 12345) >>> 0;
    out[i] = s >>> 24;
  }
  return out;
}

describe("b64url", () => {
  test("encodes and decodes exactly as @scure/base's base64urlnopad", () => {
    for (let length = 0; length < 70; length++) {
      for (let seed = 1; seed <= 5; seed++) {
        const input = bytes(length, seed * 7919 + length);
        const encoded = b64url.encode(input);
        expect(encoded).toBe(base64urlnopad.encode(input));
        expect(b64url.decode(encoded)).toEqual(input);
      }
    }
  });

  test("rejects what @scure/base rejects", () => {
    const bad = [
      "A", // a length no bytes encode to
      "AAAAA",
      "AA==", // padding
      "AB+/", // standard base64's alphabet
      "AA AA",
      "AAé",
      "AB", // stray bits in the last character
      "AAB",
    ];
    for (const text of bad) {
      expect(() => base64urlnopad.decode(text)).toThrow();
      expect(() => b64url.decode(text)).toThrow();
    }
  });

  test("the empty string is no bytes", () => {
    expect(b64url.decode("")).toEqual(new Uint8Array());
    expect(b64url.encode(new Uint8Array())).toBe("");
  });
});
