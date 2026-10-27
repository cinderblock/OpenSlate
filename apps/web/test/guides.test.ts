import { afterEach, describe, expect, test } from "bun:test";
import { type GuideManifest, sha256 } from "@openslate/core";
import {
  fetchGuideFile,
  type GuideEntry,
  GuideFileMismatch,
  guideListUrl,
  guidesFor,
  parseGuideList,
} from "../src/lib/guides";

const CA: GuideEntry = {
  election: "2026-11-03",
  jurisdiction: "us/ca",
  url: "https://example.org/ca/guide.jws",
  key: "ed25519:test",
};

describe("voter guides", () => {
  test("the list sits beside the catalog's index.json", () => {
    expect(
      guideListUrl("https://cinderblock.github.io/openslate-public-endorsements/index.json"),
    ).toBe("https://cinderblock.github.io/openslate-public-endorsements/guides.json");
  });

  test("a list's guides resolve against the list, so a snapshot can carry them", () => {
    const listUrl = "views://mainview/catalog/guides.json";
    const guides = parseGuideList(
      {
        version: 1,
        guides: [
          { ...CA, url: "guides/example.org/ca/guide.jws" },
          { ...CA, url: "https://example.org/sf/guide.jws" },
          { election: "2026-11-03", jurisdiction: "us/ca/la" } as GuideEntry,
        ],
      },
      listUrl,
    );
    expect(guides.map((g) => g.url)).toEqual([
      "views://mainview/catalog/guides/example.org/ca/guide.jws",
      "https://example.org/sf/guide.jws",
    ]);
  });

  test("a guide covers its own area and the areas inside it, for its election", () => {
    const statewide = {
      title: "Governor of California",
      jurisdiction: "us/ca",
      election: "2026-11-03",
    };
    const local = {
      title: "San Francisco — Measure A",
      jurisdiction: "us/ca/sf",
      election: "2026-11-03",
    };
    expect(guidesFor([CA], statewide)).toEqual([CA]);
    expect(guidesFor([CA], local)).toEqual([CA]);
  });

  test("not another election, nor an area that only shares a prefix", () => {
    expect(
      guidesFor([CA], { title: "Governor", jurisdiction: "us/ca", election: "2026-06-02" }),
    ).toEqual([]);
    expect(guidesFor([CA], { title: "X", jurisdiction: "us/cap", election: "2026-11-03" })).toEqual(
      [],
    );
    expect(guidesFor([CA], { title: "X", election: "2026-11-03" })).toEqual([]);
  });

  test("a county guide covers the districts it lists, beside its own area", () => {
    const SF: GuideEntry = {
      election: "2026-11-03",
      jurisdiction: "us/ca/sf",
      covers: ["us/ca/sf", "us/ca/cd-11", "us/ca/bart-8"],
      url: "https://example.org/ca/county/sf/guide.jws",
      key: "ed25519:test",
    };
    const house = {
      title: "US House of Representatives, California District 11",
      jurisdiction: "us/ca/cd-11",
      election: "2026-11-03",
    };
    // The state guide's area contains the district too; both are tried, in catalog order.
    expect(guidesFor([CA, SF], house)).toEqual([CA, SF]);
    expect(
      guidesFor([SF], { title: "X", jurisdiction: "us/ca/cd-12", election: "2026-11-03" }),
    ).toEqual([]);
    expect(
      guidesFor([SF], { title: "X", jurisdiction: "us/ca/cd-1", election: "2026-11-03" }),
    ).toEqual([]);
  });
});

describe("fetching a guide's files", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  async function setup(served: string[]) {
    const fresh = new TextEncoder().encode('{"v":1}');
    const manifest = { files: { "items/x.json": await sha256(fresh) } } as unknown as GuideManifest;
    const caches: (RequestCache | undefined)[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      caches.push(init?.cache);
      return new Response(served[caches.length - 1] ?? "");
    }) as typeof fetch;
    return { manifest, caches };
  }

  test("a stale cached copy is fetched again from the server", async () => {
    const { manifest, caches } = await setup(['{"v":0}', '{"v":1}']);
    const bytes = await fetchGuideFile(CA, manifest, "items/x.json");
    expect(new TextDecoder().decode(bytes)).toBe('{"v":1}');
    expect(caches).toEqual(["default", "no-cache"]);
  });

  test("a file that never matches is a mismatch, not a network error", async () => {
    const { manifest } = await setup(['{"v":0}', '{"v":0}']);
    await expect(fetchGuideFile(CA, manifest, "items/x.json")).rejects.toBeInstanceOf(
      GuideFileMismatch,
    );
  });
});
