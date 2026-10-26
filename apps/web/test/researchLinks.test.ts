import { describe, expect, test } from "bun:test";
import { candidateLinks, raceLinks, raceQuery } from "../src/lib/researchLinks";

const E = "2026-11-03";
const prop = {
  subject: {
    title: "California – Proposition 43 (Limits Voters' Ability to Raise Revenues)",
    kind: "measure",
  },
  jurisdiction: "us/ca",
  election: E,
};
const governor = {
  subject: { title: "Governor of California", kind: "race" },
  jurisdiction: "us/ca",
  election: E,
};

describe("raceQuery", () => {
  test("drops a measure's long label and adds the year", () => {
    expect(raceQuery(prop)).toBe("California Proposition 43 2026");
    expect(
      raceQuery({
        subject: { title: "US House of Representatives, California District 37" },
        election: E,
      }),
    ).toBe("US House of Representatives California District 37 2026");
  });
});

describe("raceLinks", () => {
  test("a statewide proposition gets the official guide page first", () => {
    const links = raceLinks(prop, "2026-10-21");
    expect(links.map((l) => l.label)).toEqual([
      "Official guide",
      "Ballotpedia",
      "CalMatters",
      "News",
    ]);
    expect(links[0]?.href).toBe("https://voterguide.sos.ca.gov/propositions/43/");
    expect(links[1]?.href).toBe(
      "https://ballotpedia.org/wiki/index.php?search=California+Proposition+43+2026&title=Special%3ASearch",
    );
    expect(links[2]?.href).toBe("https://calmatters.org/?s=California+Proposition+43+2026");
  });

  test("statewide offices point at the candidate statements", () => {
    expect(raceLinks(governor, "2026-10-21")[0]?.href).toBe(
      "https://voterguide.sos.ca.gov/candidates/",
    );
  });

  test("no official guide once the election is past: the site moves on", () => {
    expect(raceLinks(prop, "2026-11-04").map((l) => l.label)).not.toContain("Official guide");
  });

  test("local races get no state guide; other states no CalMatters", () => {
    const local = { ...governor, subject: { title: "Berkeley City Council, District 4" } };
    expect(
      raceLinks({ ...local, jurisdiction: "us/ca/berkeley" }, "2026-10-21").map((l) => l.label),
    ).toEqual(["Ballotpedia", "CalMatters", "News"]);
    expect(
      raceLinks({ ...local, jurisdiction: "us/or" }, "2026-10-21").map((l) => l.label),
    ).toEqual(["Ballotpedia", "News"]);
  });

  test("a slate's own link comes first", () => {
    const linked = {
      ...governor,
      subject: { ...governor.subject, uri: "https://example.org/gov" },
    };
    expect(raceLinks(linked, "2026-10-21")[0]).toMatchObject({
      label: "More info",
      href: "https://example.org/gov",
    });
  });
});

describe("candidateLinks", () => {
  test("Ballotpedia jumps to the candidate's page; news is scoped to the race", () => {
    const [bp, news] = candidateLinks(governor, "Xavier Becerra");
    expect(bp?.href).toBe(
      "https://ballotpedia.org/wiki/index.php?search=Xavier+Becerra&title=Special%3ASearch&go=Go",
    );
    expect(news?.href).toContain("q=%22Xavier+Becerra%22+Governor+of+California+2026");
  });

  test("none for a measure's Yes / No", () => {
    expect(candidateLinks(prop, "Yes")).toEqual([]);
  });
});
