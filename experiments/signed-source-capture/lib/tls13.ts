// A minimal TLS 1.3 client and a strict verifier for what it records. This is a research spike, not
// a production client: x25519 only, two AES-GCM suites, HTTP/1.1, no session resumption.
//
// It exists so the forgery test is fair. Because this client owns its ephemeral key, the verifier
// can be given that key and recompute the *entire* RFC 8446 key schedule from the wire bytes. That
// is the strictest check a "saved handshake" verifier could possibly run; a keylog-only verifier
// checks strictly less.

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  constants as cryptoConstants,
  diffieHellman,
  generateKeyPairSync,
  randomBytes,
  verify as signatureVerify,
  X509Certificate,
} from "node:crypto";
import { connect as tcpConnect } from "node:net";
import { rootCertificates } from "node:tls";

// ---------------------------------------------------------------- bundle shape

export type Direction = "c2s" | "s2c";
export interface WireRecord {
  dir: Direction;
  hex: string;
}

/** Everything a "save the HTTPS details" capture could keep. */
export interface HandshakeBundle {
  host: string;
  port: number;
  captured_at: string;
  /** Every TLS record, both directions, in order, as it crossed the socket. */
  records: WireRecord[];
  /** The client's ephemeral x25519 private key, disclosed so a verifier can re-derive everything. */
  client_x25519_private: string;
}

// ---------------------------------------------------------------- key schedule (RFC 8446 §7)

interface Suite {
  id: number;
  hash: "sha256" | "sha384";
  hashLen: number;
  keyLen: number;
  cipher: "aes-128-gcm" | "aes-256-gcm";
}

const SUITES: Record<number, Suite> = {
  0x1301: { id: 0x1301, hash: "sha256", hashLen: 32, keyLen: 16, cipher: "aes-128-gcm" },
  0x1302: { id: 0x1302, hash: "sha384", hashLen: 48, keyLen: 32, cipher: "aes-256-gcm" },
};

const hmac = (hash: string, key: Buffer, data: Buffer) =>
  createHmac(hash, key).update(data).digest();
const digest = (hash: string, data: Buffer) => createHash(hash).update(data).digest();

function hkdfExpand(hash: string, prk: Buffer, info: Buffer, length: number): Buffer {
  const out: Buffer[] = [];
  let previous = Buffer.alloc(0);
  for (let i = 1; Buffer.concat(out).length < length; i++) {
    previous = hmac(hash, prk, Buffer.concat([previous, info, Buffer.from([i])]));
    out.push(previous);
  }
  return Buffer.concat(out).subarray(0, length);
}

function expandLabel(
  hash: string,
  secret: Buffer,
  label: string,
  context: Buffer,
  length: number,
): Buffer {
  const full = Buffer.from(`tls13 ${label}`);
  const info = Buffer.concat([
    u16(length),
    Buffer.from([full.length]),
    full,
    Buffer.from([context.length]),
    context,
  ]);
  return hkdfExpand(hash, secret, info, length);
}

export interface Traffic {
  key: Buffer;
  iv: Buffer;
  seq: bigint;
}

const trafficKeys = (suite: Suite, secret: Buffer): Traffic => ({
  key: expandLabel(suite.hash, secret, "key", Buffer.alloc(0), suite.keyLen),
  iv: expandLabel(suite.hash, secret, "iv", Buffer.alloc(0), 12),
  seq: 0n,
});

const finishedMac = (suite: Suite, baseSecret: Buffer, transcriptHash: Buffer) =>
  hmac(
    suite.hash,
    expandLabel(suite.hash, baseSecret, "finished", Buffer.alloc(0), suite.hashLen),
    transcriptHash,
  );

interface HandshakeSecrets {
  clientHs: Buffer;
  serverHs: Buffer;
  master: Buffer;
}

