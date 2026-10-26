// Signed update statements: what the app checks before it installs an update.
//
// Electrobun's updater trusts whatever its feed serves (its `hash` is a build
// ID, not a checksum). Each release therefore also carries, per platform, a
// statement naming the exact update (app, channel, platform, version, build
// ID) and the SHA-256 of its unpacked bundle, signed with a key the app has
// built in. The app installs an update only if a trusted key signed it, it's
// newer than the running version, and the bundle it downloaded hashes to the
// signed value. Shared by the app (src/bun/update.ts) and the release job
// (scripts/sign-update.ts), so both read and write one format.
import {
  b64url,
  decodePublicKey,
  encodePublicKey,
  publicKeyFromSecret,
  sign,
  verify,
} from "@openslate/core";

export const STATEMENT_TYPE = "openslate-desktop-update";

/** What one update is: Electrobun's identity for it plus its bundle's checksum. */
export interface UpdateStatement {
  type: typeof STATEMENT_TYPE;
  /** The app's identifier, e.g. us.openslate.desktop. */
  identifier: string;
  channel: string;
  platform: string;
  arch: string;
  version: string;
  /** Electrobun's build ID, as in its update.json. */
  hash: string;
  /** SHA-256 (hex) of the unpacked update bundle (the .tar inside the .tar.zst). */
  tarSha256: string;
  tarBytes: number;
}

/**
 * The file beside Electrobun's update.json. `statement` is the JSON text that
 * was signed, kept verbatim so nothing has to be re-serialized to check it.
 */
export interface SignedUpdate {
  statement: string;
  signatures: { key: string; signature: string }[];
}

/** The signature file's name for a channel and platform: stable-win-x64-signature.json. */
export function signatureFileName(channel: string, platform: string, arch: string): string {
  return `${channel}-${platform}-${arch}-signature.json`;
}

export function signUpdate(statement: UpdateStatement, secretKeys: Uint8Array[]): SignedUpdate {
  const text = JSON.stringify(statement);
  const bytes = new TextEncoder().encode(text);
  return {
    statement: text,
    signatures: secretKeys.map((secretKey) => ({
      key: encodePublicKey(publicKeyFromSecret(secretKey)),
      signature: b64url.encode(sign(bytes, secretKey)),
    })),
  };
}

/** What the running app expects an update for it to say. */
export interface UpdateExpectation {
  identifier: string;
  channel: string;
  platform: string;
  arch: string;
  /** The running version: an update must be newer. */
  currentVersion: string;
  /** The update Electrobun found (its update.json): the statement must name the same one. */
  version: string;
  hash: string;
}

/**
 * Checks a signature file against the trusted keys and what the app expects,
 * and returns the statement. Throws, saying why, if anything doesn't hold.
 */
export function verifyUpdate(
  document: unknown,
  trustedKeys: readonly string[],
  expected: UpdateExpectation,
): UpdateStatement {
  if (
    !isRecord(document) ||
    typeof document.statement !== "string" ||
    !Array.isArray(document.signatures)
  ) {
    throw new Error("the update's signature file is malformed");
  }
  const bytes = new TextEncoder().encode(document.statement);
  const trusted = new Set(trustedKeys);
  const signed = document.signatures.some((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.key !== "string" || typeof entry.signature !== "string")
      return false;
    if (!trusted.has(entry.key)) return false;
    try {
      return verify(b64url.decode(entry.signature), bytes, decodePublicKey(entry.key));
    } catch {
      return false;
    }
  });
  if (!signed) throw new Error("the update isn't signed by a key this app trusts");

  const statement = parseStatement(document.statement);
  for (const field of ["identifier", "channel", "platform", "arch", "version", "hash"] as const) {
    if (statement[field] !== expected[field]) {
      throw new Error(
        `the signed update's ${field} is ${statement[field]}, not ${expected[field]}`,
      );
    }
  }
  if (compareVersions(statement.version, expected.currentVersion) <= 0) {
    throw new Error(
      `the signed update (${statement.version}) isn't newer than ${expected.currentVersion}`,
    );
  }
  return statement;
}

function parseStatement(text: string): UpdateStatement {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("the signed statement isn't JSON");
  }
  if (!isRecord(value) || value.type !== STATEMENT_TYPE) {
    throw new Error("the signed statement isn't an OpenSlate desktop update");
  }
  for (const field of [
    "identifier",
    "channel",
    "platform",
    "arch",
    "version",
    "hash",
    "tarSha256",
  ]) {
    if (typeof value[field] !== "string") throw new Error(`the signed statement has no ${field}`);
  }
  if (!/^[0-9a-f]{64}$/.test(value.tarSha256 as string)) {
    throw new Error("the signed statement's tarSha256 isn't a SHA-256");
  }
  if (!Number.isSafeInteger(value.tarBytes) || (value.tarBytes as number) <= 0) {
    throw new Error("the signed statement's tarBytes isn't a size");
  }
  return value as unknown as UpdateStatement;
}

/**
 * Orders versions like semver: numeric major.minor.patch, then a release
 * after any of its prereleases (0.2.0-rc.1 < 0.2.0), prerelease parts
 * compared numerically when both are numbers. Throws on anything else.
 */
export function compareVersions(a: string, b: string): number {
  const [aCore, aPre] = splitVersion(a);
  const [bCore, bPre] = splitVersion(b);
  for (let i = 0; i < 3; i++) {
    const d = (aCore[i] as number) - (bCore[i] as number);
    if (d !== 0) return Math.sign(d);
  }
  if (!aPre.length || !bPre.length) return Math.sign(bPre.length - aPre.length);
  for (let i = 0; i < Math.max(aPre.length, bPre.length); i++) {
    const x = aPre[i];
    const y = bPre[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    if (x === y) continue;
    const xNum = /^\d+$/.test(x);
    const yNum = /^\d+$/.test(y);
    if (xNum && yNum) return Math.sign(Number(x) - Number(y));
    if (xNum !== yNum) return xNum ? -1 : 1;
    return x < y ? -1 : 1;
  }
  return 0;
}

function splitVersion(version: string): [number[], string[]] {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) throw new Error(`not a version: ${version}`);
  return [
    [Number(match[1]), Number(match[2]), Number(match[3])],
    match[4] ? match[4].split(".") : [],
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
