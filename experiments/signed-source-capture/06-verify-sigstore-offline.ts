#!/usr/bin/env bun
// Can a Sigstore bundle from a public GitHub Actions run be checked years later, with no network?
// This verifies a bundle somebody else already published (npm provenance for @sigstore/verify,
// which uses the same Fulcio + Rekor + workflow-identity mechanism `actions/attest` does), so it
// tests the verifier without adding anything to the public transparency log.
//
//   bun experiments/signed-source-capture/06-verify-sigstore-offline.ts <dir>
//
// <dir> holds bundle.json (one Sigstore bundle) and trusted_root.jsonl (`gh attestation
// trusted-root`). Both are data: fetched once, then the network is off from here on.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bundleFromJSON } from "@sigstore/bundle";
import { TrustedRoot } from "@sigstore/protobuf-specs";
import { toSignedEntity, toTrustMaterial, Verifier } from "@sigstore/verify";
import * as pkijs from "pkijs";
import { localFirst } from "./lib/bundle";

globalThis.fetch = (() => {
  throw new Error("the verifier must not touch the network");
}) as unknown as typeof fetch;

const dir = process.argv[2];
if (!dir) throw new Error("usage: 06-verify-sigstore-offline.ts <dir>");

const bundleText = readFileSync(join(dir, "bundle.json"), "utf8");
const roots = readFileSync(join(dir, "trusted_root.jsonl"), "utf8").trim().split("\n");
const publicGood = roots
  .map((line) => JSON.parse(line))
  .find((root) =>
    root.tlogs?.some((log: { baseUrl: string }) => log.baseUrl.includes("rekor.sigstore.dev")),
  );
if (!publicGood) throw new Error("no public-good trust root in trusted_root.jsonl");
const verifier = new Verifier(toTrustMaterial(TrustedRoot.fromJSON(publicGood)));

const check = (text: string) => verifier.verify(toSignedEntity(bundleFromJSON(JSON.parse(text))));

const signer = check(bundleText);
console.log("Bundle verifies, with the network off.");
console.log(
  `  size ${bundleText.length} bytes, trust root ${publicGood ? JSON.stringify(publicGood).length : 0} bytes`,
);

// Fulcio writes the workflow's identity into the certificate as extensions.
const FULCIO_CLAIMS: Record<string, string> = {
  "1.3.6.1.4.1.57264.1.8": "oidc_issuer",
  "1.3.6.1.4.1.57264.1.9": "build_signer_uri",
  "1.3.6.1.4.1.57264.1.10": "build_signer_digest",
  "1.3.6.1.4.1.57264.1.11": "runner_environment",
  "1.3.6.1.4.1.57264.1.12": "source_repository_uri",
  "1.3.6.1.4.1.57264.1.13": "source_repository_digest",
  "1.3.6.1.4.1.57264.1.14": "source_repository_ref",
  "1.3.6.1.4.1.57264.1.20": "build_trigger",
  "1.3.6.1.4.1.57264.1.21": "run_invocation_uri",
};

const raw = JSON.parse(bundleText);
const material = raw.verificationMaterial;
const leafDer = Buffer.from(
  material.certificate?.rawBytes ?? material.x509CertificateChain.certificates[0].rawBytes,
  "base64",
);
const leaf = pkijs.Certificate.fromBER(
  leafDer.buffer.slice(leafDer.byteOffset, leafDer.byteOffset + leafDer.byteLength) as ArrayBuffer,
);
const claims: Record<string, string> = {};
for (const extension of leaf.extensions ?? []) {
  const name = FULCIO_CLAIMS[extension.extnID];
  if (!name) continue;
  // These values are DER UTF8Strings: skip the tag and length.
  const value = Buffer.from(extension.extnValue.valueBlock.valueHexView);
  claims[name] = value
    .subarray((value[1] as number) >= 0x80 ? 2 + ((value[1] as number) & 0x7f) : 2)
    .toString("utf8");
}
console.log("\nWho signed, as certified by Fulcio from GitHub's OIDC token:");
console.log(claims);
console.log(`  signer identity: ${signer.identity?.subjectAlternativeName}`);

const entry = material.tlogEntries?.[0];
console.log("\nTransparency log:");
console.log(
  `  ${entry?.kindVersion?.kind} ${entry?.kindVersion?.version}, log index ${entry?.logIndex}`,
);
if (entry?.integratedTime) {
  console.log(
    `  integrated ${localFirst(new Date(Number(entry.integratedTime) * 1000).toISOString())}`,
  );
}
console.log(
  `  inclusion proof present: ${Boolean(entry?.inclusionProof)}, signed promise: ${Boolean(entry?.inclusionPromise)}`,
);

const statement = JSON.parse(Buffer.from(raw.dsseEnvelope.payload, "base64").toString("utf8"));
console.log("\nWhat it attests:");
console.log(
  `  ${statement.subject[0].name}: ${JSON.stringify(statement.subject[0].digest).slice(0, 90)}...`,
);
console.log(`  predicate ${statement.predicateType}`);

function attempt(label: string, text: string) {
  try {
    check(text);
    console.log(`${label}: ACCEPTED`);
  } catch (error) {
    console.log(`${label}: REJECTED, ${(error as Error).message.split("\n")[0]}`);
  }
}

console.log("\nControls:");
const editedStatement = {
  ...statement,
  subject: [
    {
      name: statement.subject[0].name,
      digest: { sha512: createHash("sha512").update("some other bytes").digest("hex") },
    },
  ],
};
const swapped = structuredClone(raw);
swapped.dsseEnvelope.payload = Buffer.from(JSON.stringify(editedStatement)).toString("base64");
attempt("1. Point the attestation at different bytes", JSON.stringify(swapped));

const reSigned = structuredClone(raw);
const signature = Buffer.from(reSigned.dsseEnvelope.signatures[0].sig, "base64");
signature[10] = (signature[10] as number) ^ 1;
reSigned.dsseEnvelope.signatures[0].sig = signature.toString("base64");
attempt("2. Flip one bit of the signature", JSON.stringify(reSigned));

const delisted = structuredClone(raw);
delisted.verificationMaterial.tlogEntries = [];
attempt("3. Remove the transparency log entry", JSON.stringify(delisted));