function handshakeSecrets(suite: Suite, ecdhe: Buffer, helloHash: Buffer): HandshakeSecrets {
  const { hash, hashLen } = suite;
  const zero = Buffer.alloc(hashLen);
  const empty = digest(hash, Buffer.alloc(0));
  const early = hmac(hash, zero, zero);
  const derived = expandLabel(hash, early, "derived", empty, hashLen);
  const handshake = hmac(hash, derived, ecdhe);
  return {
    clientHs: expandLabel(hash, handshake, "c hs traffic", helloHash, hashLen),
    serverHs: expandLabel(hash, handshake, "s hs traffic", helloHash, hashLen),
    master: hmac(hash, expandLabel(hash, handshake, "derived", empty, hashLen), zero),
  };
}

const applicationSecrets = (suite: Suite, master: Buffer, finishedHash: Buffer) => ({
  client: expandLabel(suite.hash, master, "c ap traffic", finishedHash, suite.hashLen),
  server: expandLabel(suite.hash, master, "s ap traffic", finishedHash, suite.hashLen),
});

// ---------------------------------------------------------------- records

const u16 = (n: number) => Buffer.from([n >> 8, n & 0xff]);
const u24 = (n: number) => Buffer.from([n >> 16, (n >> 8) & 0xff, n & 0xff]);

const CONTENT = { ccs: 20, alert: 21, handshake: 22, application: 23 } as const;
const HS = { serverHello: 2, encryptedExtensions: 8, certificate: 11 } as const;
const HS_CERT_VERIFY = 15;
const HS_FINISHED = 20;

function nonce(t: Traffic): Buffer {
  const n = Buffer.from(t.iv);
  const seq = Buffer.alloc(8);
  seq.writeBigUInt64BE(t.seq);
  for (let i = 0; i < 8; i++) n[4 + i] = (n[4 + i] as number) ^ (seq[i] as number);
  return n;
}

export function seal(suite: Suite, t: Traffic, type: number, content: Buffer): Buffer {
  const inner = Buffer.concat([content, Buffer.from([type])]);
  const header = Buffer.from([CONTENT.application, 3, 3, ...u16(inner.length + 16)]);
  const cipher = createCipheriv(suite.cipher, t.key, nonce(t));
  cipher.setAAD(header);
  const body = Buffer.concat([cipher.update(inner), cipher.final(), cipher.getAuthTag()]);
  t.seq++;
  return Buffer.concat([header, body]);
}

export function open(
  suite: Suite,
  t: Traffic,
  record: Buffer,
): { type: number; content: Buffer } {
  const header = record.subarray(0, 5);
  const body = record.subarray(5);
  const decipher = createDecipheriv(suite.cipher, t.key, nonce(t));
  decipher.setAAD(header);
  decipher.setAuthTag(body.subarray(body.length - 16));
  const inner = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  t.seq++;
  let end = inner.length;
  while (end > 0 && inner[end - 1] === 0) end--;
  if (end === 0) throw new Error("record has no inner content type");
  return { type: inner[end - 1] as number, content: inner.subarray(0, end - 1) };
}

/** Pull whole records off the front of a byte stream. */
function takeRecords(buffer: Buffer): { records: Buffer[]; rest: Buffer } {
  const records: Buffer[] = [];
  let at = 0;
  while (buffer.length - at >= 5) {
    const length = buffer.readUInt16BE(at + 3);
    if (buffer.length - at < 5 + length) break;
    records.push(buffer.subarray(at, at + 5 + length));
    at += 5 + length;
  }
  return { records, rest: buffer.subarray(at) };
}

/** Pull whole handshake messages off the front of a byte stream. */
function takeMessages(buffer: Buffer): { messages: Buffer[]; rest: Buffer } {
  const messages: Buffer[] = [];
  let at = 0;
  while (buffer.length - at >= 4) {
    const length = buffer.readUIntBE(at + 1, 3);
    if (buffer.length - at < 4 + length) break;
    messages.push(buffer.subarray(at, at + 4 + length));
    at += 4 + length;
  }
  return { messages, rest: buffer.subarray(at) };
}

// ---------------------------------------------------------------- hello messages

