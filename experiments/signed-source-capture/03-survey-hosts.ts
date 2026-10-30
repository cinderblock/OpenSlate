#!/usr/bin/env bun
// What do the sources the catalog cites actually look like on the wire? One GET to the most-cited
// URL on each host, then a second a while later to see whether the bytes are stable. Bodies are
// hashed and measured, never kept. Writes results/host-survey.json.
//
//   bun experiments/signed-source-capture/03-survey-hosts.ts <endorsements checkout>
//
// The client identifies itself honestly and does not retry, so a 403 here is a real finding.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { connect as tlsConnect } from "node:tls";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { capture, decodeBody, header, parseResponse, sha256 } from "./lib/capture";

const USER_AGENT = "openslate-source-capture-exploration (+https://openslate.us)";
const MAX_BYTES = 12_000_000;
const CONCURRENCY = 6;
const here = import.meta.dir;

const checkout = process.argv[2];
if (!checkout) throw new Error("usage: 03-survey-hosts.ts <endorsements checkout>");

interface Target {
  host: string;
  url: string;
  positions: number;
  needles: Set<string>;
}

const byUrl = new Map<string, { positions: number; needles: Set<string> }>();
const orgs = join(checkout, "orgs");
for (const slug of readdirSync(orgs)) {
  if (!statSync(join(orgs, slug)).isDirectory()) continue;
  for (const election of readdirSync(join(orgs, slug))) {
    const file = join(orgs, slug, election, "positions.json");
    if (!existsSync(file)) continue;
    const doc = JSON.parse(readFileSync(file, "utf8"));
    if (!doc.attribution) continue;
    for (const position of doc.positions ?? []) {
      if (!position.source) continue;
      const entry = byUrl.get(position.source) ?? { positions: 0, needles: new Set<string>() };
      entry.positions++;
      if (typeof position.choice === "string" && position.choice.length > 5) {
        entry.needles.add(position.choice);
      }
      byUrl.set(position.source, entry);
    }
  }
}

const best = new Map<string, Target>();
for (const [url, entry] of byUrl) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    continue;
  }
  const current = best.get(parsed.hostname);
  if (!current || entry.positions > current.positions) {
    best.set(parsed.hostname, { host: parsed.hostname, url, ...entry });
  }
}

/** A surname, with the punctuation an HTML page might encode stripped away. */
const needleWord = (choice: string) =>
  choice
    .split(/\s+/)
    .filter((word) => /^[A-Za-z]{4,}$/.test(word))
    .at(-1)
    ?.toLowerCase();

function supportsTls12(host: string): Promise<boolean | null> {
  return new Promise((resolve) => {
    const socket = tlsConnect({
      host,
      port: 443,
      servername: host,
      minVersion: "TLSv1.2",
      maxVersion: "TLSv1.2",
    });
    const done = (value: boolean | null) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => done(null), 15_000);
    socket.on("secureConnect", () => done(socket.getProtocol() === "TLSv1.2"));
    socket.on("error", () => done(false));
  });
}

async function visit(target: Target) {
  if (!target.url.startsWith("https:")) return { host: target.host, url: target.url, plain_http: true };
  const hops = await capture(target.url, {
    userAgent: USER_AGENT,
    accept: "text/html,application/xhtml+xml,application/signed-exchange;v=b3;q=0.7,*/*;q=0.8",
    maxBytes: MAX_BYTES,
    timeoutMs: 45_000,
  });
  const last = hops.at(-1);
  if (!last) throw new Error("capture returned no hops");
  const parsed = parseResponse(last.response);
  let decoded: Buffer | null = null;
  if (!last.truncated && parsed.status === 200) {
    try {
      decoded = decodeBody(parsed);
    } catch {
      decoded = null;
    }
  }
  const type = header(parsed, "content-type") ?? "";
  const textual = /html|json|text|xml/i.test(type);
  const words = [...target.needles].map(needleWord).filter((word) => word !== undefined);
  const haystack = decoded && textual ? decoded.toString("utf8").toLowerCase() : "";
  const hits = haystack ? words.filter((word) => haystack.includes(word)).length : 0;
  const leaf = last.tls?.chain_der[0];
  return {
    host: target.host,
    url: target.url,
    positions: target.positions,
    final_url: last.url,
    redirects: hops.length - 1,
    error: last.error,
    status: parsed.status,
    protocol: last.tls?.protocol ?? null,
    cipher: last.tls?.cipher ?? null,
    alpn: last.tls?.alpn ?? null,
    chain_bytes: (last.tls?.chain_der ?? []).reduce((sum, der) => sum + (der.length * 3) / 4, 0),
    leaf_present: Boolean(leaf),
    content_type: type,
    content_encoding: header(parsed, "content-encoding") ?? null,
    transfer_encoding: header(parsed, "transfer-encoding") ?? null,
    header_bytes: last.response.indexOf("\r\n\r\n"),
    response_bytes: last.response.length,
    truncated: last.truncated,
    decoded_bytes: decoded?.length ?? null,
    gzip_bytes: decoded ? gzipSync(decoded, { level: 9 }).length : null,
    body_sha256: decoded ? sha256(decoded) : null,
    needles: words.length,
    needle_hits: hits,
    origin_proof_headers: Object.fromEntries(
      parsed.headers.filter(([name]) =>
        /^(signature|signature-input|content-digest|repr-digest|digest|want-content-digest|sourcemap)$/.test(
          name,
        ),
      ),
    ),
    server: header(parsed, "server") ?? null,
    etag: header(parsed, "etag") ?? null,
    last_modified: header(parsed, "last-modified") ?? null,
    behind: ["cf-ray", "x-amz-cf-id", "x-vercel-id", "x-served-by", "x-azure-ref", "x-github-request-id"].filter(
      (name) => header(parsed, name),
    ),
  };
}

async function pool<T, R>(items: T[], worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < items.length) {
        const item = items[next++] as T;
        out.push(await worker(item));
      }
    }),
  );
  return out;
}

const targets = [...best.values()].sort((a, b) => b.positions - a.positions);
console.log(`${targets.length} hosts from ${byUrl.size} cited URLs`);

const started = new Date().toISOString();
const first = await pool(targets, async (target) => {
  const result = await visit(target);
  const tls12 = "plain_http" in result ? null : await supportsTls12(target.host);
  return { ...result, tls12 };
});
console.log(`first pass done, ${first.length} hosts`);

// The second pass only asks: are the bytes the same a few minutes later?
await Bun.sleep(120_000);
const resurvey = first.filter((r) => "body_sha256" in r && r.body_sha256 && (r.decoded_bytes ?? 0) < 3_000_000);
const second = new Map(
  (await pool(resurvey, async (r) => {
    const again = await visit(best.get(r.host) as Target);
    return [r.host, "body_sha256" in again ? again.body_sha256 : null] as const;
  })),
);

const results = first
  .map((r) => ({ ...r, stable: second.has(r.host) ? second.get(r.host) === (r as { body_sha256?: string }).body_sha256 : null }))
  .sort((a, b) => a.host.localeCompare(b.host));

mkdirSync(join(here, "results"), { recursive: true });
await Bun.write(
  join(here, "results", "host-survey.json"),
  `${JSON.stringify({ started, user_agent: USER_AGENT, cited_urls: byUrl.size, results }, null, 1)}\n`,
);
console.log(`second pass done, ${second.size} hosts compared`);
