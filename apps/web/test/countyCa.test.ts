import { describe, expect, test } from "bun:test";
import { type CountyContest, parseClaritySummary } from "@openslate/core";
import {
  catalogRaceFor,
  contestsForPlace,
  coreName,
  countyContestId,
  countyContestResult,
  countyFeed,
  countyOwn,
  feedCountyOfArea,
  localContests,
  measureLetter,
  parseCountyContestId,
  titleDistrict,
  titleWords,
} from "../src/lib/countyCa";
import { measurePasses, measureThreshold } from "../src/lib/sosCa";

function contest(key: string, title: string, category = "Local", choices = ["A", "B"]) {
  return parseClaritySummary([
    {
      K: key,
      C: title,
      CAT: category,
      VF: 1,
      TP: 10,
      PR: 4,
      CH: choices,
      P: [],
      V: [3, 1],
      PCT: [75, 25],
    },
  ])[0] as CountyContest;
}

const SANTA_CLARA = [
  contest("1", "Governor", "State and Federal"),
  contest("101", "State Proposition 1 - Housing", "Propositions", ["YES", "NO"]),
  contest("21", "Associate Justice of Supreme Court JOSHUA GROBAN", "Judicial", ["YES", "NO"]),
  contest("93", "City of Sunnyvale Council, District 1"),
  contest("94", "City of Sunnyvale Council, District 3"),
  contest("89", "Mayor, City of Santa Clara"),
  contest("43", "San José Unified SD, Trustee Area 2", "School"),
  contest("67", "Sunnyvale SD, Trustee Area 3", "School"),
  contest("48", "Fremont Union HSD, TA 3", "School"),
  contest("28", "Santa Clara County BOE, Trustee Area 7", "School"),
  contest(
    "122",
    "Measure G - City of Sunnyvale, Charter Amendment - Majority Vote Required",
    "Measures",
    ["YES", "NO"],
  ),
  contest(
    "128",
    "Measure M - Gilroy Unified School District, School Bond - 55% Vote Required",
    "Measures",
    ["YES", "NO"],
  ),
  contest("96", "Santa Clara Valley Water, District 1"),
];

describe("county results", () => {
  test("contest ids round-trip", () => {
    expect(countyContestId("santa-clara", "91")).toBe("county-ca/santa-clara/91");
    expect(parseCountyContestId("county-ca/santa-clara/91")).toEqual({
      county: "santa-clara",
      key: "91",
    });
    expect(parseCountyContestId("governor")).toBeNull();
  });

  test("a county with a feed is found by name or slug", () => {
    expect(countyFeed("Santa Clara")?.slug).toBe("santa-clara");
    expect(countyFeed("santa-clara")?.slug).toBe("santa-clara");
    expect(countyFeed("Nowhere")).toBeNull();
    expect(countyFeed(undefined)).toBeNull();
  });

  test("state and federal contests and statewide props aren't local", () => {
    const keys = localContests(SANTA_CLARA).map((c) => c.key);
    expect(keys).not.toContain("1");
    expect(keys).not.toContain("101");
    expect(keys).toContain("93");
  });

  test("a contest becomes the Live page's shape", () => {
    const r = countyContestResult(contest("93", "City of Sunnyvale Council, District 1"));
    expect(r.kind).toBe("candidates");
    expect(r.reporting.percent).toBe(40);
    expect(r.reporting.text).toBe("4 of 10 precincts reporting");
    const m = countyContestResult(SANTA_CLARA[10] as CountyContest);
    expect(m.kind === "measure" && m.measure).toMatchObject({ yes: 3, no: 1, yesPercent: 75 });
  });

  test("names compare without the generic words or accents", () => {
    expect(coreName("San José Unified SD")).toBe("san jose");
    expect(coreName("San Jose Unified School District")).toBe("san jose");
    expect(coreName("City of Sunnyvale Council")).toBe("sunnyvale");
    expect(titleWords("City of San José Council, D2")).toBe(" city of san jose council d2 ");
    expect(titleDistrict("City of Sunnyvale Council, District 3")).toBe("3");
    expect(titleDistrict("City of Los Altos Council, D2")).toBe("2");
    expect(titleDistrict("Fremont Union HSD, TA 3")).toBe("3");
    expect(titleDistrict("CITY OF ANTIOCH  MEMBER  CITY COUNCIL  DISTRICT 1")).toBe("1");
    expect(titleDistrict("City of Morgan Hill Council, District B")).toBe("b");
    expect(titleDistrict("Mayor, City of Santa Clara")).toBeUndefined();
  });

  test("other counties' wordings match too", () => {
    const contests = [
      contest("1", "CITY OF ANTIOCH  MEMBER  CITY COUNCIL  DISTRICT 1", "City"),
      contest("2", "CITY OF ANTIOCH  MEMBER  CITY COUNCIL  DISTRICT 4", "City"),
      contest("3", "Member, Santa Rosa City Council, District 2", "Results"),
      contest("4", "Camarillo City Council District 1", "Cities"),
      contest("5", "Ventura County Supervisor, District 2", "County"),
      contest("6", "Governor", "Results"),
      contest("7", "United States Representative, 26th Congressional District", "Federal"),
      contest("8", "Member of the State Assembly, 42nd District", "State"),
      contest("9", "County Treasurer-Tax Collector", "Results"),
    ];
    expect(localContests(contests).map((c) => c.key)).toEqual(["1", "2", "3", "4", "5", "9"]);
    const antioch = contestsForPlace(
      contests,
      { localities: ["us/ca/antioch"], districts: { "us/ca/antioch/council": "4" } },
      "Contra Costa",
    ).map((c) => c.key);
    expect(antioch).toEqual(["2", "5", "9"]);
  });

  test("a Sunnyvale voter's local contests", () => {
    const area = {
      localities: ["us/ca/sunnyvale", "us/ca/santa-clara-county"],
      districts: { "us/ca/sunnyvale/council": "3" },
      labels: {
        "us/ca/sunnyvale/council": "Sunnyvale council district 3",
        "us/ca/elsd": "Sunnyvale School District",
        "us/ca/hsd": "Fremont Union High School District",
      },
    };
    const keys = contestsForPlace(SANTA_CLARA, area, "Santa Clara").map((c) => c.key);
    expect(keys.sort()).toEqual(["122", "21", "28", "48", "67", "94"].sort());
  });

  test("council seats all stay when the place's council district isn't known", () => {
    const keys = contestsForPlace(
      SANTA_CLARA,
      { localities: ["us/ca/sunnyvale"], districts: {} },
      "Santa Clara",
    ).map((c) => c.key);
    expect(keys).toContain("93");
    expect(keys).toContain("94");
  });
});

