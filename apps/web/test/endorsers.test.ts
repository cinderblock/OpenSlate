import { describe, expect, test } from "bun:test";
import { type Position, createSlate, generateKeyPair } from "@openslate/core";
import { decodeSlates } from "../src/lib/collate";
import {
  directoryFromCatalog,
  hueOf,
  initialsOf,
  leanScore,
  leanWord,
  localLeans,
  stackMarkers,
} from "../src/lib/endorsers";
import type { Catalog, CatalogEntry } from "../src/lib/query";

const CATALOG_URL = "https://example.org/catalog/index.json";
const researcher = { key: "ed25519:RESEARCHER", name: "Researcher", kind: "researcher" };

function entry(name: string, extra: Partial<CatalogEntry> = {}): CatalogEntry {
  const slug = name.toLowerCase().replace(/\W+/g, "-");
  return {
    slug,
    election: "2026-11-03",
    path: `orgs/${slug}/2026-11-03/signed.slate`,
    issuer: researcher,
    attribution: {
      of: { name, uri: `https://${slug}.example/`, kind: "organization" },
      mode: "scraped",
      retrieved_at: "2026-10-19T00:00:00Z",
    },
    positions: 3,
    issued_at: "2026-10-20T00:00:00Z",
    ...extra,
  };
}

describe("directoryFromCatalog", () => {
  const catalog: Catalog = {
    version: 1,
    generated_at: "2026-10-20T00:00:00Z",
    entries: [
      entry("Green Group", { logo: "orgs/green-group/logo.png", lean: { left: 4, right: 1 } }),
      entry("Green Group", { election: "2026-03-03", lean: { left: 2, right: 0 } }),
      entry("Plain Org"),
    ],
  };
  const directory = directoryFromCatalog(catalog, CATALOG_URL);

  test("resolves logos against the catalog URL and adds up lean across elections", () => {
    const green = directory.get("of:green-group.example");
    expect(green?.logo).toBe("https://example.org/catalog/orgs/green-group/logo.png");
    expect(green?.lean).toEqual({ left: 6, right: 1, via: "catalog" });
  });

  test("an entry with neither has no logo or lean", () => {
    expect(directory.get("of:plain-org.example")).toEqual({});
  });

  test("ignores a logo that isn't http(s)", () => {
    const odd = directoryFromCatalog(
      { ...catalog, entries: [entry("Odd", { logo: "javascript:alert(1)" })] },
      CATALOG_URL,
    );
    expect(odd.get("of:odd.example")?.logo).toBeUndefined();
  });

  test("carries a white-only logo's dark background, only alongside the logo", () => {
    const dark = directoryFromCatalog(
      {
        ...catalog,
        entries: [
          entry("White Mark", { logo: "orgs/white-mark/logo.png", logo_background: "dark" }),
          entry("No Logo", { logo_background: "dark" }),
        ],
      },
      CATALOG_URL,
    );
    expect(dark.get("of:white-mark.example")?.logoBackground).toBe("dark");
    expect(dark.get("of:no-logo.example")).toEqual({});
    expect(directory.get("of:green-group.example")?.logoBackground).toBeUndefined();
  });

  test("a catalog built into the desktop app serves its logos from its own scheme", () => {
    const builtIn = directoryFromCatalog(
      { ...catalog, entries: [entry("Green Group", { logo: "orgs/green-group/logo.png" })] },
      "views://mainview/catalog/index.json",
    );
    expect(builtIn.get("of:green-group.example")?.logo).toBe(
      "views://mainview/catalog/orgs/green-group/logo.png",
    );
    const odd = directoryFromCatalog(
      { ...catalog, entries: [entry("Odd", { logo: "javascript:alert(1)" })] },
      "views://mainview/catalog/index.json",
    );
    expect(odd.get("of:odd.example")?.logo).toBeUndefined();
  });
});

describe("leanScore", () => {
  test("is undefined below the minimum and -1 … 1 above it", () => {
    expect(leanScore(undefined)).toBeUndefined();
    expect(leanScore({ left: 2, right: 1, via: "local" })).toBeUndefined();
    expect(leanScore({ left: 6, right: 0, via: "local" })).toBe(-1);
    expect(leanScore({ left: 1, right: 4, via: "catalog" })).toBeCloseTo(0.6);
  });

  test("words follow the score", () => {
    expect(leanWord(-1)).toBe("Sides with Democrats");
    expect(leanWord(0)).toBe("Mixed");
    expect(leanWord(0.4)).toBe("Leans Republican");
  });
});

describe("localLeans", () => {
  const keys = generateKeyPair();
  const E = "2026-11-03";
  const gov = { title: "Governor", kind: "race", jurisdiction: "us/ca", election: E };
  const sos = { title: "Secretary of State", kind: "race", jurisdiction: "us/ca", election: E };
  const slate = (name: string, kind: string, positions: Position[]) => ({
    token: createSlate({
      keyPair: keys,
      issuer: { name: researcher.name, kind: researcher.kind },
      attribution: {
        of: { name, kind },
        mode: "scraped",
        retrieved_at: "2026-10-19T00:00:00Z",
      },
      context: { election: E },
      positions,
    }).token,
    importedAt: "2026-10-20T00:00:00Z",
  });

  const ballot = slate("Secretary of State", "election-authority", [
    { subject: gov, stance: "neutral", choice: "Alice", statement: "Democratic · Attorney" },
    { subject: gov, stance: "neutral", choice: "Bob", statement: "Republican · Rancher" },
    { subject: sos, stance: "neutral", choice: "Erin", statement: "Democratic · Clerk" },
    { subject: sos, stance: "neutral", choice: "Frank", statement: "Republican · Clerk" },
  ]);
  const left = slate("Lefty", "organization", [
    { subject: gov, stance: "endorse", choice: "Alice" },
    { subject: sos, stance: "endorse", choice: "Erin" },
  ]);

  test("counts sides in the imported ballot's Democrat-vs-Republican races", () => {
    const leans = localLeans(decodeSlates([ballot, left]));
    expect(leans.get("of:lefty")).toEqual({ left: 2, right: 0, via: "local" });
    // The ballot source itself isn't placed.
    expect(leans.size).toBe(1);
  });

  test("needs ballot data", () => {
    expect(localLeans(decodeSlates([left])).size).toBe(0);
  });
});

describe("avatars", () => {
  test("initials skip minor words and parentheticals", () => {
    expect(initialsOf("San Francisco Chronicle (editorial board)")).toBe("SF");
    expect(initialsOf("League of Conservation Voters")).toBe("LC");
    expect(initialsOf("SEIU")).toBe("S");
    expect(initialsOf("—")).toBe("?");
  });

  test("a source keeps its hue", () => {
    expect(hueOf("of:a.example")).toBe(hueOf("of:a.example"));
    expect(hueOf("of:a.example")).toBeGreaterThanOrEqual(0);
    expect(hueOf("of:a.example")).toBeLessThan(360);
  });
});

describe("stackMarkers", () => {
  test("overlapping markers go up a row; distant ones share the bottom row", () => {
    // 100 px wide, 10 px markers: anything closer than 0.1 stacks.
    const rows = stackMarkers([{ x: 0 }, { x: 0.05 }, { x: 0.5 }, { x: 0.12 }], 10, 100);
    expect(rows.map((r) => [r.x, r.row])).toEqual([
      [0, 0],
      [0.05, 1],
      [0.12, 0],
      [0.5, 0],
    ]);
  });
});
