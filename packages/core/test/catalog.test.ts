import { describe, expect, test } from "bun:test";
import { racesByJurisdiction, regionsOf } from "../src/catalog";
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
