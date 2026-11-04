import { ed25519 } from "@noble/curves/ed25519";
import { base58 } from "@scure/base";

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

/**
 * `verify`, through the runtime's own Ed25519 (WebCrypto) where it has one:
 * about ten times faster than noble's JavaScript, and more with many at
 * once. The outcome is always noble's: WebCrypto's check is RFC 8032's, which
 * accepts a subset of what noble's (ZIP 215) does, so its yes is noble's yes,
 * and anything it doesn't accept goes to noble to decide.
 */
export async function verifyAsync(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  const key = await webCryptoKey(publicKey);
  if (key) {
    try {
      const subtle = globalThis.crypto.subtle;
      if (await subtle.verify({ name: "Ed25519" }, key, buffer(signature), buffer(message)))
        return true;
    } catch {
      // noble decides.
    }
  }
  return verify(signature, message, publicKey);
}

/** RFC 8032's first test key: importing it says whether the runtime has Ed25519. */
const PROBE_KEY = Uint8Array.from(
  "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a".match(/../g) ?? [],
  (hex) => Number.parseInt(hex, 16),
);
let webCryptoEd25519: Promise<boolean> | undefined;
/** Imported keys, by their bytes: a catalog's slates come from a handful of signers. */
const importedKeys = new Map<string, Promise<CryptoKey | undefined>>();

function buffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer instanceof ArrayBuffer &&
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : (bytes.slice().buffer as ArrayBuffer);
}

function importEd25519(publicKey: Uint8Array): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey("raw", buffer(publicKey), { name: "Ed25519" }, false, [
    "verify",
  ]);
}

async function webCryptoKey(publicKey: Uint8Array): Promise<CryptoKey | undefined> {
  if (!globalThis.crypto?.subtle) return undefined;
  webCryptoEd25519 ??= importEd25519(PROBE_KEY).then(
    () => true,
    () => false,
  );
  if (!(await webCryptoEd25519)) return undefined;
  const id = b64url.encode(publicKey);
  let key = importedKeys.get(id);
  if (!key) {
    // A key WebCrypto won't take (not a point, say) goes to noble.
    key = importEd25519(publicKey).catch(() => undefined);
    if (importedKeys.size > 1000) importedKeys.clear();
    importedKeys.set(id, key);
  }
  return key;
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

const B64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
/** Each char code's 6-bit value, or -1 for one outside the alphabet. */
const B64URL_VALUE = (() => {
  const table = new Int8Array(128).fill(-1);
  for (let i = 0; i < B64URL.length; i++) table[B64URL.charCodeAt(i)] = i;
  return table;
})();

/**
 * base64url without padding (per RFC 7515), as strict as `@scure/base`'s
 * `base64urlnopad`: no padding, nothing outside the alphabet, no stray bits
 * in the last character. Table-driven: scure's splits a string into one array
 * entry per character, and decoding the public catalog's tokens with it took
 * seconds on a phone.
 */
export const b64url = {
  encode(bytes: Uint8Array): string {
    let out = "";
    let i = 0;
    for (; i + 2 < bytes.length; i += 3) {
      const n =
        ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8) | (bytes[i + 2] as number);
      out +=
        B64URL.charAt(n >> 18) +
        B64URL.charAt((n >> 12) & 63) +
        B64URL.charAt((n >> 6) & 63) +
        B64URL.charAt(n & 63);
    }
    const rest = bytes.length - i;
    if (rest === 1) {
      const n = (bytes[i] as number) << 16;
      out += B64URL.charAt(n >> 18) + B64URL.charAt((n >> 12) & 63);
    } else if (rest === 2) {
      const n = ((bytes[i] as number) << 16) | ((bytes[i + 1] as number) << 8);
      out += B64URL.charAt(n >> 18) + B64URL.charAt((n >> 12) & 63) + B64URL.charAt((n >> 6) & 63);
    }
    return out;
  },
  decode(text: string): Uint8Array {
    if (typeof text !== "string") throw new Error("base64url: string expected");
    const tail = text.length % 4;
    if (tail === 1) throw new Error("base64url: invalid length");
    const out = new Uint8Array(((text.length - tail) / 4) * 3 + (tail ? tail - 1 : 0));
    const value = (at: number): number => {
      const code = text.charCodeAt(at);
      const v = code < 128 ? (B64URL_VALUE[code] as number) : -1;
      if (v < 0) throw new Error(`base64url: invalid character at ${at}`);
      return v;
    };
    let o = 0;
    let i = 0;
    for (; i + 3 < text.length; i += 4) {
      const n = (value(i) << 18) | (value(i + 1) << 12) | (value(i + 2) << 6) | value(i + 3);
      out[o++] = n >> 16;
      out[o++] = (n >> 8) & 255;
      out[o++] = n & 255;
    }
    if (tail === 2) {
      const n = (value(i) << 18) | (value(i + 1) << 12);
      if (n & 0xffff) throw new Error("base64url: non-zero padding bits");
      out[o++] = n >> 16;
    } else if (tail === 3) {
      const n = (value(i) << 18) | (value(i + 1) << 12) | (value(i + 2) << 6);
      if (n & 0xff) throw new Error("base64url: non-zero padding bits");
      out[o++] = n >> 16;
      out[o++] = (n >> 8) & 255;
    }
    return out;
  },
};
