import { describe, expect, test } from "bun:test";
import {
  buildCatalogShards,
  entryRegions,
  racesByJurisdiction,
  regionOfJurisdiction,
  regionsOf,
  shardDirectory,
  shardEntries,
  shardsFor,
} from "../src/catalog";
import type { SlatePayload } from "../src/schema";

const E = "2026-11-03";

function payload(
  positions: SlatePayload["positions"],
  context?: SlatePayload["context"],
): SlatePayload {
  return {
    v: 1,
    issuer: { key: "ed25519:x" },
    issued_at: "2026-10-24T00:00:00Z",
    positions,
    ...(context ? { context } : {}),
  } as SlatePayload;
}

describe("racesByJurisdiction", () => {
  test("counts distinct races per jurisdiction", () => {
    const gov = { title: "Governor", kind: "race", jurisdiction: "us/ca", election: E };
    const board = { title: "Board", kind: "race", jurisdiction: "us/ca/sf", election: E };
    expect(
      racesByJurisdiction(
        payload([
          { subject: gov, stance: "endorse", choice: "Alice" },
          { subject: board, stance: "endorse", choice: "Bob" },
          // A second pick in the same race is still one race.
          { subject: board, stance: "endorse", choice: "Carol" },
        ]),
      ),
    ).toEqual({ "us/ca": 1, "us/ca/sf": 1 });
  });

  test("falls back to the slate's context, then to none", () => {
    const mayor = { title: "Mayor", kind: "race", election: E };
    const prop = { title: "Prop A", kind: "measure", election: E };
    expect(
      racesByJurisdiction(
        payload(
          [
            { subject: mayor, stance: "endorse", choice: "Dana" },
            { subject: prop, stance: "endorse", choice: "Yes" },
          ],
          { election: E, jurisdiction: "us/ca/oakland" },
        ),
      ),
    ).toEqual({ "us/ca/oakland": 2 });
    expect(racesByJurisdiction(payload([{ subject: mayor, stance: "neutral" }]))).toEqual({
      "": 1,
    });
  });

  test("an attached article covers its race too, once (SPEC §3.15)", () => {
    const prop = { title: "Prop 1", kind: "measure", jurisdiction: "us/ca", election: E };
    const measure = { title: "Measure A", kind: "measure", jurisdiction: "us/ca/sf", election: E };
    const withArticles = {
      ...payload([{ subject: prop, stance: "endorse", choice: "Yes" }]),
      articles: [
        { subject: prop, uri: "https://news.example/p1", title: "Prop 1, explained" },
        { subject: measure, uri: "https://news.example/a", title: "Measure A" },
      ],
    } as SlatePayload;
    expect(racesByJurisdiction(withArticles)).toEqual({ "us/ca": 1, "us/ca/sf": 1 });
  });

  test("a regional contest counts where it's voted, not under the region (SPEC §3.3)", () => {
    const rtm = {
      title: "Bay Area — Regional Measure RTM",
      kind: "measure",
      jurisdiction: "us/ca/bay-area",
      voted_in: ["us/ca/alameda-county", "us/ca/sf", "us/ca/sf"],
      election: E,
    };
    const measure = { title: "Measure A", kind: "measure", jurisdiction: "us/ca/sf", election: E };
    const withArticles = {
      ...payload([
        { subject: rtm, stance: "endorse", choice: "Yes" },
        { subject: measure, stance: "endorse", choice: "Yes" },
      ]),
      articles: [{ subject: rtm, uri: "https://news.example/rtm", title: "RTM, explained" }],
    } as SlatePayload;
    // Once per county however often it's named; SF has it and Measure A.
    expect(racesByJurisdiction(withArticles)).toEqual({ "us/ca/alameda-county": 1, "us/ca/sf": 2 });
  });
});