describe("the county's own contests", () => {
  test("the whole county, not a district named for part of it", () => {
    const own = (title: string, county: string) => countyOwn(titleWords(title), county);
    expect(own("Santa Clara County BOE, Trustee Area 7", "santa clara")).toBe(true);
    expect(own("Measure A - County of Marin, Library Tax", "marin")).toBe(true);
    expect(own("ORANGE COUNTY BOARD OF EDUCATION Trustee Area 2", "orange")).toBe(true);
    expect(
      own(
        "NORTH ORANGE COUNTY COMMUNITY COLLEGE DISTRICT Governing Board Member, Trustee Area 1",
        "orange",
      ),
    ).toBe(false);
    expect(own("ORANGE COUNTY WATER DISTRICT Director, Division 3", "orange")).toBe(false);
    expect(own("City of Santa Clara Council, District 2", "santa clara")).toBe(false);
  });
});

describe("districts in Los Angeles' wording", () => {
  test("ordinals and 'No.'", () => {
    expect(titleDistrict("CITY OF ALHAMBRA Member of the City Council, Fifth District")).toBe("5");
    expect(titleDistrict("LOS ANGELES CITY Member of the City Council, 3rd District")).toBe("3");
    expect(
      titleDistrict("ABC UNIFIED SCHOOL DISTRICT Governing Board Member, Trustee Area No. 2"),
    ).toBe("2");
  });
});

describe("countywide contests in Los Angeles' wording", () => {
  test("county measures and the sheriff are every place's", () => {
    const contests = [
      contest("a", "COUNTY MEASURE A", "County Measures", ["YES", "NO"]),
      contest("s", "SHERIFF", "Sheriff"),
      contest("t", "Treasurer-Tax Collector", "Results"),
      contest("c", "CITY OF BURBANK GENERAL MUNICIPAL ELECTION City Treasurer", "Cities"),
    ];
    const keys = contestsForPlace(
      contests,
      { localities: ["us/ca/pasadena"], districts: {} },
      "Los Angeles",
    ).map((c) => c.key);
    expect(keys).toEqual(["a", "s", "t"]);
  });
});

