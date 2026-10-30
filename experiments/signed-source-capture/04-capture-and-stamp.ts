#!/usr/bin/env bun
// Capture URLs verbatim into a bundle, then timestamp its manifest with independent authorities.
//
//   bun experiments/signed-source-capture/04-capture-and-stamp.ts <dir> <url> [url...]
//
// The manifest lists every intended URL before the first request goes out, and every outcome
// after, so a failure can't quietly disappear from the record.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Manifest, recordHop } from "./lib/bundle";
import { capture, sha256 } from "./lib/capture";
import { requestTimestamp } from "./lib/rfc3161";

const USER_AGENT = "openslate-source-capture-exploration (+https://openslate.us)";
const AUTHORITIES = {
  digicert: "http://timestamp.digicert.com",
  sectigo: "http://timestamp.sectigo.com",
};

const [dir, ...urls] = process.argv.slice(2);
if (!dir || !urls.length) throw new Error("usage: 04-capture-and-stamp.ts <dir> <url> [url...]");
mkdirSync(join(dir, "stamps"), { recursive: true });

const manifest: Manifest = {
  format: "openslate-source-capture/spike-1",
  intended: urls,
  capturer: {
    tool: "experiments/signed-source-capture/04-capture-and-stamp.ts",
    user_agent: USER_AGENT,
    runtime: `bun ${Bun.version}`,
    platform: process.platform,
  },
  captures: [],
};

for (const url of urls) {
  const hops = await capture(url, {
    userAgent: USER_AGENT,
    accept: "text/html,application/json,application/pdf,*/*;q=0.8",
  });
  manifest.captures.push({ intended: url, hops: hops.map((hop) => recordHop(dir, hop)) });
}

const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(dir, "manifest.json"), bytes);
const digest = Buffer.from(sha256(bytes), "hex");
console.log(`manifest.json ${bytes.length} bytes, sha256 ${digest.toString("hex")}`);

for (const [name, url] of Object.entries(AUTHORITIES)) {
  const token = await requestTimestamp(url, digest);
  writeFileSync(join(dir, "stamps", `${name}.tsr`), token);
  console.log(`${name}: ${token.length} byte token`);
}
