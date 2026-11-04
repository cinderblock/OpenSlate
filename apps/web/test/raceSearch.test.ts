import { describe, expect, test } from "bun:test";
import {
  contestAliases,
  prepareRace,
  type RaceSearchEntry,
  rankRaces,
  searchWords,
} from "../src/lib/raceSearch";

// Titles as the counties' own feeds print them (2026-11-04), and the state's list as the picker builds it.
const county = (name: string, measure?: string, people: string[] = []): RaceSearchEntry => ({
  name,
  people,
  detail: "San Mateo County",
  ...(measure ? { measure } : {}),
});

const LIST: RaceSearchEntry[] = [
  county("For Associate Justice of the Supreme Court (Joshua Groban)"),
  county(
    "For Associate Justice, Court of Appeal, 1st District, Division 1 (Monique Langhorne Wilson)",
  ),
  county("For Presiding Justice, Court of Appeal, 1st District, Division 2 (Therese M. Stewart)"),
  county("Regional Transit Measure (Majority Approval Required)"),
  county("Jefferson Union High School District, Measure M (2/3 Approval Required)", "M"),
  county("County of San Mateo, Measure AA (Majority Approval Required)", "AA"),
  county("County of San Mateo, Measure J (Majority Approval Required)", "J"),
  county("City of Burlingame, Measure D (Majority Approval Required)", "D"),
  county("City of East Palo Alto, Measure O (2/3 Approval Required)", "O"),
  county("City of East Palo Alto, Measure CC (Majority Approval Required)", "CC"),
  county("City of Half Moon Bay, Measure Q (Majority Approval Required)", "Q"),
  county("C – City of Costa Mesa, The Costa Mesa Fair Business License Reform", "C"),
  county("CITY OF ANTIOCH  MEMBER  CITY COUNCIL  DISTRICT 1", undefined, ["Tamisha Torres-Walker"]),
  county("CITY OF ANTIOCH  MEMBER  CITY COUNCIL  DISTRICT 12"),
  county("Mbr Gov Bd Alvord USD, TA 4", undefined, ["Julie Moreno"]),
  county("CITY OF ALHAMBRA GENERAL MUNICIPAL ELECTION Member of the City Council, Fifth District"),
  county("County Auditor-Controller", undefined, ["Juan Raigoza"]),
  county("LOS ANGELES CITY GENERAL MUNICIPAL ELECTION Member of the City Council, 9th District"),
  county("County Board of Education Member, Trustee Area 2"),
  county("City of San José Council, District 2", undefined, ["Pamela Campos"]),
  {
    name: "Governor",
    aliases: contestAliases("governor"),
    people: ["Xavier Becerra", "Steve Hilton"],
  },
  { name: "Lieutenant Governor", aliases: contestAliases("lieutenant-governor") },
  { name: "Controller", aliases: contestAliases("controller"), people: ["Malia Cohen"] },
  ...[1, 2, 3, 5, 10].map((n) => ({
    name: `Proposition ${n}`,
    aliases: contestAliases(`prop/${n}`),
    detail:
      n === 5 ? "Changes Recall Election Process For Statewide Officers." : "A statewide measure.",
    measure: String(n),
  })),
  ...[1, 2, 12, 15].flatMap((n) => [
    {
      name: `U.S. House District ${n}`,
      aliases: contestAliases(`us-rep/district/${n}`),
      people: n === 12 ? ["Jamie Joyce", "Lateefah Simon"] : [],
    },
    { name: `State Senate District ${n}`, aliases: contestAliases(`state-senate/district/${n}`) },
    {
      name: `State Assembly District ${n}`,
      aliases: contestAliases(`state-assembly/district/${n}`),
    },
  ]),
];
const PREPARED = LIST.map(prepareRace);
const search = (q: string) => rankRaces(LIST, PREPARED, q).map((e) => e.name);
const top = (q: string) => search(q)[0];

describe("search words", () => {
  test("case, accents, ordinals, zero padding, letters next to digits, filler", () => {
    expect(searchWords("City of San José Council, District 02")).toEqual([
      "city",
      "san",
      "jose",
      "council",
      "district",
      "2",
    ]);
    expect(searchWords("12th")).toEqual(["12"]);
    expect(searchWords("Fifth District")).toEqual(["5", "district"]);
    expect(searchWords("CD12")).toEqual(["cd", "12"]);
    expect(searchWords("Prop. 5")).toEqual(["prop", "5"]);
    expect(searchWords("O'Neil")).toEqual(["oneil"]);
  });
});

describe("measures", () => {
  test("Measure O puts East Palo Alto's Measure O first, and only titles with an O", () => {
    expect(search("Measure O")).toEqual([
      "City of East Palo Alto, Measure O (2/3 Approval Required)",
    ]);
    expect(search("measure o")[0]).toBe(top("Measure O"));
  });

  test("a letter is the measure's own: C isn't CC, A isn't AA", () => {
    expect(search("Measure C")).toEqual([
      "C – City of Costa Mesa, The Costa Mesa Fair Business License Reform",
    ]);
    expect(search("Measure CC")).toEqual([
      "City of East Palo Alto, Measure CC (Majority Approval Required)",
    ]);
    expect(top("Measure AA")).toBe("County of San Mateo, Measure AA (Majority Approval Required)");
  });

  test("a measure found with its place, in any order", () => {
    expect(top("east palo alto measure cc")).toBe(
      "City of East Palo Alto, Measure CC (Majority Approval Required)",
    );
    expect(top("palo alto")).toBe("City of East Palo Alto, Measure O (2/3 Approval Required)");
  });

  test("Prop 5, Proposition 5, prop5 and Prop 05 are Proposition 5, not 50 or 15", () => {
    for (const q of ["Prop 5", "Proposition 5", "prop5", "Prop 05", "prop. 5", "Measure 5"])
      expect(search(q)).toEqual(["Proposition 5"]);
    expect(search("Prop 1")).toEqual(["Proposition 1"]);
  });

  test("a proposition by its subject", () => {
    expect(top("recall")).toBe("Proposition 5");
  });

  test("props in their own order", () => {
    expect(search("prop")).toEqual([
      "Proposition 1",
      "Proposition 2",
      "Proposition 3",
      "Proposition 5",
      "Proposition 10",
    ]);
  });
});

