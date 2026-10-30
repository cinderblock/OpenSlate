#!/usr/bin/env bun
// What stops the forgery in 01? A witness that saw the ciphertext arrive from the network. This is
// the smallest hand-rolled proxy witness: a TCP relay that understands nothing about TLS. It dials
// the host itself, hashes both byte streams, and signs what it saw. The client's TLS session runs
// straight through it.
//
//   bun experiments/signed-source-capture/02-witness-relay.ts [url]
//
// Runs on one machine, so the "witness" here is not actually independent: this shows the mechanism
// and its trust boundary, not a usable deployment. The key lives only in memory.

import {
  createHash,
  generateKeyPairSync,
  type KeyObject,
  sign,
  verify,
} from "node:crypto";
import { connect, createServer } from "node:net";
import {
  captureOverTls13,
  forgeResponse,
  type HandshakeBundle,
  verifySavedHandshake,
} from "./lib/tls13";

const url = new URL(
  process.argv[2] ?? "https://ca.omniballot.us/published/06085/1968/vg/lookups.json",
);
const USER_AGENT = "openslate-source-capture-exploration (+https://openslate.us)";

interface Statement {
  host: string;
  port: number;
  c2s_sha256: string;
  s2c_sha256: string;
  started_at: string;
  ended_at: string;
}
interface Attestation {
  statement: Statement;
  signature: string;
}

const signStatement = (statement: Statement, key: KeyObject): Attestation => ({
  statement,
  signature: sign(null, Buffer.from(JSON.stringify(statement)), key).toString("hex"),
});

/** Listen on a local port, relay one connection to host:443, and sign what crossed. */
function startWitness(host: string, key: KeyObject) {
  let done: (attestation: Attestation) => void;
  const attested = new Promise<Attestation>((resolve) => {
    done = resolve;
  });
  const server = createServer((client) => {
    const started_at = new Date().toISOString();
    const upstream = connect(443, host);
    const c2s = createHash("sha256");
    const s2c = createHash("sha256");
    client.on("data", (chunk) => {
      c2s.update(chunk);
      upstream.write(chunk);
    });
    upstream.on("data", (chunk) => {
      s2c.update(chunk);
      client.write(chunk);
    });
    client.on("error", () => upstream.destroy());
    upstream.on("error", () => client.destroy());
    client.on("close", () => upstream.destroy());
    upstream.on("close", () => {
      client.end();
      server.close();
      done(
        signStatement(
          {
            host,
            port: 443,
            c2s_sha256: c2s.digest("hex"),
            s2c_sha256: s2c.digest("hex"),
            started_at,
            ended_at: new Date().toISOString(),
          },
          key,
        ),
      );
    });
  });
  return new Promise<{ port: number; attested: Promise<Attestation> }>((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "string" || !address) throw new Error("no listen address");
      resolve({ port: address.port, attested });
    }),
  );
}

const streamHash = (bundle: HandshakeBundle, dir: "c2s" | "s2c") => {
  const hash = createHash("sha256");
  for (const record of bundle.records) {
    if (record.dir === dir) hash.update(Buffer.from(record.hex, "hex"));
  }
  return hash.digest("hex");
};

/** Everything from 01, plus: a pinned witness signed exactly these bytes for this host. */
function verifyWitnessed(bundle: HandshakeBundle, proof: Attestation, witness: KeyObject) {
  const { statement, signature } = proof;
  const signed = verify(
    null,
    Buffer.from(JSON.stringify(statement)),
    witness,
    Buffer.from(signature, "hex"),
  );
  if (!signed) throw new Error("witness signature does not verify");
  if (statement.host !== bundle.host) throw new Error("witness saw a different host");
  if (statement.c2s_sha256 !== streamHash(bundle, "c2s")) {
    throw new Error("client bytes differ from what the witness saw");
  }
  if (statement.s2c_sha256 !== streamHash(bundle, "s2c")) {
    throw new Error("server bytes differ from what the witness saw");
  }
  return verifySavedHandshake(bundle);
}

function attempt(label: string, bundle: HandshakeBundle, proof: Attestation, key: KeyObject) {
  try {
    const claims = verifyWitnessed(bundle, proof, key);
    console.log(`${label}: ACCEPTED, body ${claims.body_bytes} bytes: ${claims.body_preview}`);
  } catch (error) {
    console.log(`${label}: REJECTED, ${(error as Error).message}`);
  }
}

const witness = generateKeyPairSync("ed25519");
const relay = await startWitness(url.hostname, witness.privateKey);
const real = await captureOverTls13({
  host: url.hostname,
  path: url.pathname + url.search,
  userAgent: USER_AGENT,
  via: { host: "127.0.0.1", port: relay.port },
});
const proof = await relay.attested;
console.log("Witness signed:", proof.statement);
console.log(`Attestation is ${JSON.stringify(proof).length} bytes.\n`);

const FAKE_BODY = '{"forged":"this body never came from the server named in the certificate"}';
const forged = forgeResponse(
  real,
  Buffer.from(
    `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${FAKE_BODY.length}\r\n\r\n${FAKE_BODY}`,
  ),
);

attempt("1. Real capture with its witness", real, proof, witness.publicKey);
attempt("2. The same forgery as 01, against the witness", forged, proof, witness.publicKey);

const stranger = generateKeyPairSync("ed25519");
const selfSigned = signStatement(
  { ...proof.statement, s2c_sha256: streamHash(forged, "s2c") },
  stranger.privateKey,
);
attempt("3. Forger signs its own statement with its own key", forged, selfSigned, witness.publicKey);

// The limit of the idea, stated as a test: a witness that lies is believed.
const colluding = signStatement(
  { ...proof.statement, s2c_sha256: streamHash(forged, "s2c") },
  witness.privateKey,
);
attempt("4. The witness itself colludes and signs the forgery", forged, colluding, witness.publicKey);
