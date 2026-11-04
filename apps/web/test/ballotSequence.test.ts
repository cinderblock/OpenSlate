import { describe, expect, test } from "bun:test";
import {
  ballotPart,
  ballotSections,
  compareBallotOrder,
  type SequencedRace,
} from "../src/lib/ballotSequence";
import type { Area } from "../src/lib/jurisdictions";

const E = "2026-11-03";

function office(title: string, jurisdiction: string, extra: Partial<SequencedRace> = {}) {
  return { subject: { title, kind: "race" }, election: E, jurisdiction, ...extra };
}

function retain(court: string, jurisdiction: string, name: string, heading: string) {
  return {
    subject: { title: `${court} — Retain Justice ${name}`, kind: "measure" },
    election: E,
    jurisdiction,
    ballot: { heading, retention: true as const },
  };
}

function measure(title: string, jurisdiction: string, number: string, extra = {}) {
  return {
    subject: { title, kind: "measure" },
    election: E,
    jurisdiction,
    ballot: { heading: `Measure ${number}`, number },
    ...extra,
  };
}

const COA = "California Court of Appeal, First District";
const coa = (name: string, role: "Associate" | "Presiding", division: string) =>
  retain(
    COA,
    "us/ca/coa-1",
    name,
    `For ${role} Justice, Court of Appeal, First District, Division ${division}`,
  );

const sanMateo: Area = { localities: ["us/ca/san-mateo-county"], districts: { "us/ca/ad": "23" } };

/**
 * A San Mateo County voter's real ballot, November 3, 2026 (AD 23, CD 16),
 * as they read it off the paper. plans/ballot-order-san-mateo-check.md.
 */
const PRINTED = [
  office("Governor of California", "us/ca"),
  office("US House of Representatives, California District 16", "us/ca/cd-16"),
  office("California State Assembly, District 23", "us/ca/ad-23"),
  retain(
    "California Supreme Court",
    "us/ca",
    "Joshua Groban",
    "For Associate Justice of the Supreme Court",
  ),
  retain(
    "California Supreme Court",
    "us/ca",
    "Kelli M. Evans",
    "For Associate Justice of the Supreme Court",
  ),
  coa("Monique Langhorne Wilson", "Associate", "One"),
  coa("Charles A. Smiley", "Associate", "One"),
  coa("Kathleen M. Banke", "Associate", "One"),
  coa("Therese M. Stewart", "Presiding", "Two"),
  coa("Tara M. Desautels", "Associate", "Two"),
  coa("Ioana Petrou", "Associate", "Three"),
  coa("Victor A. Rodriguez", "Associate", "Three"),
  coa("Tracie L. Brown", "Presiding", "Four"),
  coa("Danny Y. Chou", "Associate", "Five"),
  coa("Mark Simons", "Associate", "Five"),
  coa("Gordon Burns", "Associate", "Five"),
  office("California Superintendent of Public Instruction", "us/ca"),
  measure("California — Proposition 1 (Housing bonds)", "us/ca", "1"),
  measure("California — Proposition 2 (Rainy day fund)", "us/ca", "2"),
  measure("California — Proposition 37 (Home loans)", "us/ca", "37"),
  {
    ...measure("Bay Area — Regional Measure RTM (Regional Transit Measure)", "us/ca/bay-area", ""),
    ballot: { heading: "Regional Transit Measure" },
    votedIn: [
      "us/ca/alameda-county",
      "us/ca/contra-costa-county",
      "us/ca/san-mateo-county",
      "us/ca/santa-clara-county",
      "us/ca/sf",
    ],
  },
  measure(
    "San Mateo County Community College District — Measure V (Bond Measure)",
    "us/ca/san-mateo-county",
    "V",
    { district: "us/ca/ccd-370" },
  ),
  measure("San Mateo County — Measure L (Extreme Weather Events)", "us/ca/san-mateo-county", "L"),
  measure("San Mateo County — Measure AA (Affirmation of Rights)", "us/ca/san-mateo-county", "AA"),
  measure(
    "San Mateo County — Measure J (Special Election or Appoint)",
    "us/ca/san-mateo-county",
    "J",
  ),
  measure("San Mateo County — Measure U (Reapportionment)", "us/ca/san-mateo-county", "U"),
] satisfies SequencedRace[];

const titles = (races: SequencedRace[]) => races.map((r) => r.subject.title);

describe("compareBallotOrder", () => {
  test("puts a San Mateo County ballot in the order it printed", () => {
    // Reversed, then by title: nothing rides on the input order.
    for (const input of [
      [...PRINTED].reverse(),
      [...PRINTED].sort((a, b) => a.subject.title.localeCompare(b.subject.title)),
    ]) {
      const sorted = input.sort((a, b) => compareBallotOrder(a, b, sanMateo));
      expect(titles(sorted)).toEqual(titles(PRINTED));
    }
  });

  test("heads each part as the paper ballot does", () => {
    const sections = ballotSections(PRINTED);
    expect(sections.map((s) => [s.label, s.races.length])).toEqual([
      ["State offices", 1],
      ["Congress and Legislature", 2],
      ["Judges", 13],
      ["School", 1],
      ["State measures", 3],
      ["Regional measures", 1],
      ["School measures", 1],
      ["County measures", 4],
    ]);
  });

  test("without the county's own order, measures go by letter, A to Z, then AA", () => {
    const elsewhere: Area = { localities: ["us/ca/marin-county"], districts: {} };
    const races = [
      measure("Marin County — Measure AA", "us/ca/marin-county", "AA"),
      measure("Marin County — Measure B", "us/ca/marin-county", "B"),
      measure("Marin County — Measure A", "us/ca/marin-county", "A"),
    ].sort((a, b) => compareBallotOrder(a, b, elsewhere));
    expect(races.map((r) => r.ballot.number)).toEqual(["A", "B", "AA"]);
  });

  test("local offices: school, county, city, then special districts", () => {
    const races = [
      office("Water District Director", "us/ca/marin-county", {
        district: "us/ca/marin-county/mmwd-2",
      }),
      office("San Rafael City Council", "us/ca/san-rafael"),
      office("Marin County Board of Supervisors, District 1", "us/ca/marin-county", {
        district: "us/ca/marin-county/sup-1",
      }),
      office("Tamalpais Union High School District Board", "us/ca/marin-county", {
        district: "us/ca/scsd-38800",
      }),
      office("San Rafael Mayor", "us/ca/san-rafael"),
    ];
    expect(races.map(ballotPart)).toEqual(["district", "city", "county", "school", "city"]);
    expect(titles(races.sort((a, b) => compareBallotOrder(a, b)))).toEqual([
      "Tamalpais Union High School District Board",
      "Marin County Board of Supervisors, District 1",
      "San Rafael Mayor",
      "San Rafael City Council",
      "Water District Director",
    ]);
  });

  test("statewide offices in the Elections Code's order, then the Legislature", () => {
    const races = [
      office("California State Senate, District 12", "us/ca/sd-12"),
      office("California Controller", "us/ca"),
      office("California State Board of Equalization, District 1", "us/ca"),
      office("Lieutenant Governor of California", "us/ca"),
      office("Governor of California", "us/ca"),
    ];
    expect(titles(races.sort((a, b) => compareBallotOrder(a, b)))).toEqual([
      "Governor of California",
      "Lieutenant Governor of California",
      "California Controller",
      "California State Board of Equalization, District 1",
      "California State Senate, District 12",
    ]);
  });
});
