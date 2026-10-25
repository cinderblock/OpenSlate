/**
 * Renders the desktop app's icons from the web app's icon
 * (apps/web/public/icon.svg) into icons/:
 *
 * - icon.ico: Windows, every size Explorer and the taskbar ask for.
 * - icon.iconset/: macOS (Hutch turns it into an .icns with iconutil). Inset
 *   on its canvas like other macOS app icons.
 * - icon.png: Linux, 512 px.
 *
 * The icon draws its "OS" in the system font, so renders differ from machine
 * to machine: run this once, look at the result, and commit it, rather than
 * rendering in CI. Needs the `resvg` CLI (https://github.com/linebender/resvg,
 * `cargo install resvg`).
 *
 *   bun run icons
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = join(here, "..", "..", "web", "public", "icon.svg");
const out = join(here, "..", "icons");
const work = join(tmpdir(), "openslate-icons");

const svg = readFileSync(source, "utf8");
/** macOS icons sit inside their canvas (824 of 1024 px), the rest left clear. */
const macSvg = svg.replace('viewBox="0 0 512 512"', 'viewBox="-62 -62 636 636"');
if (macSvg === svg) throw new Error(`${source}: expected viewBox="0 0 512 512"`);

mkdirSync(work, { recursive: true });
writeFileSync(join(work, "icon.svg"), svg);
writeFileSync(join(work, "mac.svg"), macSvg);

function render(input: "icon.svg" | "mac.svg", size: number): Uint8Array {
  const file = join(work, `${input}-${size}.png`);
  const result = Bun.spawnSync([
    "resvg",
    "-w",
    `${size}`,
    "-h",
    `${size}`,
    join(work, input),
    file,
  ]);
  if (result.exitCode !== 0) throw new Error(`resvg failed: ${result.stderr.toString()}`);
  return readFileSync(file);
}

/** An .ico holding PNG images (Windows Vista and later read these). */
function ico(images: { size: number; png: Uint8Array }[]): Uint8Array {
  const header = 6;
  const entry = 16;
  let offset = header + entry * images.length;
  const total = offset + images.reduce((sum, i) => sum + i.png.length, 0);
  const bytes = new Uint8Array(total);
  const view = new DataView(bytes.buffer);
  view.setUint16(2, 1, true); // type: icon
  view.setUint16(4, images.length, true);
  images.forEach(({ size, png }, i) => {
    const at = header + entry * i;
    view.setUint8(at, size >= 256 ? 0 : size); // 0 means 256
    view.setUint8(at + 1, size >= 256 ? 0 : size);
    view.setUint16(at + 4, 1, true); // colour planes
    view.setUint16(at + 6, 32, true); // bits per pixel
    view.setUint32(at + 8, png.length, true);
    view.setUint32(at + 12, offset, true);
    bytes.set(png, offset);
    offset += png.length;
  });
  return bytes;
}

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "icon.iconset"), { recursive: true });

writeFileSync(
  join(out, "icon.ico"),
  ico(
    [16, 20, 24, 32, 40, 48, 64, 128, 256].map((size) => ({ size, png: render("icon.svg", size) })),
  ),
);

for (const size of [16, 32, 128, 256, 512]) {
  writeFileSync(join(out, "icon.iconset", `icon_${size}x${size}.png`), render("mac.svg", size));
  writeFileSync(
    join(out, "icon.iconset", `icon_${size}x${size}@2x.png`),
    render("mac.svg", size * 2),
  );
}

writeFileSync(join(out, "icon.png"), render("icon.svg", 512));
console.log(`icons → ${out}`);