describe("offices", () => {
  test("the whole name first: Governor before Lieutenant Governor, the state's Controller before the county's", () => {
    expect(search("governor").slice(0, 2)).toEqual(["Governor", "Lieutenant Governor"]);
    expect(search("controller")).toEqual(["Controller", "County Auditor-Controller"]);
    expect(top("lt gov")).toBe("Lieutenant Governor");
  });

  test("county titles in capitals, extra spaces and their own word order", () => {
    expect(top("antioch city council district 1")).toBe(
      "CITY OF ANTIOCH  MEMBER  CITY COUNCIL  DISTRICT 1",
    );
    expect(search("antioch council 1")).toEqual([
      "CITY OF ANTIOCH  MEMBER  CITY COUNCIL  DISTRICT 1",
    ]);
    expect(top("Antioch councilmember")).toBe("CITY OF ANTIOCH  MEMBER  CITY COUNCIL  DISTRICT 1");
  });

  test("county abbreviations answer to their words", () => {
    expect(top("alvord unified trustee area 4")).toBe("Mbr Gov Bd Alvord USD, TA 4");
    expect(top("alvord school board")).toBe("Mbr Gov Bd Alvord USD, TA 4");
    expect(top("court of appeal division 2")).toBe(
      "For Presiding Justice, Court of Appeal, 1st District, Division 2 (Therese M. Stewart)",
    );
  });

  test("what voters call things: RTM, LA, school board", () => {
    expect(search("RTM")).toEqual(["Regional Transit Measure (Majority Approval Required)"]);
    expect(search("Measure RTM")).toEqual([
      "Regional Transit Measure (Majority Approval Required)",
    ]);
    expect(top("LA city council 9")).toBe(
      "LOS ANGELES CITY GENERAL MUNICIPAL ELECTION Member of the City Council, 9th District",
    );
    expect(top("school board area 2")).toBe("County Board of Education Member, Trustee Area 2");
  });

  test("accents either way", () => {
    expect(top("san jose council")).toBe("City of San José Council, District 2");
    expect(top("San José")).toBe("City of San José Council, District 2");
  });
});

describe("districts", () => {
  test("a number is whole: District 1 isn't 12 or 15", () => {
    expect(search("House District 1")).toEqual(["U.S. House District 1"]);
  });

  test("12th, CD 12, Congress 12, AD 12, SD 12, senator 12", () => {
    expect(top("12th congressional district")).toBe("U.S. House District 12");
    expect(search("CD 12")[0]).toBe("U.S. House District 12");
    expect(search("cd12")[0]).toBe("U.S. House District 12");
    expect(top("congress 12")).toBe("U.S. House District 12");
    expect(top("AD 12")).toBe("State Assembly District 12");
    expect(top("assembly 12")).toBe("State Assembly District 12");
    expect(top("SD 12")).toBe("State Senate District 12");
    expect(top("state senator 12")).toBe("State Senate District 12");
  });

  test("Fifth District (Los Angeles) is district 5", () => {
    expect(top("alhambra council district 5")).toBe(
      "CITY OF ALHAMBRA GENERAL MUNICIPAL ELECTION Member of the City Council, Fifth District",
    );
  });

  test("District 12 lists the twelfth seats, not 1 or 2", () => {
    const hits = search("district 12");
    expect(hits).toContain("U.S. House District 12");
    expect(hits).toContain("CITY OF ANTIOCH  MEMBER  CITY COUNCIL  DISTRICT 12");
    expect(hits).not.toContain("U.S. House District 1");
    expect(hits).not.toContain("U.S. House District 2");
  });
});

describe("candidates", () => {
  test("a full name, a last name, part of one", () => {
    expect(search("Jamie Joyce")).toEqual(["U.S. House District 12"]);
    expect(search("joyce")).toEqual(["U.S. House District 12"]);
    expect(search("joy")).toEqual(["U.S. House District 12"]);
    expect(top("becerra")).toBe("Governor");
    expect(top("Torres Walker")).toBe("CITY OF ANTIOCH  MEMBER  CITY COUNCIL  DISTRICT 1");
  });

  test("the race's own name beats a candidate's", () => {
    // "Cohen" runs for Controller; a race named for a word beats a person with it.
    expect(top("controller")).toBe("Controller");
  });
});

test("nothing typed keeps the list as it is", () => {
  expect(search("")).toEqual(LIST.map((e) => e.name));
  expect(search("   ")).toEqual(LIST.map((e) => e.name));
});

test("aliases of state contests", () => {
  expect(contestAliases("prop/50")).toEqual(["Prop 50", "Measure 50"]);
  expect(contestAliases("us-rep/district/12")).toContain("CD 12");
  expect(contestAliases("governor")).toEqual(["Gov"]);
  expect(contestAliases("nonsense")).toEqual([]);
});
