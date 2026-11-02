import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createIdentity, createSlate } from "@openslate/core";

const cli = join(import.meta.dir, "..", "src", "index.ts");
const dir = mkdtempSync(join(tmpdir(), "openslate-races-"));

const ELECTION = "2099-11-03";
const prop = {
  title: "California — Proposition 1 (Authorizes Bonds)",
  kind: "measure",
  jurisdiction: "us/ca",
  election: ELECTION,
};
const mayor = {
  title: "Mayor of Springfield",
  kind: "race",
  jurisdiction: "us/ca/springfield",
  election: ELECTION,
  ballot: { vote_for: 1 },
};
const attribution = {
  of: { name: "Secretary of State", kind: "election-authority" },
  mode: "scraped" as const,
  retrieved_at: "2026-10-01T00:00:00Z",
};

function listing(election: string, subjects: { subject: object; choices: string[] }[]) {
  return createSlate({
    issuer: { name: "Researcher", kind: "researcher" },
    keyPair: createIdentity({ kind: "researcher" }).keyPair,
    context: { election },
    attribution,
    positions: subjects.flatMap(({ subject, choices }) =>
      choices.map((choice) => ({
        subject: subject as typeof prop,
        stance: "neutral" as const,
        choice,
      })),
    ),
  }).token;
}

const tokens: Record<string, string> = {
  "/now.slate": listing(ELECTION, [
    { subject: prop, choices: ["Yes", "No"] },
    { subject: mayor, choices: ["Donald P. (Don) Wagner", "Ana Ruiz"] },
  ]),
  "/old.slate": listing("2001-03-06", [
    { subject: { ...prop, title: "Old Measure", election: "2001-03-06" }, choices: ["Yes", "No"] },
  ]),
  "/broken.slate": "not-a-slate",
};
const entry = (path: string, election: string) => ({
  election,
  path: path.slice(1),
  attribution: { of: { kind: "election-authority" } },
});
const server = Bun.serve({
  port: 0,
  fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/index.json")
      return Response.json({
        entries: [
          entry("/now.slate", ELECTION),
          entry("/old.slate", "2001-03-06"),
          entry("/broken.slate", ELECTION),
          { election: ELECTION, path: "org.slate", attribution: { of: { kind: "organization" } } },
        ],
      });
    const token = tokens[pathname];
    return token ? new Response(token) : new Response("missing", { status: 404 });
  },
});
const catalog = `http://localhost:${server.port}/index.json`;
afterAll(() => {
  server.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

async function run(...args: string[]) {
  // Async, not spawnSync: this process is also the server the CLI calls.
  const proc = Bun.spawn(["bun", cli, ...args, "--catalog", catalog], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

const races = (stdout: string) =>
  stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

async function check(positions: object[]) {
  const path = join(dir, `positions-${crypto.randomUUID()}.json`);
  await Bun.write(path, JSON.stringify({ context: { election: ELECTION }, positions }));
  return run("check", path);
}

const { ballot: _ballot, ...mayorSubject } = mayor;

describe("openslate races", () => {
  test("lists the next election's races, ready to copy into a position", async () => {
    const { stdout, stderr, exitCode } = await run("races");
    expect(exitCode).toBe(0);
    expect(stderr).toContain("skipping broken.slate");
    expect(races(stdout)).toEqual([
      { subject: prop, choices: ["Yes", "No"] },
      {
        subject: mayorSubject,
        vote_for: 1,
        choices: ["Donald P. (Don) Wagner", "Ana Ruiz"],
      },
    ]);
  });

  test("--election picks another election", async () => {
    const { stdout } = await run("races", "--election", "2001-03-06");
    expect(races(stdout).map((r) => r.subject.title)).toEqual(["Old Measure"]);
  });

  test("--where keeps matching titles or jurisdictions, any of a comma list", async () => {
    const { stdout } = await run("races", "--where", "SPRINGFIELD");
    expect(races(stdout).map((r) => r.subject.title)).toEqual(["Mayor of Springfield"]);
    const both = await run("races", "--where", "proposition, us/ca/springfield");
    expect(races(both.stdout)).toHaveLength(2);
  });

  test("-o writes the races to a file", async () => {
    const out = join(dir, "nested", "races.jsonl");
    const { stdout } = await run("races", "-o", out);
    expect(stdout).toBe("");
    expect(races(readFileSync(out, "utf8"))).toHaveLength(2);
  });
});

describe("openslate check", () => {
  test("passes positions that line up, nicknames included", async () => {
    const { stdout, exitCode } = await check([
      { subject: prop, stance: "endorse", choice: "No" },
      { subject: mayorSubject, stance: "endorse", choice: "Don Wagner" },
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("2 of 2 position(s) line up");
  });

  test("fails a race that isn't the ballot's, by its exact title", async () => {
    const { stdout, exitCode } = await check([
      { subject: { ...prop, title: "Prop 1" }, stance: "endorse", choice: "Yes" },
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('race not on the ballot: "Prop 1"');
  });

  test("fails a name that isn't on the ballot, offering the closest", async () => {
    const { stdout, exitCode } = await check([
      { subject: mayorSubject, stance: "endorse", choice: "Anna Ruiz" },
    ]);
    expect(exitCode).toBe(1);
    expect(stdout).toContain('not on the ballot: "Anna Ruiz"');
    expect(stdout).toContain('closest is "Ana Ruiz"');
  });

  test("doesn't fail a place no listing covers, but counts it", async () => {
    const { stdout, exitCode } = await check([
      { subject: { ...mayorSubject, jurisdiction: "us/or/salem" }, stance: "endorse", choice: "X" },
    ]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("1 where no ballot listing exists");
  });
});