const X25519_PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");
const X25519_SPKI = Buffer.from("302a300506032b656e032100", "hex");

export function x25519Public(privateRaw: Buffer): Buffer {
  const key = createPrivateKey({
    key: Buffer.concat([X25519_PKCS8, privateRaw]),
    format: "der",
    type: "pkcs8",
  });
  const der = createPublicKey(key).export({ type: "spki", format: "der" }) as Buffer;
  return der.subarray(der.length - 32);
}

function x25519Shared(privateRaw: Buffer, peerRaw: Buffer): Buffer {
  return diffieHellman({
    privateKey: createPrivateKey({
      key: Buffer.concat([X25519_PKCS8, privateRaw]),
      format: "der",
      type: "pkcs8",
    }),
    publicKey: createPublicKey({
      key: Buffer.concat([X25519_SPKI, peerRaw]),
      format: "der",
      type: "spki",
    }),
  });
}

const extension = (type: number, data: Buffer) =>
  Buffer.concat([u16(type), u16(data.length), data]);

export function clientHello(host: string, clientPublic: Buffer, random: Buffer): Buffer {
  const name = Buffer.from(host);
  const groups = [0x001d];
  const schemes = [0x0403, 0x0503, 0x0804, 0x0805, 0x0806, 0x0807, 0x0401];
  const extensions = Buffer.concat([
    extension(
      0x0000,
      Buffer.concat([u16(name.length + 3), Buffer.from([0]), u16(name.length), name]),
    ),
    extension(0x000a, Buffer.concat([u16(groups.length * 2), ...groups.map(u16)])),
    extension(0x000d, Buffer.concat([u16(schemes.length * 2), ...schemes.map(u16)])),
    extension(0x0010, Buffer.concat([u16(9), Buffer.from([8]), Buffer.from("http/1.1")])),
    extension(0x002b, Buffer.from([2, 3, 4])),
    extension(0x002d, Buffer.from([1, 1])),
    extension(0x0033, Buffer.concat([u16(36), u16(0x001d), u16(32), clientPublic])),
  ]);
  const suites = [0x1301, 0x1302];
  const sessionId = randomBytes(32);
  const body = Buffer.concat([
    Buffer.from([3, 3]),
    random,
    Buffer.from([sessionId.length]),
    sessionId,
    u16(suites.length * 2),
    ...suites.map(u16),
    Buffer.from([1, 0]),
    u16(extensions.length),
    extensions,
  ]);
  return Buffer.concat([Buffer.from([1]), u24(body.length), body]);
}

/** Walk a hello's extensions; `offset` is the first byte after the fixed part. */
function helloExtensions(message: Buffer, offset: number): Map<number, Buffer> {
  const found = new Map<number, Buffer>();
  let at = offset + 2;
  const end = at + message.readUInt16BE(offset);
  while (at < end) {
    const type = message.readUInt16BE(at);
    const length = message.readUInt16BE(at + 2);
    found.set(type, message.subarray(at + 4, at + 4 + length));
    at += 4 + length;
  }
  return found;
}

function clientHelloKeyShare(message: Buffer): Buffer {
  // 4 header + 2 version + 32 random, then session id, suites and compression.
  let at = 38;
  at += 1 + (message[at] as number);
  at += 2 + message.readUInt16BE(at);
  at += 1 + (message[at] as number);
  const share = helloExtensions(message, at).get(0x0033);
  if (!share) throw new Error("ClientHello has no key_share");
  return share.subarray(share.length - 32);
}

const HELLO_RETRY = Buffer.from(
  "cf21ad74e59a6111be1d8c021e65b891c2a211167abb8c5e079e09e2c8a8339c",
  "hex",
);

