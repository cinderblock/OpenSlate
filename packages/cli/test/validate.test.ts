import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdentity, serializeIdentity } from "@openslate/core";

const cli = join(import.meta.dir, "..", "src", "index.ts");
const dir = mkdtempSync(join(tmpdir(), "openslate-validate-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const E = "2026-11-03";
const position = {
  subject: { title: "Governor", election: E },
  stance: "endorse",
  choice: "Alice",
};
// A scraper bundle's positions.json, the shape the endorsement-scraper skill validates.
const bundle = {
  context: { election: E, jurisdiction: "us/ca" },
  positions: [position],
  attribution: {
    of: { name: "State Party" },
    mode: "scraped",
    retrieved_at: "2026-10-19T00:00:00Z",
  },
};

const keyPath = join(dir, "key.json");
await Bun.write(keyPath, JSON.stringify(serializeIdentity(createIdentity({ kind: "researcher" }))));

async function write(name: string, value: unknown): Promise<string> {
  const path = join(dir, name);
  await Bun.write(path, JSON.stringify(value));
  return path;
}

async function run(...args: string[]) {
  const proc = Bun.spawn(["bun", cli, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe("openslate validate", () => {
  test("accepts the positions.json sign takes", async () => {
    const { code, stdout } = await run("validate", await write("bundle.json", bundle));
    expect(code).toBe(0);
    expect(stdout).toContain("kind:      sign input");
    expect(stdout).toContain("VALID");
    expect(stdout).toContain("positions: 1");
  });

  test("accepts a bare array of positions", async () => {
    const { code } = await run("validate", await write("array.json", [position]));
    expect(code).toBe(0);
  });

  test("rejects a key sign would have dropped", async () => {
    const path = await write("typo.json", { ...bundle, endorsedBy: [] });
    const { code, stdout } = await run("validate", path);
    expect(code).toBe(1);
    expect(stdout).toContain("INVALID");
    expect(stdout).toContain("endorsedBy");
  });

  test("checks a complete payload as a payload", async () => {
    const payload = {
      v: 1,
      issuer: { key: "ed25519:check" },
      issued_at: "2026-10-19T00:00:00Z",
      ...bundle,
    };
    const valid = await run("validate", await write("payload.json", payload));
    expect(valid.code).toBe(0);
    expect(valid.stdout).toContain("kind:      SlatePayload");

    const { issued_at: _, ...missing } = payload;
    const invalid = await run("validate", await write("partial.json", missing));
    expect(invalid.code).toBe(1);
    expect(invalid.stdout).toContain("issued_at: Required");
  });
});

describe("openslate sign", () => {
  test("signs what validate accepts", async () => {
    const { code, stdout } = await run("sign", await write("sign.json", bundle), "--key", keyPath);
    expect(code).toBe(0);
    const verified = await run("verify", stdout.trim());
    expect(verified.code).toBe(0);
  });

  test("refuses what validate rejects, instead of dropping the unknown key", async () => {
    const path = await write("sign-typo.json", { ...bundle, endorsedBy: [] });
    const { code, stderr } = await run("sign", path, "--key", keyPath);
    expect(code).toBe(1);
    expect(stderr).toContain("endorsedBy");
  });
});