describe("regionsOf", () => {
  const rtm = {
    title: "Bay Area — Regional Measure RTM",
    kind: "measure",
    jurisdiction: "us/ca/bay-area",
    voted_in: ["us/ca/sf", "us/ca/alameda-county", "us/ca/sf"],
    election: E,
  };

  test("lists each region with where its contests are voted (SPEC §3.3)", () => {
    const rm4 = {
      title: "Bay Area — Regional Measure 4",
      kind: "measure",
      jurisdiction: "us/ca/bay-area",
      voted_in: ["us/ca/marin-county", "us/ca/sf"],
      election: E,
    };
    const measure = { title: "Measure A", kind: "measure", jurisdiction: "us/ca/sf", election: E };
    expect(
      regionsOf(
        payload([
          { subject: rtm, stance: "endorse", choice: "Yes" },
          { subject: rm4, stance: "oppose", choice: "Yes" },
          { subject: measure, stance: "endorse", choice: "Yes" },
        ]),
      ),
    ).toEqual({ "us/ca/bay-area": ["us/ca/alameda-county", "us/ca/marin-county", "us/ca/sf"] });
  });

  test("an article's contest counts; one filed under the slate's context names that region", () => {
    const { jurisdiction: _, ...unfiled } = rtm;
    const articles = {
      ...payload([], { election: E, jurisdiction: "us/ca/bay-area" }),
      articles: [{ subject: unfiled, uri: "https://news.example/rtm", title: "RTM, explained" }],
    } as SlatePayload;
    expect(regionsOf(articles)).toEqual({ "us/ca/bay-area": ["us/ca/alameda-county", "us/ca/sf"] });
  });

  test("nothing without voted_in", () => {
    const { voted_in: _, ...plain } = rtm;
    expect(regionsOf(payload([{ subject: plain, stance: "endorse", choice: "Yes" }]))).toEqual({});
  });
});

describe("shards", () => {
  const entry = (
    slug: string,
    jurisdictions: Record<string, number> | undefined,
    more: { election?: string; scope?: string } = {},
  ) => ({
    slug,
    election: more.election ?? E,
    ...(more.scope ? { scope: more.scope } : {}),
    ...(jurisdictions ? { jurisdictions } : {}),
  });

  test("a jurisdiction's region is its first two segments", () => {
    expect(regionOfJurisdiction("us/ca/sf")).toBe("us/ca");
    expect(regionOfJurisdiction("US/CA")).toBe("us/ca");
    expect(regionOfJurisdiction("us/ca/orange-county/sup-2")).toBe("us/ca");
    expect(regionOfJurisdiction("us")).toBe("us");
    expect(regionOfJurisdiction("")).toBe("");
    expect(regionOfJurisdiction(undefined)).toBe("");
  });

  test("an entry is in every region its races are", () => {
    expect(entryRegions(entry("a", { "us/ca": 7, "us/ca/sf": 1 }))).toEqual(["us/ca"]);
    expect(entryRegions(entry("b", { us: 1, "us/ca/cd-11": 1, "us/tx/cd-3": 1 }))).toEqual([
      "us",
      "us/ca",
      "us/tx",
    ]);
    // An older catalog lists no races: where the slate publishes for, else nowhere.
    expect(entryRegions(entry("c", undefined, { scope: "us/ca/sf" }))).toEqual(["us/ca"]);
    expect(entryRegions(entry("d", undefined))).toEqual([""]);
    expect(entryRegions(entry("e", { "": 2 }))).toEqual([""]);
  });

  test("entries are cut by election and region, in order", () => {
    const a = entry("a", { "us/ca": 1 });
    const b = entry("b", { "us/ca/sf": 1, "us/tx": 1 });
    const c = entry("c", { "us/ca": 1 }, { election: "2026-06-02" });
    const d = entry("d", { us: 1 });
    expect(shardEntries([a, b, c, d])).toEqual([
      { region: "us/ca", election: "2026-06-02", entries: [c] },
      { region: "us", election: E, entries: [d] },
      { region: "us/ca", election: E, entries: [a, b] },
      { region: "us/tx", election: E, entries: [b] },
    ]);
    expect(shardEntries([])).toEqual([]);
  });

  test("a shard's files go under its election and region", () => {
    expect(shardDirectory("us/ca", E)).toBe("shards/2026-11-03/us/ca");
    expect(shardDirectory("us", E)).toBe("shards/2026-11-03/us");
    expect(shardDirectory("", E)).toBe("shards/2026-11-03/_");
    expect(shardDirectory("us/ca", "June primary/2026")).toBe("shards/June-primary-2026/us/ca");
    // Nothing that could climb out of the catalog's folder.
    expect(shardDirectory("../x", "..")).toBe("shards/-/-/x");
    expect(shardDirectory("us/ca", "")).toBe("shards/-/us/ca");
  });

  test("a voter needs their region's shards and its parents'", () => {
    const shards = ["", "us", "us/ca", "us/tx", "de/by"].map((region) => ({ region }));
    const regions = (wanted: string[]) => shardsFor(shards, wanted).map((s) => s.region);
    expect(regions(["us/ca"])).toEqual(["", "us", "us/ca"]);
    expect(regions(["us/ca/sf"])).toEqual(["", "us", "us/ca"]);
    expect(regions(["us/tx", "us/ca"])).toEqual(["", "us", "us/ca", "us/tx"]);
    expect(regions(["us"])).toEqual(["", "us"]);
    expect(regions(["de/by"])).toEqual(["", "de/by"]);
    // Nowhere said yet: everything.
    expect(regions([])).toEqual(["", "us", "us/ca", "us/tx", "de/by"]);
  });
});

