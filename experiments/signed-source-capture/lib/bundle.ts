// A capture bundle on disk: one manifest, the raw bytes it names, and proofs over the manifest.
//
//   <dir>/manifest.json        what was asked for and what came back, by hash
//   <dir>/raw/<sha256>         the verbatim request, response and certificate bytes
//   <dir>/stamps/<name>.tsr    RFC 3161 timestamps over manifest.json
//
// Hashing the manifest's file bytes needs no canonical JSON: a verifier hashes the file it holds.

import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Exchange, parseResponse, sha256 } from "./capture";

export const LOCAL_ZONE = "America/Los_Angeles";

/** "2026-10-30 3:11 AM PDT (10:11Z)": local first, UTC beside it. */
export function localFirst(iso: string): string {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCAL_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const zulu = date.toISOString().slice(11, 16);
  return (
    `${part("year")}-${part("month")}-${part("day")} ` +
    `${part("hour")}:${part("minute")} ${part("dayPeriod")} ${part("timeZoneName")} (${zulu}Z)`
  );
}

export interface ManifestExchange {
  url: string;
  started_at: string;
  ended_at: string;
  remote_ip: string | null;
  status: number | null;
  error: string | null;
  truncated: boolean;
  request_sha256: string;
  response_sha256: string;
  response_bytes: number;
  tls: {
    protocol: string | null;
    cipher: string | null;
    alpn: string | false | null;
    /** Leaf first. */
    chain_sha256: string[];
  } | null;
}

export interface Manifest {
  format: "openslate-source-capture/spike-1";
  /** The URLs we set out to fetch, in order, before any of them was fetched. */
  intended: string[];
  /** What the capture tool was, for whoever wants to re-run it. */
  capturer: { tool: string; user_agent: string; runtime: string; platform: string };
  /** One chain of hops per intended URL. */
  captures: { intended: string; hops: ManifestExchange[] }[];
}

/** Write bytes under their own hash; the name is the integrity check. */
export function putRaw(dir: string, bytes: Buffer): string {
  const hash = sha256(bytes);
  mkdirSync(join(dir, "raw"), { recursive: true });
  Bun.write(join(dir, "raw", hash), bytes);
  return hash;
}

export function recordHop(dir: string, hop: Exchange): ManifestExchange {
  return {
    url: hop.url,
    started_at: hop.started_at,
    ended_at: hop.ended_at,
    remote_ip: hop.remote_ip,
    status: parseResponse(hop.response).status,
    error: hop.error,
    truncated: hop.truncated,
    request_sha256: putRaw(dir, hop.request),
    response_sha256: putRaw(dir, hop.response),
    response_bytes: hop.response.length,
    tls: hop.tls && {
      protocol: hop.tls.protocol,
      cipher: hop.tls.cipher,
      alpn: hop.tls.alpn,
      chain_sha256: hop.tls.chain_der.map((der) => putRaw(dir, Buffer.from(der, "base64"))),
    },
  };
}

/** Read named bytes, refusing anything that doesn't hash to its name. */
export function getRaw(dir: string, hash: string): Buffer {
  const bytes = readFileSync(join(dir, "raw", hash));
  if (sha256(bytes) !== hash) throw new Error(`raw/${hash} does not match its name`);
  return bytes;
}
