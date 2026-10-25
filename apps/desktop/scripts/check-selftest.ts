/**
 * Checks two self-test reports (src/bun/selftest.ts) from consecutive runs of
 * the same build, and fails loudly on anything wrong. CI runs the app twice
 * on every platform and then this.
 *
 *   bun scripts/check-selftest.ts <first.json> <second.json> [--offline]
 */
import { readFileSync } from "node:fs";

const [firstFile, secondFile] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const offline = process.argv.includes("--offline");
if (!firstFile || !secondFile) {
  console.error("usage: check-selftest.ts <first.json> <second.json> [--offline]");
  process.exit(2);
}

interface Stored {
  previous: string | null;
  wrote: boolean;
}

interface Report {
  error?: string;
  /** What this run stored, for the next one to find. */
  marker?: string;
  href?: string;
  rendered?: boolean;
  localStorage?: Stored;
  indexedDB?: Stored;
  sha256?: string;
  randomValues?: boolean;
  geo?: number;
  catalog?: { status?: number; entries?: number; error?: string };
  stayed?: string;
  outsideLinks?: string[];
}

const read = (file: string) => JSON.parse(readFileSync(file, "utf8")) as Report;
const first = read(firstFile);
const second = read(secondFile);

const failures: string[] = [];
function expect(ok: boolean, what: string): void {
  if (!ok) failures.push(what);
}

const SHA256_ABC = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
const LINKS = [
  "https://example.org/selftest-link",
  "https://example.org/selftest-open",
  "https://example.org/selftest-navigate",
];

for (const [name, report] of [
  ["first run", first],
  ["second run", second],
] as const) {
  expect(!report.error, `${name}: ${report.error}`);
  expect(report.href === "views://mainview/index.html", `${name}: loaded ${report.href}`);
  expect(report.rendered === true, `${name}: the app didn't render`);
  expect(report.localStorage?.wrote === true, `${name}: localStorage didn't take a write`);
  expect(report.indexedDB?.wrote === true, `${name}: IndexedDB didn't take a write`);
  expect(report.sha256 === SHA256_ABC, `${name}: SHA-256 gave ${JSON.stringify(report.sha256)}`);
  expect(report.randomValues === true, `${name}: crypto.getRandomValues failed`);
  expect(report.geo === 200, `${name}: bundled district boundaries: ${JSON.stringify(report.geo)}`);
  if (offline) {
    expect(
      report.catalog?.status === 200 && (report.catalog.entries ?? 0) > 0,
      `${name}: built-in catalog: ${JSON.stringify(report.catalog)}`,
    );
  }
  expect(
    report.stayed === "views://mainview/index.html",
    `${name}: the window left the app for ${report.stayed}`,
  );
  expect(
    JSON.stringify(report.outsideLinks) === JSON.stringify(LINKS),
    `${name}: links to other sites: ${JSON.stringify(report.outsideLinks)}`,
  );
}

// What the first run stored, the second found.
expect(
  first.marker !== undefined && second.localStorage?.previous === first.marker,
  `localStorage didn't survive a restart: ${JSON.stringify(second.localStorage)}`,
);
expect(
  first.marker !== undefined && second.indexedDB?.previous === first.marker,
  `IndexedDB didn't survive a restart: ${JSON.stringify(second.indexedDB)}`,
);

if (failures.length > 0) {
  console.error(`self-test failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
console.log("self-test passed");
