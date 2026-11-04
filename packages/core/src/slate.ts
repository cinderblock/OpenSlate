import { decodePublicKey, encodePublicKey, type KeyPair } from "./crypto";
import {
  type DecodedSlate,
  decodeToken,
  encodeToken,
  verifySignature,
  verifySignatureAsync,
} from "./envelope";
import {
  type Adoption,
  type Article,
  type Attribution,
  type Issuer,
  type JwsHeader,
  type LabelDefinition,
  type Position,
  type Reference,
  type SlatePayload,
  slatePayloadSchema,
} from "./schema";

export interface BuildSlateInput {
  issuer: Issuer;
  positions?: Position[];
  endorsedBy?: Reference[];
  attribution?: Attribution;
  adopts?: Adoption[];
  articles?: Article[];
  labels?: LabelDefinition[];
  context?: SlatePayload["context"];
  issuedAt?: Date | string;
  expiresAt?: Date | string;
  nonce?: string;
}

function toIso(value: Date | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === "string" ? value : value.toISOString();
}

/** Build and validate a SlatePayload from ergonomic input. */
export function buildSlate(input: BuildSlateInput): SlatePayload {
  return slatePayloadSchema.parse({
    v: 1,
    issuer: input.issuer,
    issued_at: toIso(input.issuedAt) ?? new Date().toISOString(),
    expires_at: toIso(input.expiresAt),
    context: input.context,
    positions: input.positions ?? [],
    endorsed_by: input.endorsedBy,
    attribution: input.attribution,
    adopts: input.adopts,
    articles: input.articles,
    labels: input.labels,
    nonce: input.nonce,
  });
}

/** Sign a payload into a shareable token. The secret key must match `issuer.key`. */
export function signSlate(payload: SlatePayload, secretKey: Uint8Array): string {
  const parsed = slatePayloadSchema.parse(payload);
  const header: JwsHeader = { alg: "EdDSA", typ: "openslate+jws", kid: parsed.issuer.key };
  return encodeToken(parsed, header, secretKey);
}

/** Build + sign in one step from a key pair (derives and fills `issuer.key`). */
export function createSlate(
  input: Omit<BuildSlateInput, "issuer"> & { issuer: Omit<Issuer, "key">; keyPair: KeyPair },
): { token: string; payload: SlatePayload } {
  const key = encodePublicKey(input.keyPair.publicKey);
  const payload = buildSlate({ ...input, issuer: { ...input.issuer, key } });
  return { token: signSlate(payload, input.keyPair.secretKey), payload };
}

export interface VerifyResult {
  valid: boolean;
  payload?: SlatePayload;
  issuerKey?: string;
  errors: string[];
  warnings: string[];
}

export interface VerifyOptions {
  /** Reference time for expiry checks. Defaults to now. */
  now?: Date;
}

/** Parse, schema-validate, and cryptographically verify a token. */
export function verifySlate(token: string, options: VerifyOptions = {}): VerifyResult {
  const checked = checkSlate(token);
  if ("result" in checked) return checked.result;
  return finishSlate(checked, verifySignature(checked.decoded, checked.publicKey), options);
}

/**
 * `verifySlate`, with the signature checked by the runtime's own Ed25519
 * where it has one (`verifyAsync`): the same result, many times faster in a
 * browser checking a whole catalog.
 */
export async function verifySlateAsync(
  token: string,
  options: VerifyOptions = {},
): Promise<VerifyResult> {
  const checked = checkSlate(token);
  if ("result" in checked) return checked.result;
  return finishSlate(
    checked,
    await verifySignatureAsync(checked.decoded, checked.publicKey),
    options,
  );
}

interface CheckedSlate {
  decoded: DecodedSlate;
  payload: SlatePayload;
  publicKey: Uint8Array;
  errors: string[];
  warnings: string[];
}

/** Everything `verifySlate` checks but the signature, or the result when it can't get that far. */
function checkSlate(token: string): CheckedSlate | { result: VerifyResult } {
  const errors: string[] = [];
  const warnings: string[] = [];

  let decoded: DecodedSlate;
  try {
    decoded = decodeToken(token);
  } catch (err) {
    return { result: { valid: false, errors: [errorMessage(err)], warnings } };
  }

  if (decoded.header.alg !== "EdDSA") errors.push(`unsupported alg: ${String(decoded.header.alg)}`);
  if (decoded.header.typ !== "openslate+jws") {
    warnings.push(`unexpected typ: ${String(decoded.header.typ)}`);
  }

  const result = slatePayloadSchema.safeParse(decoded.payload);
  if (!result.success) {
    for (const issue of result.error.issues) {
      errors.push(`payload ${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    return { result: { valid: false, errors, warnings } };
  }
  const payload = result.data;

  if (decoded.header.kid !== payload.issuer.key) {
    errors.push("header kid does not match issuer.key");
  }

  let publicKey: Uint8Array;
  try {
    publicKey = decodePublicKey(payload.issuer.key);
  } catch (err) {
    errors.push(`invalid issuer key: ${errorMessage(err)}`);
    return {
      result: { valid: false, payload, issuerKey: payload.issuer.key, errors, warnings },
    };
  }
  return { decoded, payload, publicKey, errors, warnings };
}

function finishSlate(
  { payload, errors, warnings }: CheckedSlate,
  signed: boolean,
  options: VerifyOptions,
): VerifyResult {
  if (!signed) errors.push("signature verification failed");

  const now = options.now ?? new Date();
  if (payload.expires_at && new Date(payload.expires_at).getTime() < now.getTime()) {
    warnings.push("slate has expired");
  }

  return { valid: errors.length === 0, payload, issuerKey: payload.issuer.key, errors, warnings };
}

/** Parse + schema-validate a token without cryptographic verification (e.g. for display). */
export function parseSlate(token: string): { header: JwsHeader; payload: SlatePayload } {
  const decoded = decodeToken(token);
  return { header: decoded.header, payload: slatePayloadSchema.parse(decoded.payload) };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
