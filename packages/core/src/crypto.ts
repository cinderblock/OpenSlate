import { ed25519 } from "@noble/curves/ed25519";
import { base58, base64urlnopad } from "@scure/base";

/** Algorithm prefix for encoded keys. */
export const KEY_PREFIX = "ed25519:";

export interface KeyPair {
  /** 32-byte Ed25519 public key. */
  publicKey: Uint8Array;
  /** 32-byte Ed25519 seed (the secret key). Treat as highly sensitive. */
  secretKey: Uint8Array;
}

export function generateKeyPair(): KeyPair {
  const secretKey = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(secretKey);
  return { publicKey, secretKey };
}

export function publicKeyFromSecret(secretKey: Uint8Array): Uint8Array {
  return ed25519.getPublicKey(secretKey);
}

export function sign(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ed25519.sign(message, secretKey);
}

export function verify(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

export function encodePublicKey(publicKey: Uint8Array): string {
  return KEY_PREFIX + base58.encode(publicKey);
}

export function decodePublicKey(encoded: string): Uint8Array {
  const raw = decodeKeyBytes(encoded);
  if (raw.length !== 32) throw new Error(`invalid Ed25519 public key length: ${raw.length}`);
  return raw;
}

export function encodeSecretKey(secretKey: Uint8Array): string {
  return KEY_PREFIX + base58.encode(secretKey);
}

export function decodeSecretKey(encoded: string): Uint8Array {
  const raw = decodeKeyBytes(encoded);
  if (raw.length !== 32) throw new Error(`invalid Ed25519 secret key length: ${raw.length}`);
  return raw;
}

function decodeKeyBytes(encoded: string): Uint8Array {
  if (!encoded.startsWith(KEY_PREFIX)) {
    throw new Error(`unsupported key format (expected "${KEY_PREFIX}…"): ${encoded}`);
  }
  return base58.decode(encoded.slice(KEY_PREFIX.length));
}

/** base64url without padding (per RFC 7515). */
export const b64url = {
  encode: (bytes: Uint8Array): string => base64urlnopad.encode(bytes),
  decode: (text: string): Uint8Array => base64urlnopad.decode(text),
};
