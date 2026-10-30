#!/usr/bin/env bun
// Can a saved TLS handshake prove what a server sent? Captures one real HTTPS exchange, runs the
// strictest verifier a saved handshake allows, then forges a different response and runs the same
// verifier again. Three control tampers show the verifier isn't a rubber stamp.
//
//   bun experiments/signed-source-capture/01-forge-saved-handshake.ts [url]
//
// The forged body is an obviously fake marker, never anything an organization might have said, and
// neither bundle is written to disk.

import { randomBytes } from "node:crypto";
import {
  captureOverTls13,
  forgeHandshake,
  forgeResponse,
  type HandshakeBundle,
  verifySavedHandshake,
} from "./lib/tls13";

const url = new URL(
  process.argv[2] ?? "https://ca.omniballot.us/published/06085/1968/vg/lookups.json",
);
const USER_AGENT = "openslate-source-capture-exploration (+https://openslate.us)";

const FAKE_BODY = '{"forged":"this body never came from the server named in the certificate"}';
const FAKE_RESPONSE = Buffer.from(
  `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${FAKE_BODY.length}\r\n\r\n${FAKE_BODY}`,
);

function attempt(label: string, bundle: HandshakeBundle): void {
  try {
    const claims = verifySavedHandshake(bundle);
    console.log(`${label}: ACCEPTED`);
    console.log(claims);
  } catch (error) {
    console.log(`${label}: REJECTED, ${(error as Error).message}`);
  }
}

/** Flip one bit in a record, addressed by its index among records of one direction. */
function flip(bundle: HandshakeBundle, dir: "c2s" | "s2c", index: number, at: number) {
  const records = bundle.records.map((record) => ({ ...record }));
  const target = records.filter((record) => record.dir === dir).at(index);
  if (!target) throw new Error("no such record");
  const bytes = Buffer.from(target.hex, "hex");
  bytes[at] = (bytes[at] as number) ^ 1;
  target.hex = bytes.toString("hex");
  return { ...bundle, records };
}

const real = await captureOverTls13({
  host: url.hostname,
  path: url.pathname + url.search,
  userAgent: USER_AGENT,
});
const wireBytes = real.records.reduce((sum, record) => sum + record.hex.length / 2, 0);
console.log(`Captured ${real.records.length} TLS records, ${wireBytes} bytes on the wire.\n`);

attempt("1. Real capture", real);
console.log();
attempt("2. FORGED response, same handshake, re-encrypted by the client", forgeResponse(real, FAKE_RESPONSE));
console.log();
attempt("3. Control: one bit flipped in real ciphertext, no keys used", flip(real, "s2c", -2, 40));
attempt("4. Control: one bit flipped in the ServerHello", flip(real, "s2c", 0, 20));
attempt("5. Control: claim the capture was for another host", { ...real, host: "example.org" });
attempt("6. Control: claim a capture date years outside the cert's validity", {
  ...real,
  captured_at: "2019-01-01T00:00:00.000Z",
});
console.log();
attempt(
  "7. Forged handshake (new client_random; every MAC redone, only the server signature reused)",
  forgeHandshake(real, randomBytes(32)),
);
