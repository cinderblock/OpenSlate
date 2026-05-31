import { canonicalize, fromUtf8, utf8 } from "./canonical";
import { b64url, sign as edSign, verify as edVerify } from "./crypto";
import type { JwsHeader } from "./schema";

export interface DecodedSlate<T = unknown> {
  header: JwsHeader;
  payload: T;
  signature: Uint8Array;
  /** ASCII bytes that were signed: `BASE64URL(header).BASE64URL(payload)`. */
  signingInput: Uint8Array;
}

/** Canonicalize, encode, and sign into a JWS-compact OpenSlate token. */
export function encodeToken(payload: unknown, header: JwsHeader, secretKey: Uint8Array): string {
  const headerSeg = b64url.encode(utf8(canonicalize(header)));
  const payloadSeg = b64url.encode(utf8(canonicalize(payload)));
  const signingInput = `${headerSeg}.${payloadSeg}`;
  const signature = edSign(utf8(signingInput), secretKey);
  return `${signingInput}.${b64url.encode(signature)}`;
}

/** Split + decode a token's segments. Does NOT validate the schema or signature. */
export function decodeToken<T = unknown>(token: string): DecodedSlate<T> {
  const segments = token.trim().split(".");
  if (segments.length !== 3) {
    throw new Error(`invalid OpenSlate token: expected 3 segments, got ${segments.length}`);
  }
  const [headerSeg, payloadSeg, signatureSeg] = segments as [string, string, string];

  let header: JwsHeader;
  try {
    header = JSON.parse(fromUtf8(b64url.decode(headerSeg))) as JwsHeader;
  } catch (cause) {
    throw new Error("invalid OpenSlate token: header is not valid base64url JSON", { cause });
  }

  let payload: T;
  try {
    payload = JSON.parse(fromUtf8(b64url.decode(payloadSeg))) as T;
  } catch (cause) {
    throw new Error("invalid OpenSlate token: payload is not valid base64url JSON", { cause });
  }

  return {
    header,
    payload,
    signature: b64url.decode(signatureSeg),
    signingInput: utf8(`${headerSeg}.${payloadSeg}`),
  };
}

export function verifySignature(decoded: DecodedSlate, publicKey: Uint8Array): boolean {
  return edVerify(decoded.signature, decoded.signingInput, publicKey);
}