function parseServerHello(message: Buffer): { suite: Suite; peer: Buffer } {
  if (message[0] !== HS.serverHello) throw new Error("expected ServerHello");
  if (message.subarray(6, 38).equals(HELLO_RETRY)) {
    throw new Error("server sent HelloRetryRequest; this spike only offers x25519");
  }
  let at = 38;
  at += 1 + (message[at] as number);
  const suite = SUITES[message.readUInt16BE(at)];
  if (!suite) throw new Error(`server chose unsupported suite ${message.readUInt16BE(at)}`);
  at += 3;
  const share = helloExtensions(message, at).get(0x0033);
  if (!share || share.readUInt16BE(0) !== 0x001d) throw new Error("no x25519 key share");
  return { suite, peer: share.subarray(4, 36) };
}

// ---------------------------------------------------------------- certificates

function parseCertificates(message: Buffer): Buffer[] {
  const certificates: Buffer[] = [];
  let at = 4 + 1 + (message[4] as number) + 3;
  while (at < message.length) {
    const length = message.readUIntBE(at, 3);
    certificates.push(message.subarray(at + 3, at + 3 + length));
    at += 3 + length;
    at += 2 + message.readUInt16BE(at);
  }
  return certificates;
}

const TRUST = rootCertificates.map((pem) => new X509Certificate(pem));

function verifyChain(ders: Buffer[], host: string, at: Date): string[] {
  const chain = ders.map((der) => new X509Certificate(der));
  const leaf = chain[0];
  if (!leaf) throw new Error("server sent no certificate");
  if (!leaf.checkHost(host)) throw new Error(`certificate is not valid for ${host}`);
  chain.forEach((cert, i) => {
    if (at < new Date(cert.validFrom) || at > new Date(cert.validTo)) {
      throw new Error(`certificate ${i} is outside its validity window at capture time`);
    }
    const issuer = chain[i + 1];
    if (issuer && !cert.verify(issuer.publicKey)) {
      throw new Error(`certificate ${i} is not signed by certificate ${i + 1}`);
    }
  });
  const top = chain[chain.length - 1] as X509Certificate;
  const root = TRUST.find((candidate) => {
    if (candidate.subject !== top.issuer) return false;
    try {
      return top.verify(candidate.publicKey);
    } catch {
      return false;
    }
  });
  const selfRooted = TRUST.some((candidate) => candidate.fingerprint256 === top.fingerprint256);
  if (!root && !selfRooted) throw new Error("chain does not reach a public web root");
  return chain.map((cert) => cert.subject.replaceAll("\n", ", "));
}

function verifyCertificateVerify(message: Buffer, leafDer: Buffer, transcriptHash: Buffer): number {
  const scheme = message.readUInt16BE(4);
  const signature = message.subarray(8, 8 + message.readUInt16BE(6));
  const content = Buffer.concat([
    Buffer.alloc(64, 0x20),
    Buffer.from("TLS 1.3, server CertificateVerify"),
    Buffer.from([0]),
    transcriptHash,
  ]);
  const key = new X509Certificate(leafDer).publicKey;
  const pss = (hash: string, saltLength: number) =>
    signatureVerify(
      hash,
      content,
      { key, padding: cryptoConstants.RSA_PKCS1_PSS_PADDING, saltLength },
      signature,
    );
  const verdicts: Record<number, () => boolean> = {
    0x0403: () => signatureVerify("sha256", content, key, signature),
    0x0503: () => signatureVerify("sha384", content, key, signature),
    0x0804: () => pss("sha256", 32),
    0x0805: () => pss("sha384", 48),
    0x0806: () => pss("sha512", 64),
    0x0807: () => signatureVerify(null, content, key, signature),
  };
  const check = verdicts[scheme];
  if (!check) throw new Error(`unsupported signature scheme ${scheme.toString(16)}`);
  if (!check()) throw new Error("server's CertificateVerify signature does not verify");
  return scheme;
}

// ---------------------------------------------------------------- walking a bundle

