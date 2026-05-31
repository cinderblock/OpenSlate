#!/usr/bin/env bun
/**
 * Regenerates the OpenSlate conformance test vectors from `vectors-source.ts`.
 * Writes JSON files under `<repo-root>/vectors/`.
 *
 * Run: `bun run vectors:generate` (or directly from packages/core).
 *
 * The vectors are the cross-language conformance artifact: any conforming
 * OpenSlate implementation MUST be able to round-trip every positive vector
 * byte-for-byte, and MUST reject every negative vector with an error that
 * mentions the documented substring.
 */

import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, utf8 } from "../src/canonical";
import { b64url, sign as edSign, encodePublicKey, publicKeyFromSecret } from "../src/crypto";
import { slatePayloadSchema } from "../src/schema";
import { NEGATIVES, type NegativeHelpers, POSITIVES, SEEDS } from "./vectors-source";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const VECTORS_DIR = join(REPO_ROOT, "vectors");

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) throw new Error(`odd-length hex: ${hex}`);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function pubkeyFor(signer: keyof typeof SEEDS): string {
  const seed = SEEDS[signer];
  if (!seed) throw new Error(`unknown signer: ${signer}`);
  return encodePublicKey(publicKeyFromSecret(hexToBytes(seed)));
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function cleanDir(dir: string): void {
  try {
    for (const name of readdirSync(dir)) {
      if (name.endsWith(".json")) rmSync(join(dir, name));
    }
  } catch {
    /* dir may not exist yet */
  }
}

function ensureDir(dir: string): void {
  mkdirSync(dir, { recursive: true });
}

// ─── keys.json ───────────────────────────────────────────────────────────────

ensureDir(VECTORS_DIR);
const keysEntries = Object.entries(SEEDS).map(([name, seedHex]) => {
  const seed = hexToBytes(seedHex);
  const publicKeyBytes = publicKeyFromSecret(seed);
  return [
    name,
    {
      seed_hex: seedHex,
      public_key_hex: Array.from(publicKeyBytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(""),
      public_key: encodePublicKey(publicKeyBytes),
    },
  ] as const;
});
writeJson(join(VECTORS_DIR, "keys.json"), Object.fromEntries(keysEntries));
console.log(`wrote vectors/keys.json (${keysEntries.length} keys)`);

// ─── positive vectors ────────────────────────────────────────────────────────

const POS_DIR = join(VECTORS_DIR, "positive");
ensureDir(POS_DIR);
cleanDir(POS_DIR);

for (const def of POSITIVES) {
  const seed = SEEDS[def.signer];
  if (!seed) throw new Error(`vector ${def.name}: unknown signer ${def.signer}`);
  const secretKey = hexToBytes(seed);
  const issuerKey = encodePublicKey(publicKeyFromSecret(secretKey));

  // Complete the payload by stamping in the derived issuer key.
  const payload = slatePayloadSchema.parse({
    ...def.payload,
    issuer: { ...def.payload.issuer, key: issuerKey },
  });
  const header = { alg: "EdDSA" as const, typ: "openslate+jws" as const, kid: issuerKey };

  const canonicalHeader = canonicalize(header);
  const canonicalPayload = canonicalize(payload);
  const headerSeg = b64url.encode(utf8(canonicalHeader));
  const payloadSeg = b64url.encode(utf8(canonicalPayload));
  const signingInput = `${headerSeg}.${payloadSeg}`;
  const signatureBytes = edSign(utf8(signingInput), secretKey);
  const signature = b64url.encode(signatureBytes);
  const token = `${signingInput}.${signature}`;

  const file = {
    name: def.name,
    description: def.description,
    signer: def.signer,
    payload,
    header,
    canonical_header: canonicalHeader,
    canonical_payload: canonicalPayload,
    signing_input: signingInput,
    signature,
    token,
  };
  writeJson(join(POS_DIR, `${def.name}.json`), file);
  console.log(`wrote vectors/positive/${def.name}.json`);
}

// ─── negative vectors ────────────────────────────────────────────────────────

const NEG_DIR = join(VECTORS_DIR, "negative");
ensureDir(NEG_DIR);
cleanDir(NEG_DIR);

const helpers: NegativeHelpers = {
  pubkey: pubkeyFor,
  seed: (name) => {
    const s = SEEDS[name];
    if (!s) throw new Error(`unknown signer ${name}`);
    return s;
  },
  sign: (header, payload, seedHex) => {
    const secretKey = hexToBytes(seedHex);
    const headerSeg = b64url.encode(utf8(canonicalize(header)));
    const payloadSeg = b64url.encode(utf8(canonicalize(payload)));
    const signingInput = `${headerSeg}.${payloadSeg}`;
    const signature = b64url.encode(edSign(utf8(signingInput), secretKey));
    return `${signingInput}.${signature}`;
  },
};

for (const def of NEGATIVES) {
  const token = def.build(helpers);
  const file = {
    name: def.name,
    description: def.description,
    token,
    expect: def.expect,
  };
  writeJson(join(NEG_DIR, `${def.name}.json`), file);
  console.log(`wrote vectors/negative/${def.name}.json`);
}

console.log(`\nGenerated ${POSITIVES.length} positive + ${NEGATIVES.length} negative vectors.`);
