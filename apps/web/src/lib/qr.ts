import jsQR from "jsqr";
import QRCode from "qrcode";

/** Generate a QR code as an SVG string. */
export async function toQrSvg(text: string, size = 280): Promise<string> {
  return QRCode.toString(text, {
    type: "svg",
    width: size,
    margin: 1,
    errorCorrectionLevel: "M",
  });
}

/** Decode the first QR code found in an image file. Returns null if none found. */
export async function scanImageFile(file: File): Promise<string | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // Downscale large photos so jsqr decode stays quick.
    const maxDim = 1024;
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(data.data, data.width, data.height);
    return code?.data ?? null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(err instanceof Error ? err : new Error("image load failed"));
    img.src = src;
  });
}

export interface ScannedSlate {
  kind: "slate";
  token: string;
}
export interface ScannedContact {
  kind: "contact";
  publicKey: string;
  name?: string;
}
export interface ScannedUnknown {
  kind: "unknown";
  raw: string;
}
export type Scanned = ScannedSlate | ScannedContact | ScannedUnknown;

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Heuristically classify the scanned text. */
export function parseScanned(raw: string): Scanned {
  const text = raw.trim();
  if (text.startsWith("ed25519:")) {
    const [keyPart, queryPart] = text.split("?");
    const key = (keyPart ?? text).trim();
    let name: string | undefined;
    if (queryPart) {
      try {
        const params = new URLSearchParams(queryPart);
        const n = params.get("name");
        if (n) name = n;
      } catch {
        // ignore malformed query
      }
    }
    return name ? { kind: "contact", publicKey: key, name } : { kind: "contact", publicKey: key };
  }
  const parts = text.split(".");
  if (parts.length === 3 && parts.every((p) => p.length > 0 && BASE64URL.test(p))) {
    return { kind: "slate", token: text };
  }
  return { kind: "unknown", raw: text };
}

/** Format a public-identity payload for QR encoding (public-only — never includes secrets). */
export function contactToQrText(publicKey: string, name?: string): string {
  if (!name) return publicKey;
  return `${publicKey}?name=${encodeURIComponent(name)}`;
}
