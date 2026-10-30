#!/usr/bin/env bun
// Verify a capture bundle with the network off, and say exactly what it does and doesn't show.
//
//   bun experiments/signed-source-capture/05-verify-bundle.ts <dir> [--expect <published evidence>]
//
// Certificates are checked at the timestamp's time, not today's: a verifier years from now, after
// the certificate expired and the site went away, gets the same answer.

import { X509Certificate } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getRaw, localFirst, type Manifest } from "./lib/bundle";
import { decodeBody, header, parseResponse, sha256 } from "./lib/capture";
import { extractMeasures } from "./lib/extract-omniballot";
import { verifyStamp } from "./lib/rfc3161";

globalThis.fetch = (() => {
  throw new Error("the verifier must not touch the network");
}) as unknown as typeof fetch;

const dir = process.argv[2];
if (!dir) throw new Error("usage: 05-verify-bundle.ts <dir> [--expect <file>]");
const expectFile = process.argv.includes("--expect")
  ? process.argv[process.argv.indexOf("--expect") + 1]
  : undefined;

const manifestBytes = readFileSync(join(dir, "manifest.json"));
const manifest = JSON.parse(manifestBytes.toString("utf8")) as Manifest;
console.log(`manifest sha256 ${sha256(manifestBytes)}`);

// Time first: everything below is judged as of the earliest stamp.
const stamps = await Promise.all(
  readdirSync(join(dir, "stamps")).map(async (file) => ({
    file,
    check: await verifyStamp(readFileSync(join(dir, "stamps", file)), manifestBytes),
  })),
);
if (!stamps.length) throw new Error("no timestamps");
for (const { file, check } of stamps) {
  console.log(
    `  stamp ${file}: ${localFirst(check.gen_time)}, by ${check.signer}, root ${check.root}, ${check.token_bytes} bytes`,
  );
}
const anchor = new Date(Math.min(...stamps.map(({ check }) => Date.parse(check.gen_time))));
console.log(`existed by ${localFirst(anchor.toISOString())}\n`);

let bodyBytes = 0;
for (const { intended, hops } of manifest.captures) {
  console.log(intended);
  for (const hop of hops) {
    getRaw(dir, hop.request_sha256);
    const raw = getRaw(dir, hop.response_sha256);
    const parsed = parseResponse(raw);
    if (parsed.status !== hop.status) throw new Error("manifest status disagrees with the bytes");
    console.log(`  ${hop.status ?? hop.error} ${hop.url}`);
    console.log(
      `    ${hop.tls?.protocol} ${hop.tls?.cipher}, ${hop.response_bytes} response bytes`,
    );

    const chain = (hop.tls?.chain_sha256 ?? []).map(
      (hash) => new X509Certificate(getRaw(dir, hash)),
    );
    const leaf = chain[0];
    if (leaf) {
      const host = new URL(hop.url).hostname;
      const inWindow = chain.every(
        (cert) => anchor >= new Date(cert.validFrom) && anchor <= new Date(cert.validTo),
      );
      const linked = chain.every((cert, i) => {
        const issuer = chain[i + 1];
        return !issuer || cert.verify(issuer.publicKey);
      });
      console.log(
        `    certificate ${leaf.subject.replaceAll("\n", ", ")}, ` +
          `matches host: ${Boolean(leaf.checkHost(host))}, ` +
          `valid at the stamp: ${inWindow}, chain links: ${linked}`,
      );
    }
    if (hop === hops.at(-1) && parsed.status === 200) {
      const decoded = decodeBody(parsed);
      bodyBytes += decoded.length;
      console.log(
        `    body ${decoded.length} bytes (${header(parsed, "content-type")}), sha256 ${sha256(decoded)}`,
      );
      if (expectFile) {
        const again = extractMeasures(decoded, intended);
        const published = readFileSync(expectFile, "utf8").replaceAll("\r\n", "\n");
        console.log(
          `    re-extracted ${again.length} bytes, sha256 ${sha256(again)}; published evidence ` +
            `sha256 ${sha256(published)}: ${again === published ? "IDENTICAL" : "DIFFERENT"}`,
        );
      }
    }
  }
}

console.log(`
Shown: these bytes, this exact request and these certificates existed by the time above, unchanged.
Not shown: that the server sent them. The capturer wrote the manifest, and the certificates are
public, so the capturer could have invented the body. Origin needs a witness or the origin's own
signature; see plans/signed-source-capture.md. (${bodyBytes} body bytes.)`);