export interface Walk {
  suite: Suite;
  /** Everything up to and including client Finished, verbatim. */
  handshakeRecords: WireRecord[];
  /** Application keys, for whoever holds the ephemeral key. */
  serverApplicationSecret: Buffer;
  clientApplicationSecret: Buffer;
  helloPlaintext: { clientHello: Buffer; serverHello: Buffer };
  /** Plaintext handshake messages after the hellos, up to server Finished. */
  serverFlight: Buffer[];
  /** Records after the handshake. */
  after: WireRecord[];
  certificateSubjects: string[];
  signatureScheme: number;
}

const concat = (buffers: Buffer[]) => Buffer.concat(buffers);

/** Replay the handshake part of a bundle, checking everything a verifier could check. */
export function walkHandshake(bundle: HandshakeBundle): Walk {
  const records = bundle.records.map((r) => ({ dir: r.dir, bytes: Buffer.from(r.hex, "hex") }));
  const clientRecords = records.filter((r) => r.dir === "c2s");
  const firstClient = clientRecords[0];
  if (!firstClient) throw new Error("no ClientHello");
  const clientHelloMessage = firstClient.bytes.subarray(5);
  const privateRaw = Buffer.from(bundle.client_x25519_private, "hex");
  if (!x25519Public(privateRaw).equals(clientHelloKeyShare(clientHelloMessage))) {
    throw new Error("disclosed ephemeral key does not match the ClientHello");
  }

  const firstServerAt = records.findIndex((r) => r.dir === "s2c");
  const firstServer = records[firstServerAt];
  if (!firstServer || firstServer.bytes[0] !== CONTENT.handshake) throw new Error("no ServerHello");
  const serverHelloMessage = firstServer.bytes.subarray(5);
  const { suite, peer } = parseServerHello(serverHelloMessage);

  const hash = suite.hash;
  const hellos = concat([clientHelloMessage, serverHelloMessage]);
  const secrets = handshakeSecrets(suite, x25519Shared(privateRaw, peer), digest(hash, hellos));

  // The server's flight.
  const serverKeys = trafficKeys(suite, secrets.serverHs);
  const transcript: Buffer[] = [clientHelloMessage, serverHelloMessage];
  const serverFlight: Buffer[] = [];
  let pending = Buffer.alloc(0);
  let serverFinishedAt = -1;
  let leaf: Buffer | undefined;
  let subjects: string[] = [];
  let scheme = 0;
  for (let i = firstServerAt + 1; i < records.length && serverFinishedAt < 0; i++) {
    const record = records[i] as (typeof records)[number];
    if (record.dir !== "s2c" || record.bytes[0] === CONTENT.ccs) continue;
    const { type, content } = open(suite, serverKeys, record.bytes);
    if (type !== CONTENT.handshake) throw new Error(`unexpected record type ${type} in handshake`);
    const taken = takeMessages(concat([pending, content]));
    pending = taken.rest;
    for (const message of taken.messages) {
      const before = digest(hash, concat(transcript));
      if (message[0] === HS.certificate) {
        const ders = parseCertificates(message);
        leaf = ders[0];
        subjects = verifyChain(ders, bundle.host, new Date(bundle.captured_at));
      } else if (message[0] === HS_CERT_VERIFY) {
        if (!leaf) throw new Error("CertificateVerify before Certificate");
        scheme = verifyCertificateVerify(message, leaf, before);
      } else if (message[0] === HS_FINISHED) {
        const expected = finishedMac(suite, secrets.serverHs, before);
        if (!expected.equals(message.subarray(4))) throw new Error("server Finished is wrong");
        serverFinishedAt = i;
      } else if (message[0] !== HS.encryptedExtensions) {
        throw new Error(`unexpected handshake message ${message[0]}`);
      }
      transcript.push(message);
      serverFlight.push(message);
    }
  }
  if (serverFinishedAt < 0) throw new Error("no server Finished");
  if (!scheme) throw new Error("server never proved possession of its certificate key");

  // Client Finished.
  const finishedHash = digest(hash, concat(transcript));
  const clientKeys = trafficKeys(suite, secrets.clientHs);
  let clientFinishedAt = -1;
  for (let i = firstServerAt + 1; i < records.length && clientFinishedAt < 0; i++) {
    const record = records[i] as (typeof records)[number];
    if (record.dir !== "c2s" || record.bytes[0] === CONTENT.ccs) continue;
    const { type, content } = open(suite, clientKeys, record.bytes);
    const expected = finishedMac(suite, secrets.clientHs, finishedHash);
    if (type !== CONTENT.handshake || !content.subarray(4).equals(expected)) {
      throw new Error("client Finished is wrong");
    }
    clientFinishedAt = i;
  }
  if (clientFinishedAt < 0) throw new Error("no client Finished");

  const boundary = Math.max(serverFinishedAt, clientFinishedAt);
  const application = applicationSecrets(suite, secrets.master, finishedHash);
  return {
    suite,
    handshakeRecords: bundle.records.slice(0, boundary + 1),
    serverApplicationSecret: application.server,
    clientApplicationSecret: application.client,
    helloPlaintext: { clientHello: clientHelloMessage, serverHello: serverHelloMessage },
    serverFlight,
    after: bundle.records.slice(boundary + 1),
    certificateSubjects: subjects,
    signatureScheme: scheme,
  };
}