describe("the catalog's race for a county contest", () => {
  const race = (
    key: string,
    jurisdiction: string,
    title: string,
    choices: string[],
    number?: string,
  ) => ({
    key,
    subject: {
      title,
      jurisdiction,
      election: "2026-11-03",
      ...(number ? { ballot: { number } } : {}),
    },
    election: "2026-11-03",
    jurisdiction,
    choices: choices.map((choice) => ({ choice })),
  });
  const races = [
    race("council3", "us/ca/sunnyvale/council-3", "City Council District 3", ["Murali Srinivasan"]),
    race("sd3", "us/ca/sunnyvale-sd", "Trustee Area 3", ["Rommy Kushner", "Michelle Maginot"]),
    race("measG", "us/ca/sunnyvale", "Measure G", [""], "G"),
    race("measGelsewhere", "us/ca/gilroy", "Measure G", [""], "G"),
    race("countyA", "us/ca/los-angeles-county", "Measure A", [""], "A"),
    race("old", "us/ca/sunnyvale/council-3", "City Council District 3", ["Murali Srinivasan"]),
  ];
  races[5] = {
    ...races[5],
    election: "2024-11-05",
    subject: { ...races[5].subject, election: "2024-11-05" },
  } as (typeof races)[number];

  test("the same people", () => {
    const seat = contest("94", "City of Sunnyvale Council, District 3", "Local", [
      "MURALI SRINIVASAN",
      "Write-in",
    ]);
    expect(catalogRaceFor(seat, races, "Santa Clara", "2026-11-03")?.key).toBe("council3");
    const board = contest("67", "Sunnyvale SD, Trustee Area 3", "School", [
      "Rommy Kushner",
      "Michelle Maginot",
      "Write-in",
    ]);
    expect(catalogRaceFor(board, races, "Santa Clara", "2026-11-03")?.key).toBe("sd3");
    const nobody = contest("9", "City of Cupertino Council", "Local", [
      "Someone Else",
      "Another Person",
    ]);
    expect(catalogRaceFor(nobody, races, "Santa Clara", "2026-11-03")).toBeUndefined();
  });

  test("a measure by its letter in its place", () => {
    const g = contest("122", "Measure G - City of Sunnyvale, Charter Amendment", "Measures", [
      "YES",
      "NO",
    ]);
    expect(catalogRaceFor(g, races, "Santa Clara", "2026-11-03")?.key).toBe("measG");
    const la = contest("a", "COUNTY MEASURE A", "County Measures", ["YES", "NO"]);
    expect(catalogRaceFor(la, races, "Los Angeles", "2026-11-03")?.key).toBe("countyA");
    expect(measureLetter("A – Laguna Beach Unified School District, Bond Measure")).toBe("A");
    expect(measureLetter("CITY OF BELL GARDENS GENERAL MUNICIPAL ELECTION - MEASURE W")).toBe("W");
    expect(
      measureLetter("San Mateo County Community College District, Measure V (55 Percent)"),
    ).toBe("V");
    expect(
      measureLetter("D – City of Irvine, Measure Directing the Use of Ranked Choice Voting"),
    ).toBe("D");
    expect(measureLetter("Regional Transit Measure (Majority Approval Required)")).toBeUndefined();
  });
});

describe("an area's county with a feed", () => {
  test("from the county among its places", () => {
    expect(
      feedCountyOfArea({ localities: ["us/ca/east-palo-alto", "us/ca/san-mateo-county"] }),
    ).toBe("San Mateo");
    expect(
      feedCountyOfArea({ localities: ["us/ca/albany"], found: ["us/ca/alameda-county"] }),
    ).toBeUndefined();
    expect(feedCountyOfArea({ localities: [], found: ["us/ca/los-angeles-county"] })).toBe(
      "Los Angeles",
    );
  });
});

describe("what a local measure needs to pass", () => {
  test("two-thirds and 55% are read from the title, and judged on yes and no", () => {
    expect(measureThreshold("City of East Palo Alto, Measure O (2/3 Approval Required)")).toBe(
      "2/3",
    );
    expect(
      measureThreshold(
        "Measure O - Alum Rock Union SD, Parcel Tax - 2/3rds (66.67%) Vote Required",
      ),
    ).toBe("2/3");
    expect(
      measureThreshold(
        "San Mateo County Community College District, Measure V (55 Percent Approval Required)",
      ),
    ).toBe("55%");
    expect(
      measureThreshold(
        "Measure M - Gilroy Unified School District, School Bond - 55% Vote Required",
      ),
    ).toBe("55%");
    expect(measureThreshold("Measure CC (Majority Approval Required)")).toBeUndefined();
    expect(measurePasses({ yes: 1171, no: 418, threshold: "2/3" })).toBe(true);
    expect(measurePasses({ yes: 60, no: 40, threshold: "2/3" })).toBe(false);
    expect(measurePasses({ yes: 2, no: 1, threshold: "2/3" })).toBe(true);
    expect(measurePasses({ yes: 54, no: 46, threshold: "55%" })).toBe(false);
    expect(measurePasses({ yes: 51, no: 49 })).toBe(true);
    expect(measurePasses({ yes: 50, no: 50 })).toBe(false);
    expect(measurePasses({ yes: 0, no: 0 })).toBe(false);
  });

  test("a county measure card carries its threshold", () => {
    const o = contest(
      "o",
      "City of East Palo Alto, Measure O (2/3 Approval Required)",
      "Measures",
      ["YES", "NO"],
    );
    const r = countyContestResult(o);
    expect(r.kind === "measure" && r.measure.threshold).toBe("2/3");
  });
});

describe("precincts on a county card", () => {
  test("left out while none has reported, though mail ballots are counted", () => {
    const [early] = parseClaritySummary([
      {
        K: "1",
        C: "Measure O",
        CAT: "Measures",
        TP: 5,
        PR: 0,
        CH: ["YES", "NO"],
        V: [1171, 418],
        PCT: [73.7, 26.3],
      },
    ]);
    if (!early) throw new Error("no contest");
    const r = countyContestResult(early);
    expect(r.reporting.percent).toBeUndefined();
    expect(r.reporting.text).toBe("");
  });
});
