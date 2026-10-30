// The capture step: one GET, recorded verbatim, with no judgement about what came back. It speaks
// HTTP/1.1 over a plain TLS socket instead of using fetch(), so the bytes on disk are the bytes the
// socket delivered: no decompression, no de-chunking, no redirect following behind our back.
// Failures are results too: a DNS error or a 403 is recorded the same way as a 200.

import { createHash } from "node:crypto";
import { type TLSSocket, connect as tlsConnect } from "node:tls";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

export interface TlsDetails {
  protocol: string | null;
  cipher: string | null;
  alpn: string | false | null;
  /** The server's chain as sent, leaf first, base64 DER. */
  chain_der: string[];
}

/** One request/response pair. A redirect is a chain of these. */
export interface Exchange {
  url: string;
  started_at: string;
  ended_at: string;
  remote_ip: string | null;
  /** Exact bytes written to the TLS socket. */
  request: Buffer;
  /** Exact bytes read from the TLS socket, framing and content-encoding included. */
  response: Buffer;
  /** We stopped reading at the size limit, so `response` is a prefix. */
  truncated: boolean;
  tls: TlsDetails | null;
  /** Why the exchange failed: DNS, TCP, TLS or timeout. */
  error: string | null;
}

export interface CaptureOptions {
  userAgent: string;
  accept?: string;
  maxBytes?: number;
  maxRedirects?: number;
  timeoutMs?: number;
}

function peerChain(socket: TLSSocket): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  let certificate = socket.getPeerCertificate(true);
  while (certificate?.raw && !seen.has(certificate.fingerprint256)) {
    seen.add(certificate.fingerprint256);
    chain.push(Buffer.from(certificate.raw).toString("base64"));
    certificate = certificate.issuerCertificate;
  }
  return chain;
}

function requestBytes(url: URL, options: CaptureOptions): Buffer {
  return Buffer.from(
    `GET ${url.pathname}${url.search} HTTP/1.1\r\n` +
      `Host: ${url.host}\r\n` +
      `User-Agent: ${options.userAgent}\r\n` +
      `Accept: ${options.accept ?? "*/*"}\r\n` +
      "Accept-Encoding: gzip\r\n" +
      "Connection: close\r\n\r\n",
  );
}

export function exchange(target: string, options: CaptureOptions): Promise<Exchange> {
  const url = new URL(target);
  const maxBytes = options.maxBytes ?? 200_000_000;
  const request = requestBytes(url, options);
  const started_at = new Date().toISOString();
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let received = 0;
    let truncated = false;
    let tls: TlsDetails | null = null;
    let remote_ip: string | null = null;
    let settled = false;
    const settle = (error: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({
        url: target,
        started_at,
        ended_at: new Date().toISOString(),
        remote_ip,
        request,
        response: Buffer.concat(chunks),
        truncated,
        tls,
        error,
      });
    };
    const socket = tlsConnect({
      host: url.hostname,
      port: Number(url.port) || 443,
      servername: url.hostname,
      ALPNProtocols: ["http/1.1"],
    });
    const timer = setTimeout(() => settle("timeout"), options.timeoutMs ?? 30_000);
    socket.on("secureConnect", () => {
      remote_ip = socket.remoteAddress ?? null;
      tls = {
        protocol: socket.getProtocol() ?? null,
        cipher: socket.getCipher()?.standardName ?? null,
        alpn: socket.alpnProtocol ?? null,
        chain_der: peerChain(socket),
      };
      socket.write(request);
    });
    socket.on("data", (chunk: Buffer) => {
      received += chunk.length;
      chunks.push(chunk);
      if (received >= maxBytes) {
        truncated = true;
        settle(null);
      }
    });
    socket.on("end", () => settle(null));
    socket.on("close", () => settle(null));
    socket.on("error", (error: Error) => settle(`${error.name}: ${error.message}`));
  });
}

export interface Parsed {
  status: number | null;
  headers: [string, string][];
  /** The body after de-chunking, still content-encoded. */
  wire_body: Buffer;
}

export const header = (parsed: Parsed, name: string) =>
  parsed.headers.find(([key]) => key === name)?.[1];

/** Pure: the same bytes always parse the same way. */
export function parseResponse(raw: Buffer): Parsed {
  const split = raw.indexOf("\r\n\r\n");
  if (split < 0) return { status: null, headers: [], wire_body: Buffer.alloc(0) };
  const lines = raw.subarray(0, split).toString("latin1").split("\r\n");
  const status = Number((lines[0] ?? "").split(" ")[1]) || null;
  const headers = lines.slice(1).map((line): [string, string] => {
    const at = line.indexOf(":");
    return [line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim()];
  });
  const rest = raw.subarray(split + 4);
  const parsed: Parsed = { status, headers, wire_body: rest };
  if (!header(parsed, "transfer-encoding")?.toLowerCase().includes("chunked")) return parsed;
  const body: Buffer[] = [];
  let at = 0;
  while (at < rest.length) {
    const end = rest.indexOf("\r\n", at);
    if (end < 0) break;
    const size = Number.parseInt(rest.subarray(at, end).toString("latin1"), 16);
    if (!size) break;
    body.push(rest.subarray(end + 2, end + 2 + size));
    at = end + 2 + size + 2;
  }
  return { ...parsed, wire_body: Buffer.concat(body) };
}

/** Pure: undo content-encoding. Throws on a truncated stream. */
export function decodeBody(parsed: Parsed): Buffer {
  const encoding = header(parsed, "content-encoding")?.toLowerCase() ?? "identity";
  if (encoding === "gzip" || encoding === "x-gzip") return gunzipSync(parsed.wire_body);
  if (encoding === "br") return brotliDecompressSync(parsed.wire_body);
  if (encoding === "deflate") return inflateSync(parsed.wire_body);
  return parsed.wire_body;
}

/** Follow redirects by hand, recording every hop. */
export async function capture(target: string, options: CaptureOptions): Promise<Exchange[]> {
  const hops: Exchange[] = [];
  let url = target;
  for (let i = 0; i <= (options.maxRedirects ?? 5); i++) {
    const hop = await exchange(url, options);
    hops.push(hop);
    const parsed = parseResponse(hop.response);
    const location = header(parsed, "location");
    if (!parsed.status || parsed.status < 300 || parsed.status >= 400 || !location) break;
    const next = new URL(location, url);
    if (next.protocol !== "https:") break;
    url = next.toString();
  }
  return hops;
}

export const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
