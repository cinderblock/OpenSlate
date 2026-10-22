/**
 * Screenshots for private feedback (plans/feedback.md). Only ever taken when
 * the user asks for one, and only sent after they've seen it.
 *
 * Rendered from the DOM (modern-screenshot), not with the screen-capture API:
 * no permission prompt, no picker, and it works on phones, where
 * `getDisplayMedia` doesn't exist. The renderer is loaded on first use.
 */

import { MAX_SCREENSHOT_BYTES } from "./feedback";

/**
 * What's in the window right now, as a PNG, leaving out `exclude` (the
 * feedback dialog itself). Returns null if rendering fails.
 */
export async function captureViewport(exclude?: Element | null): Promise<Blob | null> {
  try {
    const { domToBlob } = await import("modern-screenshot");
    const root = document.documentElement;
    const blob = await domToBlob(root, {
      // Just the visible part of the page: a long page rendered whole would be
      // huge and mostly not what the user meant.
      width: root.clientWidth,
      height: window.innerHeight,
      style: { transform: `translate(${-window.scrollX}px, ${-window.scrollY}px)` },
      scale: Math.min(window.devicePixelRatio || 1, 2),
      backgroundColor: getComputedStyle(document.body).backgroundColor || null,
      filter: (node) => node !== exclude,
      type: "image/png",
    });
    return blob ? await fitImage(blob) : null;
  } catch (error) {
    if (import.meta.env?.DEV) console.warn("[feedback] screenshot failed", error);
    return null;
  }
}

/**
 * The image as is if it's small enough to send; otherwise re-encoded as JPEG,
 * and scaled down if need be, until it is. Null if it can't be decoded.
 */
export async function fitImage(blob: Blob, maxBytes = MAX_SCREENSHOT_BYTES): Promise<Blob | null> {
  if (blob.size <= maxBytes && (blob.type === "image/png" || blob.type === "image/jpeg")) {
    return blob;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return null;
  }
  try {
    let scale = 1;
    for (let attempt = 0; attempt < 6; attempt++) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) return null;
      // JPEG has no transparency; fill white so clear areas don't turn black.
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const out = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.85),
      );
      if (out && out.size <= maxBytes) return out;
      scale *= 0.75;
    }
    return null;
  } finally {
    bitmap.close();
  }
}