/** Decrypt the application data. Any bad tag throws. */
export function readApplication(walk: Walk): { request: Buffer; response: Buffer; closed: boolean } {
  const server = trafficKeys(walk.suite, walk.serverApplicationSecret);
  const client = trafficKeys(walk.suite, walk.clientApplicationSecret);
  const request: Buffer[] = [];
  const response: Buffer[] = [];
  let closed = false;
  for (const record of walk.after) {
    const bytes = Buffer.from(record.hex, "hex");
    if (bytes[0] === CONTENT.ccs) continue;
    const { type, content } = open(walk.suite, record.dir === "s2c" ? server : client, bytes);
    if (type === CONTENT.application) (record.dir === "s2c" ? response : request).push(content);
    else if (type === CONTENT.alert && content[1] === 0) closed = true;
    // Handshake records here are NewSessionTickets, which carry nothing we report.
  }
  return { request: concat(request), response: concat(response), closed };
}

export interface HttpResponse {
  status: number;
  headers: [string, string][];
  body: Buffer;
}

export function parseHttpResponse(raw: Buffer): HttpResponse {
  const split = raw.indexOf("\r\n\r\n");
  if (split < 0) throw new Error("no end of HTTP headers");
  const lines = raw.subarray(0, split).toString("latin1").split("\r\n");
  const status = Number((lines[0] as string).split(" ")[1]);
  const headers = lines.slice(1).map((line): [string, string] => {
    const at = line.indexOf(":");
    return [line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim()];
  });
  const rest = raw.subarray(split + 4);
  const chunked = headers.some(
    ([name, value]) => name === "transfer-encoding" && value.toLowerCase().includes("chunked"),
  );
  if (!chunked) return { status, headers, body: rest };
  const body: Buffer[] = [];
  let at = 0;
  while (at < rest.length) {
    const end = rest.indexOf("\r\n", at);
    const size = Number.parseInt(rest.subarray(at, end).toString("latin1"), 16);
    if (!size) break;
    body.push(rest.subarray(end + 2, end + 2 + size));
    at = end + 2 + size + 2;
  }
  return { status, headers, body: Buffer.concat(body) };
}

// ---------------------------------------------------------------- the forger's tools

/**
 * Rewrite everything after the handshake using only what the capturing client already holds.
 * No server, no certificate key: just the same traffic secret the client used to read the page.
 */