describe("building a catalog's shards", () => {
  const entry = (slug: string, jurisdictions: Record<string, number>, token: string) => ({
    slug,
    election: E,
    path: `orgs/${slug}/${E}/signed.slate`,
    jurisdictions,
    token,
  });
  const ca = entry("ca", { "us/ca": 2 }, "token-ca");
  const tx = entry("tx", { "us/tx": 1 }, "token-tx");
  const both = entry("both", { "us/ca/cd-11": 1, "us/tx/cd-3": 1 }, "token-both");

  test("an index and a bundle per shard, and the list of them", async () => {
    const { list, files } = await buildCatalogShards([ca, tx, both], "2026-11-01T00:00:00Z");
    expect(list.version).toBe(2);
    expect(list.generated_at).toBe("2026-11-01T00:00:00Z");
    expect(list.shards.map((s) => [s.region, s.entries, s.index])).toEqual([
      ["us/ca", 2, "shards/2026-11-03/us/ca/index.json"],
      ["us/tx", 2, "shards/2026-11-03/us/tx/index.json"],
    ]);
    expect(files.map((f) => f.path)).toEqual([
      "shards/2026-11-03/us/ca/index.json",
      "shards/2026-11-03/us/ca/bundle.json",
      "shards/2026-11-03/us/tx/index.json",
      "shards/2026-11-03/us/tx/bundle.json",
    ]);
    const [index, bundle] = files.map((f) => JSON.parse(f.text));
    // The index lists; only the bundle carries slates.
    expect(index.entries.map((e: { slug: string }) => e.slug)).toEqual(["ca", "both"]);
    expect(index.entries.every((e: object) => !("token" in e))).toBe(true);
    expect(bundle.entries.map((e: { token: string }) => e.token)).toEqual([
      "token-ca",
      "token-both",
    ]);
    const caShard = list.shards[0];
    expect(caShard?.bundle?.bytes).toBe(new TextEncoder().encode(files[1]?.text).byteLength);
    expect(caShard?.revision).toMatch(/^[0-9a-f]{32}$/);
  });

  test("a shard's revision changes with its own entries, not with the date or its neighbours", async () => {
    const revisions = async (entries: (typeof ca)[], at: string) =>
      Object.fromEntries(
        (await buildCatalogShards(entries, at)).list.shards.map((s) => [s.region, s.revision]),
      );
    const before = await revisions([ca, tx], "2026-11-01T00:00:00Z");
    expect(await revisions([ca, tx], "2026-11-02T00:00:00Z")).toEqual(before);
    const after = await revisions([ca, { ...tx, token: "token-tx-2" }], "2026-11-02T00:00:00Z");
    expect(after["us/ca"]).toBe(before["us/ca"] as string);
    expect(after["us/tx"]).not.toBe(before["us/tx"]);
  });

  test("an empty catalog has no shards", async () => {
    expect(await buildCatalogShards([], "x")).toEqual({
      list: { version: 2, generated_at: "x", shards: [] },
      files: [],
    });
  });
});
