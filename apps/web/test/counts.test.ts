import { describe, expect, test } from "bun:test";
import {
  countyCountsFor,
  isStateRaceId,
  stateContestFor,
  stateContestOfRace,
} from "../src/lib/counts";
import { raceLinks } from "../src/lib/researchLinks";

const E = "2026-11-03";

describe("who counts a race", () => {
  test("California's Secretary of State, for the races it reports", () => {
    const governor = stateContestFor({ title: "Governor", jurisdiction: "us/ca", election: E });
    expect(governor?.source.name).toBe("California Secretary of State");
    expect(governor?.contest).toBe("governor");
    expect(governor?.raceId).toBe("sos:governor");
    const house = stateContestFor({
      title: "U.S. Representative, District 16",
      jurisdiction: "us/ca/cd-16",
      election: E,
    });
    expect(house?.raceId).toBe("sos:us-rep/district/16");
  });

  test("nobody yet for another state, a local race or another election", () => {
    expect(
      stateContestFor({ title: "Governor", jurisdiction: "us/tx", election: E }),
    ).toBeUndefined();
    expect(
      stateContestFor({ title: "Mayor", jurisdiction: "us/ca/oakland", election: E }),
    ).toBeUndefined();
    expect(
      stateContestFor({ title: "Governor", jurisdiction: "us/ca", election: "2030-11-05" }),
    ).toBeUndefined();
    expect(stateContestFor({ title: "Governor", election: E })).toBeUndefined();
  });

  test("a race id says which count it's from", () => {
    expect(stateContestOfRace("sos:prop/50")).toMatchObject({ contest: "prop/50" });
    expect(isStateRaceId("sos:governor")).toBe(true);
    // civicAPI's ids.
    expect(isStateRaceId(41234)).toBe(false);
    expect(isStateRaceId("41234")).toBe(false);
    expect(isStateRaceId(undefined)).toBe(false);
  });

  test("county counts by the race's region", () => {
    expect(countyCountsFor("us/ca/oakland")?.region).toBe("us/ca");
    expect(countyCountsFor("us/va/richmond")).toBeUndefined();
    expect(countyCountsFor(undefined)).toBeUndefined();
  });

  test("a California county never claims another state's race", () => {
    const counties = countyCountsFor("us/ca/oakland");
    const area = { localities: ["us/ca/santa-clara-county"] };
    const race = (jurisdiction: string) => ({
      key: jurisdiction,
      subject: { title: "Mayor", jurisdiction, election: E },
      choices: [],
    });
    expect(counties?.countyFor(race("us/ca/san-jose"), area)).toBe("santa-clara");
    expect(counties?.countyFor(race("us/va/richmond"), area)).toBeUndefined();
  });
});

describe("where to read up, by region", () => {
  const labels = (jurisdiction: string, kind?: "measure") =>
    raceLinks(
      {
        subject: {
          title: kind ? "Proposition 1" : "Governor",
          jurisdiction,
          election: E,
          ...(kind ? { kind, ballot: { heading: "Proposition 1", number: "1" } } : {}),
        },
      },
      "2026-10-01",
    ).map((link) => link.label);

  test("California adds its official guide and CalMatters", () => {
    expect(labels("us/ca")).toEqual(["Official guide", "Ballotpedia", "CalMatters", "News"]);
    expect(labels("us/ca", "measure")).toEqual([
      "Official guide",
      "Ballotpedia",
      "CalMatters",
      "News",
    ]);
    // The state's guide covers what the whole state votes on.
    expect(labels("us/ca/oakland")).toEqual(["Ballotpedia", "CalMatters", "News"]);
  });

  test("any other state gets the links every state has", () => {
    expect(labels("us/va")).toEqual(["Ballotpedia", "News"]);
    expect(labels("us/va/richmond")).toEqual(["Ballotpedia", "News"]);
  });
});