export function forgeResponse(bundle: HandshakeBundle, fakeResponse: Buffer): HandshakeBundle {
  const walk = walkHandshake(bundle);
  const server = trafficKeys(walk.suite, walk.serverApplicationSecret);
  const forged: WireRecord[] = [];
  for (let at = 0; at < fakeResponse.length; at += 16000) {
    const chunk = fakeResponse.subarray(at, at + 16000);
    forged.push({
      dir: "s2c",
      hex: seal(walk.suite, server, CONTENT.application, chunk).toString("hex"),
    });
  }
  forged.push({
    dir: "s2c",
    hex: seal(walk.suite, server, CONTENT.alert, Buffer.from([1, 0])).toString("hex"),
  });
  return {
    ...bundle,
    records: [...walk.handshakeRecords, ...walk.after.filter((r) => r.dir === "c2s"), ...forged],
  };
}

/**
 * Try to move a real handshake onto a transcript of the forger's choosing. The forger can redo all
 * the symmetric crypto, including both Finished MACs. The one thing it cannot redo is the server's
 * signature, so this must fail at CertificateVerify and nowhere else.
 */
export function forgeHandshake(bundle: HandshakeBundle, newRandom: Buffer): HandshakeBundle {
  const walk = walkHandshake(bundle);
  const { suite } = walk;
  const hash = suite.hash;
  const message = Buffer.from(walk.helloPlaintext.clientHello);
  newRandom.copy(message, 6);
  const clientRecord = Buffer.concat([
    Buffer.from([CONTENT.handshake, 3, 1]),
    u16(message.length),
    message,
  ]);
  const serverHello = walk.helloPlaintext.serverHello;
  const serverRecord = Buffer.concat([
    Buffer.from([CONTENT.handshake, 3, 3]),
    u16(serverHello.length),
    serverHello,
  ]);
  const privateRaw = Buffer.from(bundle.client_x25519_private, "hex");
  const { peer } = parseServerHello(serverHello);
  const ecdhe = x25519Shared(privateRaw, peer);
  const secrets = handshakeSecrets(suite, ecdhe, digest(hash, concat([message, serverHello])));
  const serverKeys = trafficKeys(suite, secrets.serverHs);

  const transcript = [message, serverHello];
  const flight: Buffer[] = [];
  for (const original of walk.serverFlight) {
    const replacement =
      original[0] === HS_FINISHED
        ? concat([
            original.subarray(0, 4),
            finishedMac(suite, secrets.serverHs, digest(hash, concat(transcript))),
          ])
        : original;
    transcript.push(replacement);
    flight.push(seal(suite, serverKeys, CONTENT.handshake, replacement));
  }
  const finishedHash = digest(hash, concat(transcript));
  const finished = concat([
    Buffer.from([HS_FINISHED]),
    u24(suite.hashLen),
    finishedMac(suite, secrets.clientHs, finishedHash),
  ]);
  const clientFinished = seal(
    suite,
    trafficKeys(suite, secrets.clientHs),
    CONTENT.handshake,
    finished,
  );
  return {
    ...bundle,
    records: [
      { dir: "c2s", hex: clientRecord.toString("hex") },
      { dir: "s2c", hex: serverRecord.toString("hex") },
      ...flight.map((r): WireRecord => ({ dir: "s2c", hex: r.toString("hex") })),
      { dir: "c2s", hex: clientFinished.toString("hex") },
    ],
  };
}

// ---------------------------------------------------------------- the live client

export interface FetchOptions {
  host: string;
  path: string;
  userAgent: string;
  /** Where to open the TCP connection, if not the host itself (a witness relay). */
  via?: { host: string; port: number };
}

