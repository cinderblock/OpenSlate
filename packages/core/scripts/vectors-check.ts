#!/usr/bin/env bun
/**
 * Conformance check for OpenSlate test vectors.
 *
 * For every positive vector under `vectors/positive/`, re-signs from the input
 * payload using the documented seed and asserts byte-equality of the canonical
 * JSON, signing input, signature, and full token. Then runs `verifySlate` and
 * asserts it accepts the token.
 *
 * For every negative vector under `vectors/negative/`, runs `verifySlate` and
 * asserts it returns invalid with at least one error containing each
 * documented substring.
 *
 * Reimplementations in other languages should do the moral equivalent: read
 * the same JSON files, perform sign/verify, and compare to the same expected
 * outputs. Vectors are the conformance contract.
 *
 * Exits non-zero on any failure. Returns a CheckReport for programmatic use.
 */

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalize, utf8 } from "../src/canonical";
import { b64url, sign as edSign, encodePublicKey, publicKeyFromSecret } from "../src/crypto";
import type { JwsHeader, SlatePayload } from "../src/schema";
import { verifySlate } from "../src/slate";
import { SEEDS } from "./vectors-source";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..", "..");
const VECTORS_DIR = join(REPO_ROOT, "vectors");

export interface CheckReport {
  passed: number;
  failed: { vector: string; reason: string }[];
}

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

interface PositiveVector {
  name: string;
  signer: keyof typeof SEEDS;
  payload: SlatePayload;
  header: JwsHeader;
  canonical_header: string;
  canonical_payload: string;
  signing_input: string;
  signature: string;
  token: string;
}

interface NegativeVector {
  name: string;
  token: string;
  expect: { error_contains: string[] };
}

function readDir(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".json"))
      .map((n) => join(dir, n));
  } catch {
    return [];
  }
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function checkPositive(path: string, report: CheckReport): void {
  const v = readJson<PositiveVector>(path);
  const seedHex = SEEDS[v.signer];
  if (!seedHex) {
    report.failed.push({ vector: v.name, reason: `unknown signer ${v.signer}` });
    return;
  }
  const secretKey = hexToBytes(seedHex);
  const issuerKey = encodePublicKey(publicKeyFromSecret(secretKey));

  if (v.payload.issuer.key !== issuerKey) {
    report.failed.push({
      vector: v.name,
      reason: `payload.issuer.key (${v.payload.issuer.key}) does not match derived key (${issuerKey})`,
    });
    return;
  }

  const canonicalHeader = canonicalize(v.header);
  const canonicalPayload = canonicalize(v.payload);
  const headerSeg = b64url.encode(utf8(canonicalHeader));
  const payloadSeg = b64url.encode(utf8(canonicalPayload));
  const signingInput = `${headerSeg}.${payloadSeg}`;
  const signature = b64url.encode(edSign(utf8(signingInput), secretKey));
  const token = `${signingInput}.${signature}`;

  const mismatches: string[] = [];
  if (canonicalHeader !== v.canonical_header) mismatches.push("canonical_header");
  if (canonicalPayload !== v.canonical_payload) mismatches.push("canonical_payload");
  if (signingInput !== v.signing_input) mismatches.push("signing_input");
  if (signature !== v.signature) mismatches.push("signature");
  if (token !== v.token) mismatches.push("token");

  if (mismatches.length > 0) {
    report.failed.push({
      vector: v.name,
      reason: `regenerated ${mismatches.join(", ")} did not match stored value`,
    });
    return;
  }

  const verified = verifySlate(v.token);
  if (!verified.valid) {
    report.failed.push({
      vector: v.name,
      reason: `verifySlate rejected a positive vector: ${verified.errors.join("; ")}`,
    });
    return;
  }

  report.passed += 1;
}

function checkNegative(path: string, report: CheckReport): void {
  const v = readJson<NegativeVector>(path);
  const result = verifySlate(v.token);
  if (result.valid) {
    report.failed.push({
      vector: v.name,
      reason: "verifySlate accepted a negative vector",
    });
    return;
  }
  const joined = result.errors.join("\n").toLowerCase();
  for (const needle of v.expect.error_contains) {
    if (!joined.includes(needle.toLowerCase())) {
      report.failed.push({
        vector: v.name,
        reason: `expected error to mention "${needle}", got: ${result.errors.join("; ")}`,
      });
      return;
    }
  }
  report.passed += 1;
}

export function runCheck(): CheckReport {
  const report: CheckReport = { passed: 0, failed: [] };
  for (const file of readDir(join(VECTORS_DIR, "positive"))) checkPositive(file, report);
  for (const file of readDir(join(VECTORS_DIR, "negative"))) checkNegative(file, report);
  return report;
}

// Run as CLI when invoked directly.
if (import.meta.main) {
  const report = runCheck();
  for (const f of report.failed) console.error(`FAIL  ${f.vector}: ${f.reason}`);
  console.log(`\n${report.passed} passed, ${report.failed.length} failed`);
  process.exit(report.failed.length === 0 ? 0 : 1);
}
