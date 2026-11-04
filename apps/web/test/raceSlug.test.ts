import { describe, expect, test } from "bun:test";
import { parseRaceSlug, raceSlug, slugify, subjectSlug } from "../src/lib/raceSlug";
import { subjectKey } from "../src/lib/subjects";

describe("slugify", () => {
  test("lowercase words joined by hyphens", () => {
    expect(slugify("Los Angeles Community College District Board, Seat 4")).toBe(
      "los-angeles-community-college-district-board-seat-4",
    );
  });

  test("drops apostrophes and accents, spells out &", () => {
    expect(slugify("Limits Voters’ Ability")).toBe("limits-voters-ability");
    expect(slugify("Peña & O'Brien")).toBe("pena-and-obrien");
  });

  test("dashes and parentheses collapse", () => {
    expect(slugify("California — Proposition 1 (Authorizes Bonds)")).toBe(
      "california-proposition-1-authorizes-bonds",
    );
  });
});

describe("subjectSlug", () => {
  test("election, jurisdiction path, title", () => {
    expect(subjectSlug({ title: "Governor", jurisdiction: "us/ca", election: "2026-11-03" })).toBe(
      "2026-11-03/us/ca/governor",
    );
  });

  test("a missing election is _, a missing jurisdiction has no segments", () => {
    expect(subjectSlug({ title: "Governor" })).toBe("_/governor");
    expect(subjectSlug({ title: "Governor", election: "2026-11-03" })).toBe("2026-11-03/governor");
  });

  test("a title with nothing to slug still has a segment", () => {
    expect(subjectSlug({ title: "—", election: "2026-11-03" })).toBe("2026-11-03/race");
  });
});

describe("raceSlug", () => {
  test("from a subject key", () => {
    const key = subjectKey({ title: "Prop 1", jurisdiction: "us/ca", election: "2026-11-03" });
    expect(raceSlug(key)).toBe("2026-11-03/us/ca/prop-1");
  });

  test("undefined for an id key", () => {
    expect(raceSlug("vip:contest-123")).toBeUndefined();
  });
});

describe("parseRaceSlug", () => {
  test("round-trips subjectSlug's election and jurisdiction", () => {
    const slug = subjectSlug({
      title: "Board, Seat 4",
      jurisdiction: "us/ca/los-angeles",
      election: "2026-11-03",
    });
    expect(parseRaceSlug(slug)).toEqual({
      slug,
      election: "2026-11-03",
      jurisdiction: "us/ca/los-angeles",
      titleSlug: "board-seat-4",
    });
  });

  test("_ is no election, two segments is no jurisdiction", () => {
    expect(parseRaceSlug("_/governor")).toEqual({ slug: "_/governor", titleSlug: "governor" });
    expect(parseRaceSlug("2026-11-03/governor")).toEqual({
      slug: "2026-11-03/governor",
      election: "2026-11-03",
      titleSlug: "governor",
    });
  });

  test("a hand-typed capital still finds the race", () => {
    expect(parseRaceSlug("2026-11-03/US/CA/Governor")?.slug).toBe("2026-11-03/us/ca/governor");
  });

  test("ignores stray slashes; one segment isn't a slug", () => {
    expect(parseRaceSlug("/2026-11-03//us/ca/governor/")?.slug).toBe("2026-11-03/us/ca/governor");
    expect(parseRaceSlug("governor")).toBeUndefined();
  });
});