/** One GET over a fresh TLS 1.3 connection, recording every record. */
export function captureOverTls13(options: FetchOptions): Promise<HandshakeBundle> {
  const { host, path, userAgent, via } = options;
  const keyPair = generateKeyPairSync("x25519");
  const privateDer = keyPair.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;
  const privateRaw = Buffer.from(privateDer.subarray(privateDer.length - 32));
  const hello = clientHello(host, x25519Public(privateRaw), randomBytes(32));
  const request = Buffer.from(
    `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: ${userAgent}\r\n` +
      "Accept: */*\r\nAccept-Encoding: identity\r\nConnection: close\r\n\r\n",
  );

  return new Promise((resolve, reject) => {
    const records: WireRecord[] = [];
    const captured_at = new Date().toISOString();
    const finish = () =>
      resolve({
        host,
        port: 443,
        captured_at,
        records,
        client_x25519_private: privateRaw.toString("hex"),
      });
    const socket = tcpConnect(via?.port ?? 443, via?.host ?? host);
    const send = (dir: Direction, bytes: Buffer) => {
      records.push({ dir, hex: bytes.toString("hex") });
      socket.write(bytes);
    };

    let suite: Suite | undefined;
    let secrets: HandshakeSecrets | undefined;
    let serverHs: Traffic | undefined;
    let serverAp: Traffic | undefined;
    const transcript: Buffer[] = [hello];
    let flight = Buffer.alloc(0);
    let buffer = Buffer.alloc(0);

    socket.on("connect", () =>
      send("c2s", Buffer.concat([Buffer.from([22, 3, 1]), u16(hello.length), hello])),
    );
    socket.on("error", reject);
    socket.on("close", finish);
    socket.on("data", (chunk: Buffer) => {
      try {
        buffer = Buffer.concat([buffer, chunk]);
        const taken = takeRecords(buffer);
        buffer = taken.rest;
        for (const record of taken.records) {
          records.push({ dir: "s2c", hex: Buffer.from(record).toString("hex") });
          if (record[0] === CONTENT.ccs) continue;
          if (record[0] === CONTENT.alert) throw new Error(`TLS alert ${record.toString("hex")}`);
          if (!suite) {
            const message = record.subarray(5);
            const parsed = parseServerHello(message);
            suite = parsed.suite;
            transcript.push(message);
            secrets = handshakeSecrets(
              suite,
              x25519Shared(privateRaw, parsed.peer),
              digest(suite.hash, concat(transcript)),
            );
            serverHs = trafficKeys(suite, secrets.serverHs);
            continue;
          }
          if (serverAp) {
            open(suite, serverAp, record);
            continue;
          }
          const { type, content } = open(suite, serverHs as Traffic, record);
          if (type !== CONTENT.handshake) throw new Error(`unexpected record ${type}`);
          const messages = takeMessages(concat([flight, content]));
          flight = messages.rest;
          for (const message of messages.messages) {
            transcript.push(message);
            if (message[0] !== HS_FINISHED) continue;
            const done = secrets as HandshakeSecrets;
            const finishedHash = digest(suite.hash, concat(transcript));
            const clientFinished = concat([
              Buffer.from([HS_FINISHED]),
              u24(suite.hashLen),
              finishedMac(suite, done.clientHs, finishedHash),
            ]);
            const application = applicationSecrets(suite, done.master, finishedHash);
            serverAp = trafficKeys(suite, application.server);
            send("c2s", Buffer.from([20, 3, 3, 0, 1, 1]));
            send(
              "c2s",
              seal(
                suite,
                trafficKeys(suite, done.clientHs),
                CONTENT.handshake,
                clientFinished,
              ),
            );
            send(
              "c2s",
              seal(
                suite,
                trafficKeys(suite, application.client),
                CONTENT.application,
                request,
              ),
            );
          }
        }
      } catch (error) {
        socket.destroy();
        reject(error);
      }
    });
  });
}

/** Run every check a saved-handshake verifier could run, and report what it would conclude. */
export function verifySavedHandshake(bundle: HandshakeBundle) {
  const walk = walkHandshake(bundle);
  const { request, response, closed } = readApplication(walk);
  const http = parseHttpResponse(response);
  return {
    host: bundle.host,
    certificate: walk.certificateSubjects[0],
    signature_scheme: `0x${walk.signatureScheme.toString(16)}`,
    cipher: walk.suite.cipher,
    request_line: request.toString("latin1").split("\r\n")[0],
    status: http.status,
    body_bytes: http.body.length,
    body_sha256: createHash("sha256").update(http.body).digest("hex"),
    body_preview: http.body.subarray(0, 70).toString("utf8"),
    close_notify: closed,
  };
}
