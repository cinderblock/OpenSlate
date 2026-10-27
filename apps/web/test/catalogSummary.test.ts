import { describe, expect, test } from "bun:test";
import type { SlatePayload } from "@openslate/core";
import {
  basedInArea,
  isSummarized,
  racesInArea,
  regionsOfSummaries,
  summaryJurisdictions,
  summaryOf,
} from "../src/lib/catalogSummary";
import { EMPTY_AREA } from "../src/lib/jurisdictions";
import type { CatalogEntry } from "../src/lib/query";

const E = "2026-11-03";

function entry(extra: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    slug: "org",
    election: E,
    path: "orgs/org/2026-11-03/signed.slate",
    issuer: { key: "ed25519:R" },
    positions: 3,
    issued_at: "2026-10-24T00:00:00Z",
    ...extra,
  };
}

const payload = {
  v: 1,
  issuer: { key: "ed25519:R" },
  issued_at: "2026-10-24T00:00:00Z",
  context: { election: E, jurisdiction: "us/ca/sf" },
  positions: [
    { subject: { title: "Governor", kind: "race", jurisdiction: "us/ca" }, stance: "endorse" },
    { subject: { title: "Mayor", kind: "race" }, stance: "endorse" },
  ],
} as SlatePayload;

describe("summaryOf", () => {
  test("uses the catalog's summary when it has one", () => {
    const e = entry({ scope: "us/ca/oakland", jurisdictions: { "us/ca": 2, "us/ca/oakland": 1 } });
    expect(isSummarized(e)).toBe(true);
    // The catalog's word wins even when a payload is at hand.
    expect(summaryOf(e, payload)).toEqual({
      entry: e,
      scope: "us/ca/oakland",
      jurisdictions: { "us/ca": 2, "us/ca/oakland": 1 },
    });
  });

  test("reads an older catalog's entry from its slate", () => {
    const e = entry();
    expect(isSummarized(e)).toBe(false);
    expect(summaryOf(e, payload)).toEqual({
      entry: e,
      scope: "us/ca/sf",
      jurisdictions: { "us/ca": 1, "us/ca/sf": 1 },
    });
  });

  test("a regional race counts in the counties that vote on it, so setup finds it", () => {
    const rtm = {
      title: "Bay Area — Regional Measure RTM",
      kind: "measure",
      jurisdiction: "us/ca/bay-area",
      voted_in: ["us/ca/alameda-county", "us/ca/sf"],
    };
    // An articles-only slate (SPEC §3.15) on the measure, like Local News Matters'.
    const news = {
      ...payload,
      context: { election: E, jurisdiction: "us/ca/bay-area" },
      positions: [],
      articles: [{ subject: rtm, uri: "https://news.example/rtm", title: "RTM" }],
    } as SlatePayload;
    const summary = summaryOf(entry({ positions: 0, articles: 1 }), news);
    expect(summary.jurisdictions).toEqual({ "us/ca/alameda-county": 1, "us/ca/sf": 1 });
    expect(racesInArea(summary, { localities: ["us/ca/sf"], districts: {} })).toBe(1);
    expect(racesInArea(summary, { localities: ["us/ca/fresno-county"], districts: {} })).toBe(0);
    // And it says what the region it's filed under contains.
    expect(summary.regions).toEqual({ "us/ca/bay-area": ["us/ca/alameda-county", "us/ca/sf"] });
  });

  test("passes the catalog's regions along", () => {
    const regions = { "us/ca/bay-area": ["us/ca/sf"] };
    const e = entry({ jurisdictions: { "us/ca/sf": 1 }, regions });
    expect(summaryOf(e).regions).toEqual(regions);
  });

  test("an entry whose slate didn't load has no races", () => {
    const e = entry();
    expect(summaryOf(e)).toEqual({ entry: e, jurisdictions: {} });
  });
});

describe("racesInArea", () => {
  const summary = summaryOf(
    entry({
      jurisdictions: { "": 1, "us/ca": 4, "us/ca/sf": 2, "us/ca/cd-11": 1, "us/ca/cd-12": 1 },
    }),
  );

  test("counts every race with no area set", () => {
    expect(racesInArea(summary, EMPTY_AREA)).toBe(9);
  });

  test("counts the area's races, plus statewide ones and ones without a jurisdiction", () => {
    expect(
      racesInArea(summary, { localities: ["us/ca/sf"], districts: { "us/ca/cd": "11" } }),
    ).toBe(1 + 4 + 2 + 1);
  });
});

describe("summaryJurisdictions", () => {
  test("lists each jurisdiction with its count, for areaOptionsOf", () => {
    const a = summaryOf(entry({ jurisdictions: { "": 1, "us/ca/sf": 2 } }));
    const b = summaryOf(entry({ jurisdictions: { "us/ca/sf": 3 } }));
    expect(summaryJurisdictions([a, b])).toEqual([
      { count: 1 },
      { jurisdiction: "us/ca/sf", count: 2 },
      { jurisdiction: "us/ca/sf", count: 3 },
    ]);
  });
});

describe("basedInArea", () => {
  // Bay Area News Group is based in the region; RTM, filed under it, is voted
  // in five counties (SPEC §3.3). Another slate files RM4 under it too.
  const regions = regionsOfSummaries([
    summaryOf(
      entry({
        scope: "us/ca/bay-area",
        jurisdictions: { "us/ca": 18, "us/ca/sf": 1, "us/ca/alameda-county": 1 },
        regions: { "us/ca/bay-area": ["us/ca/alameda-county", "us/ca/sf"] },
      }),
    ),
    summaryOf(
      entry({
        jurisdictions: { "us/ca/marin-county": 1 },
        regions: { "us/ca/bay-area": ["us/ca/marin-county"] },
      }),
    ),
    summaryOf(entry({ scope: "us/ca/oakland", jurisdictions: { "us/ca/oakland": 2 } })),
  ]);
  const sf = { localities: ["us/ca/sf"], districts: {} };

  test("unions every entry's regions", () => {
    expect(regionsOfSummaries([])).toEqual(new Map());
    expect([...(regions.get("us/ca/bay-area") ?? [])].sort()).toEqual([
      "us/ca/alameda-county",
      "us/ca/marin-county",
      "us/ca/sf",
    ]);
  });

  test("a region is yours when its contests are voted where you are", () => {
    expect(basedInArea("us/ca/bay-area", sf, regions)).toBe(true);
    expect(
      basedInArea("us/ca/bay-area", { localities: ["us/ca/marin-county"], districts: {} }, regions),
    ).toBe(true);
    expect(
      basedInArea(
        "us/ca/bay-area",
        { localities: ["us/ca/fresno-county"], districts: {} },
        regions,
      ),
    ).toBe(false);
  });

  test("another place is elsewhere, and so is a region nothing places", () => {
    expect(basedInArea("us/ca/oakland", sf, regions)).toBe(false);
    expect(basedInArea("us/ca/sf", sf, regions)).toBe(true);
    expect(basedInArea("us/ca/inland-empire", sf, regions)).toBe(false);
  });

  test("a statewide source, or one with no scope, is everyone's; so is everything with no area", () => {
    expect(basedInArea("us/ca", sf, regions)).toBe(true);
    expect(basedInArea(undefined, sf, regions)).toBe(true);
    expect(basedInArea("us/ca/oakland", EMPTY_AREA, regions)).toBe(true);
  });
});
