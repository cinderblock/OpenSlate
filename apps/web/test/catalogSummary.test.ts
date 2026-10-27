import { describe, expect, test } from "bun:test";
import type { SlatePayload } from "@openslate/core";
import {
  isSummarized,
  racesInArea,
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
