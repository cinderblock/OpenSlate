/**
 * Downloads a copy of the public endorsements catalog and the voter guides it
 * lists, for a build that works with no network: the desktop app's offline
 * flavor (apps/desktop), or any self-hosted copy of the web app.
 *
 * The output is a folder to serve beside the app, with the catalog's own
 * layout: index.json, bundle.json, every entry's slate and logo, guides.json,
 * and each guide's manifest and files under guides/<host>/<path>. guides.json
 * is rewritten so each guide's `url` points into the folder (relative to
 * guides.json), and snapshot.json records where and when it was taken.
 * Point a build at it with VITE_PUBLIC_ENDORSEMENTS_CATALOG=<folder>/index.json
 * (relative to the page, e.g. `catalog/index.json`).
 *
 * Everything is checked on the way in, as the app would: each slate verifies,
 * each guide manifest verifies against the key guides.json lists, and each
 * guide file matches its manifest's SHA-256. Any failure stops the snapshot.
 *
 *   bun run snapshot                          → apps/web/snapshot/
 *   bun run snapshot --out <dir>              somewhere else (emptied first)
 *   bun run snapshot --catalog <index.json>   another catalog
 */
import { createHash } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkGuideFile, verifyGuide, verifySlate } from "@openslate/core";
import type { GuideEntry, GuideList } from "../src/lib/guides";
import {
  type Catalog,
  type CatalogBundleEntry,
  DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG,
} from "../src/lib/query";

const here = dirname(fileURLToPath(import.meta.url));

function option(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const catalogUrl = option("--catalog") ?? DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG;
const outDir = resolve(option("--out") ?? join(here, "..", "snapshot"));

/** Parallel downloads; GitHub Pages is happy with a handful. */
const CONCURRENCY = 12;

/**
 * A path from the catalog, made safe to write under `outDir`: relative, no
 * `..`, no drive letters or backslashes. Anything else is a broken (or
 * hostile) catalog, and the snapshot stops.
 */
function safeRelative(path: string): string {
  if (
    path === "" ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes(":") ||
    path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error(`refusing unsafe path from the catalog: ${JSON.stringify(path)}`);
  }
  return path;
}

async function download(url: string): Promise<Uint8Array> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return new Uint8Array(await response.arrayBuffer());
      lastError = new Error(`${url}: HTTP ${response.status}`);
      // Only a server error or rate limit is worth another try.
      if (response.status < 500 && response.status !== 429) break;
    } catch (err) {
      lastError = err;
    }
    await Bun.sleep(500 * attempt);
  }
  throw lastError;
}

const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

function save(path: string, bytes: Uint8Array | string): void {
  const file = join(outDir, safeRelative(path));
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, bytes);
}

/** Runs `work` over `items`, `CONCURRENCY` at a time. */
async function pool<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      for (let item = queue.shift(); item !== undefined; item = queue.shift()) await work(item);
    }),
  );
}

function checkSlate(token: string, where: string): void {
  const result = verifySlate(token);
  if (!result.valid) throw new Error(`${where} doesn't verify: ${result.errors.join("; ")}`);
}

async function snapshotCatalog(): Promise<Catalog> {
  const indexBytes = await download(catalogUrl);
  const catalog = JSON.parse(text(indexBytes)) as Catalog;
  save("index.json", indexBytes);

  // Every slate the app might fetch on its own (a single entry's import).
  await pool(catalog.entries, async (entry) => {
    const bytes = await download(new URL(entry.path, catalogUrl).href);
    checkSlate(text(bytes).trim(), entry.path);
    save(entry.path, bytes);
  });

  // The bundle holds the same slates inline, for importing many at once.
  if (catalog.bundle) {
    const bytes = await download(new URL(catalog.bundle.path, catalogUrl).href);
    const bundle = JSON.parse(text(bytes)) as { entries?: CatalogBundleEntry[] };
    for (const entry of bundle.entries ?? []) checkSlate(entry.token, `bundle: ${entry.path}`);
    save(catalog.bundle.path, bytes);
  }

  // Logos: one per organization, shared across its elections.
  const logos = [...new Set(catalog.entries.flatMap((e) => (e.logo ? [e.logo] : [])))];
  await pool(logos, async (logo) => {
    save(logo, await download(new URL(logo, catalogUrl).href));
  });
  console.log(`catalog: ${catalog.entries.length} slates, ${logos.length} logos`);
  return catalog;
}

/** The longest file name a ustar archive holds, and Electrobun packs the app into one. */
const LONGEST_NAME = 100;

/**
 * Where to save a guide file: `path`, unless its name won't fit in the app's archive. A short
 * name then keeps the start of the original and a hash of the rest of it, so two can't collide.
 */
function savedPath(path: string): string {
  const name = basename(path);
  if (name.length <= LONGEST_NAME) return path;
  const extension = extname(name);
  const hash = createHash("sha256").update(path).digest("hex").slice(0, 12);
  const start = name.slice(0, LONGEST_NAME - hash.length - extension.length - 1);
  return `${path.slice(0, -name.length)}${start}-${hash}${extension}`;
}

/** Where a guide's files live in the snapshot: guides/<host>/<path of its folder>. */
function guideFolder(guideUrl: URL): string {
  const folder = guideUrl.pathname.replace(/[^/]*$/, "");
  return `guides/${guideUrl.host}${folder}`;
}

async function snapshotGuides(): Promise<number> {
  const listUrl = new URL("guides.json", catalogUrl).href;
  const response = await fetch(listUrl);
  if (response.status === 404) return 0;
  if (!response.ok) throw new Error(`${listUrl}: HTTP ${response.status}`);
  const list = (await response.json()) as GuideList;

  const guides: GuideEntry[] = [];
  for (const entry of list.guides) {
    const guideUrl = new URL(entry.url, listUrl);
    const folder = guideFolder(guideUrl);
    const name = safeRelative(guideUrl.pathname.split("/").pop() ?? "");

    const token = text(await download(guideUrl.href)).trim();
    const result = verifyGuide(token, { expectedKey: entry.key });
    if (!result.valid || !result.manifest) {
      throw new Error(`${guideUrl.href} doesn't verify: ${result.errors.join("; ")}`);
    }
    const manifest = result.manifest;
    save(`${folder}${name}`, token);

    const files = Object.keys(manifest.files);
    const savedAs: Record<string, string> = {};
    await pool(files, async (path) => {
      const bytes = await download(new URL(safeRelative(path), guideUrl).href);
      if (!(await checkGuideFile(manifest, path, bytes))) {
        throw new Error(`${guideUrl.href}: ${path} doesn't match its manifest`);
      }
      const saved = savedPath(path);
      if (saved !== path) savedAs[path] = saved;
      save(`${folder}${saved}`, bytes);
    });
    console.log(`guide: ${entry.jurisdiction} (${files.length} files)`);
    guides.push({
      ...entry,
      url: `${folder}${name}`,
      ...(Object.keys(savedAs).length > 0 ? { saved_as: savedAs } : {}),
    });
  }

  save("guides.json", `${JSON.stringify({ ...list, guides }, null, 2)}\n`);
  return guides.length;
}

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
console.log(`snapshot of ${catalogUrl} → ${outDir}`);

const catalog = await snapshotCatalog();
const guides = await snapshotGuides();
save(
  "snapshot.json",
  `${JSON.stringify(
    {
      source: catalogUrl,
      retrieved_at: new Date().toISOString(),
      catalog_generated_at: catalog.generated_at,
      entries: catalog.entries.length,
      guides,
    },
    null,
    2,
  )}\n`,
);
console.log("done");
