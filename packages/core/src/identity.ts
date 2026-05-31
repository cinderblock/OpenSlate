import {
  type KeyPair,
  decodePublicKey,
  decodeSecretKey,
  encodePublicKey,
  encodeSecretKey,
  generateKeyPair,
  publicKeyFromSecret,
} from "./crypto";
import type { Issuer } from "./schema";

export interface IdentityMeta {
  name?: string;
  kind?: string;
  uri?: string;
}

export interface Identity extends IdentityMeta {
  keyPair: KeyPair;
  createdAt: string;
}

/** Serializable identity. CONTAINS THE SECRET KEY — store only where the user controls it. */
export interface StoredIdentity extends IdentityMeta {
  v: 1;
  publicKey: string; // ed25519:<base58>
  secretKey: string; // ed25519:<base58> — SECRET
  createdAt: string;
}

export function createIdentity(meta: IdentityMeta = {}): Identity {
  return {
    keyPair: generateKeyPair(),
    createdAt: new Date().toISOString(),
    ...stripUndefined(meta),
  };
}

export function identityToIssuer(identity: Identity): Issuer {
  return {
    key: encodePublicKey(identity.keyPair.publicKey),
    ...stripUndefined({ name: identity.name, kind: identity.kind, uri: identity.uri }),
  };
}

export function serializeIdentity(identity: Identity): StoredIdentity {
  return {
    v: 1,
    publicKey: encodePublicKey(identity.keyPair.publicKey),
    secretKey: encodeSecretKey(identity.keyPair.secretKey),
    createdAt: identity.createdAt,
    ...stripUndefined({ name: identity.name, kind: identity.kind, uri: identity.uri }),
  };
}

export function deserializeIdentity(stored: StoredIdentity): Identity {
  const secretKey = decodeSecretKey(stored.secretKey);
  const publicKey = stored.publicKey
    ? decodePublicKey(stored.publicKey)
    : publicKeyFromSecret(secretKey);
  return {
    keyPair: { publicKey, secretKey },
    createdAt: stored.createdAt ?? new Date().toISOString(),
    ...stripUndefined({ name: stored.name, kind: stored.kind, uri: stored.uri }),
  };
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}
