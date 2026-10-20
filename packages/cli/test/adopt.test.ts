import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSlate, generateKeyPair } from "@openslate/core";

const cli = join(import.meta.dir, "..", "src", "index.ts");
const dir = mkdtempSync(join(tmpdir(), "openslate-adopt-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const E = "2026-11-03";
const party = createSlate({
  keyPair: generateKeyPair(),
  issuer: { name: "Researcher", kind: "researcher" },
  attribution: {
    of: { name: "State Party" },
    mode: "scraped",
    retrieved_at: "2026-10-19T00:00:00Z",
  },
  context: { election: E },
  positions: [
    { subject: { title: "Governor", election: E }, stance: "endorse", choice: "Alice" },
    { subject: { title: "Prop 1", election: E }, stance: "endorse", choice: "Yes" },
  ],
});
const slatePath = join(dir, "party.slate");
await Bun.write(slatePath, party.token);

async function run(...args: string[]) {
  const proc = Bun.spawn(["bun", cli, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe("openslate adopt", () => {
  test("copy appends the selected positions", async () => {
    const into = join(dir, "copy.json");
    const { code } = await run(
      "adopt",
      slatePath,
      "--mode",
      "copy",
      "--match",
      "gov",
      "--into",
      into,
    );
    expect(code).toBe(0);
    const out = await Bun.file(into).json();
    expect(out.positions).toHaveLength(1);
    expect(out.positions[0].choice).toBe("Alice");
    expect(out.adopts).toBeUndefined();
  });

  test("embed writes an adoption carrying the token, issuer, of and election", async () => {
    const { code, stdout } = await run(
      "adopt",
      slatePath,
      "--mode",
      "embed",
      "--source",
      "https://e.org/g",
    );
    expect(code).toBe(0);
    const adoption = JSON.parse(stdout);
    expect(adoption).toMatchObject({
      issuer: party.payload.issuer.key,
      of: "State Party",
      election: E,
      slate: party.token,
      source: "https://e.org/g",
    });
    expect(adoption.subjects).toBeUndefined(); // all positions selected
  });

  test("reference requires a uri; with one it lists only the chosen subjects", async () => {
    expect((await run("adopt", slatePath, "--mode", "reference")).code).not.toBe(0);
    const { code, stdout } = await run(
      "adopt",
      slatePath,
      "--mode",
      "reference",
      "--uri",
      "https://e.org/party.slate",
      "--match",
      "prop",
    );
    expect(code).toBe(0);
    const adoption = JSON.parse(stdout);
    expect(adoption.uri).toBe("https://e.org/party.slate");
    expect(adoption.slate).toBeUndefined();
    expect(adoption.subjects).toEqual([{ title: "Prop 1", election: E }]);
  });
});
