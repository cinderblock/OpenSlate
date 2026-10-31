import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Link previews come from index.html's tags alone (see the comment there), and
// a crawler that dislikes one drops the image without saying so.

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)));
const indexHtml = read("../index.html").toString();

function meta(property: string): string {
  const pattern = new RegExp(`<meta\\s+property="${property}"\\s+content="([^"]*)"`);
  const content = indexHtml.match(pattern)?.[1];
  if (content === undefined) throw new Error(`index.html has no ${property}`);
  return content;
}

describe("link preview", () => {
  test("every tag a crawler needs is there", () => {
    for (const property of ["og:type", "og:site_name", "og:title", "og:description"]) {
      expect(meta(property)).not.toBe("");
    }
    expect(indexHtml).toContain('<meta name="twitter:card" content="summary_large_image" />');
  });

  test("links are absolute, since a crawler won't resolve a relative one", () => {
    expect(meta("og:url")).toBe("https://openslate.us/");
    expect(meta("og:image")).toStartWith("https://openslate.us/");
  });

  test("the image is a PNG of the declared size in public/", () => {
    const name = new URL(meta("og:image")).pathname;
    const png = read(`../public${name}`);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(String(png.readUInt32BE(16))).toBe(meta("og:image:width"));
    expect(String(png.readUInt32BE(20))).toBe(meta("og:image:height"));
    // Some apps, WhatsApp among them, drop images much past this.
    expect(png.length).toBeLessThan(300 * 1024);
  });
});
