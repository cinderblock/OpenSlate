import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type ContestOffice, contestOffice, isStatewideMeasureTitle } from "../src/contestOffice";
import { measureSide } from "../src/countyResults";

/**
 * Contest titles as the states' election offices published them for the
 * 2026-11-03 general (read 2026-11-10; plans/national-scale.md).
 */

const office = (title: string, hints = {}) => contestOffice(title, hints);

describe("the offices every state elects, however it words them", () => {
  test("the US Senate", () => {
    for (const title of [
      "United States Senator",
      "US Senate",
      "U.S.  Senate",
      "U.S. SENATOR",
      "U. S. SENATOR ",
      "U. S. Senator",
      "Senator in Congress",
      "Member, United States Senate",
      "UNITED STATES SENATOR 6 YEAR TERM (1) POSITION",
      "US SENATE (VOTE FOR 1)",
      "For United States Senator - 6  Year Term",
      "United States Senate",
    ]) {
      expect(office(title)).toEqual({ kind: "us-senate" });
    }
  });

  test("the US House, with its district", () => {
    const cases: [string, string][] = [
      ["U.S. Representative in Congress - District No. 1", "1"],
      ["US House of Representatives - District 7", "7"],
      ["United States Representative District 2", "2"],
      ["Representative in Congress District 1", "1"],
      ["U.S. House District 4", "4"],
      ["Congressional District 10 - U.S. Representative", "10"],
      ["Representative to the 120th United States Congress - District 8", "8"],
      ["U.S.  House of Representatives, District  6", "6"],
      ["U.S. HOUSE OF REPRESENTATIVES, 2nd Congressional District", "2"],
      ["UNITED STATES REPRESENTATIVE, 1ST CONGRESSIONAL DISTRICT", "1"],
      ["U.S. Congress District 01", "1"],
      ["Representative in Congress 5", "5"],
      ["Representative in Congress, District 28", "28"],
      ["U.S. Representative, Dist II", "2"],
      ["United States Representative, First District", "1"],
      ["United States Representative, Ninth District", "9"],
      ["United States House of Representatives 3", "3"],
      ["U. S. Representative -- 1st Congressional District", "1"],
      ["1ST DISTRICT REPRESENTATIVE IN CONGRESS 2 YEAR TERM (1) POSITION", "1"],
      ["13TH DISTRICT REPRESENTATIVE IN CONGRESS 2 YEAR TERM (1) POSITION", "13"],
      ["UNITED STATES REPRESENTATIVE 2ND CONGRESSIONAL", "2"],
      ["US HOUSE OF REPRESENTATIVES DISTRICT 01 (VOTE FOR 1)", "1"],
      ["Representative In Congress, District 3", "3"],
      ["Representative to Congress - District 15", "15"],
      ["Representative in Congress / 1st Congressional District", "1"],
      ["U. S. REPRESENTATIVE DISTRICT 38", "38"],
      ["United States House of Representatives District 9", "9"],
    ];
    for (const [title, district] of cases) {
      expect([title, office(title)]).toEqual([title, { kind: "us-house", district }]);
    }
  });

  test("a state with one seat prints no district: it is district 1", () => {
    for (const title of [
      "U.S. Representative",
      "Representative In Congress",
      "Representative in Congress",
      "REPRESENTATIVE TO CONGRESS",
      "United States Representative",
      "DELEGATE TO THE HOUSE OF REPRESENTATIVES FROM THE DISTRICT OF COLUMBIA",
    ]) {
      expect(office(title)).toEqual({ kind: "us-house", district: "1" });
    }
  });

  test("Virginia's House of Representatives is Congress; a state's own isn't", () => {
    const title = "Member, House of Representatives (1st District)";
    expect(office(title, { bareHouseIsCongress: true })).toEqual({
      kind: "us-house",
      district: "1",
    });
    expect(office(title)).toEqual({ kind: "state-lower", district: "1" });
    expect(
      office("State House of Representatives - District 96", { bareHouseIsCongress: true }),
    ).toEqual({ kind: "state-lower", district: "96" });
  });

  test("the governor, alone or on a ticket; not the lieutenant governor alone", () => {
    for (const title of [
      "Governor",
      "GOVERNOR",
      "Governor and Lieutenant Governor",
      "Governor / Lieutenant Governor",
      "Governor / Lt. Governor",
      "Governor and Lt. Governor",
      "Governor & Lt Governor",
      "For Governor and Lt. Governor",
      "GOVERNOR AND LIEUTENANT GOVERNOR 4 YEAR TERM (1) POSITION",
    ]) {
      expect(office(title)).toEqual({ kind: "governor" });
    }
    expect(office("Lieutenant Governor")).toEqual({ kind: "statewide-office" });
  });

  test("the other statewide offices", () => {
    for (const title of [
      "Secretary of State",
      "Attorney General",
      "State Treasurer",
      "Treasurer of State",
      "General Treasurer",
      "Auditor of State",
      "State Controller",
      "Comptroller General",
      "Superintendent of Public Instruction",
      "State School Superintendent",
      "State Superintendent of Education",
      "Commissioner of Agriculture",
      "Commissioner of Insurance",
      "Commissioner of Labor",
      "Secretary of Agriculture",
      "Corporation Commissioner",
      "State Mine Inspector",
    ]) {
      expect([title, office(title).kind]).toEqual([title, "statewide-office"]);
    }
  });

  test("the legislature's upper chamber", () => {
    const cases: [string, ContestOffice][] = [
      ["State Senator - District No.  1", { kind: "state-upper", district: "1" }],
      [
        "State Senate - District 5/ Senador Estatal del Distrito 5",
        { kind: "state-upper", district: "5" },
      ],
      ["State Senator District 35", { kind: "state-upper", district: "35" }],
      ["Senator in General Assembly District 12", { kind: "state-upper", district: "12" }],
      ["State Senate District 1 (Multi-County)", { kind: "state-upper", district: "1" }],
      ["Legislative District 6 - State Senator", { kind: "state-upper", district: "6" }],
      ["State Senator - District 21", { kind: "state-upper", district: "21" }],
      ["STATE SENATOR, 17th Senatorial District", { kind: "state-upper", district: "17" }],
      ["Senate District A", { kind: "state-upper", district: "a" }],
      ["Senate District 3", { kind: "state-upper", district: "3" }],
      ["State Senate District 01", { kind: "state-upper", district: "1" }],
      ["State Senator 36", { kind: "state-upper", district: "36" }],
      ["State Senator, Dist 9", { kind: "state-upper", district: "9" }],
      ["State Senator, District 04", { kind: "state-upper", district: "4" }],
      ["Kansas Senate 25", { kind: "state-upper", district: "25" }],
      ["Tennessee Senate District 3", { kind: "state-upper", district: "3" }],
      ["NC STATE SENATE DISTRICT 02 (VOTE FOR 1)", { kind: "state-upper", district: "2" }],
      [
        "1ST DISTRICT STATE SENATOR 4 YEAR TERM (1) POSITION",
        { kind: "state-upper", district: "1" },
      ],
      ["State Senate, District 8", { kind: "state-upper", district: "8" }],
      [
        "Senator in the General Assembly / 2nd Senatorial District",
        { kind: "state-upper", district: "2" },
      ],
      ["STATE SENATOR, DISTRICT 11", { kind: "state-upper", district: "11" }],
      ["STATE SENATOR DISTRICT 14", { kind: "state-upper", district: "14" }],
      // A special election, beside the regular one for the seat.
      [
        "STATE SENATOR, 3rd Senatorial District - UNEXPIRED TERM",
        { kind: "state-upper", district: "3", special: true },
      ],
      [
        "State Senate District 15 (Unexpired Term)",
        { kind: "state-upper", district: "15", special: true },
      ],
    ];
    for (const [title, expected] of cases)
      expect([title, office(title)]).toEqual([title, expected]);
  });

  test("the lower chamber, with a seat where a district has several", () => {
    const cases: [string, ContestOffice][] = [
      ["State Representative - District No. 10", { kind: "state-lower", district: "10" }],
      ["State House of Representatives - District 180", { kind: "state-lower", district: "180" }],
      ["State Representative District 1 Seat A", { kind: "state-lower", district: "1", seat: "a" }],
      [
        "Legislative District 1 - State Representative Pos. 2",
        { kind: "state-lower", district: "1", seat: "2" },
      ],
      ["Representative in General Assembly District 10", { kind: "state-lower", district: "10" }],
      ["State House District 2", { kind: "state-lower", district: "2" }],
      ["HOUSE OF DELEGATES, 4th District", { kind: "state-lower", district: "4" }],
      ["Member, House of Delegates (20th District)", { kind: "state-lower", district: "20" }],
      ["State  House of Representatives, District  1", { kind: "state-lower", district: "1" }],
      ["House District 40", { kind: "state-lower", district: "40" }],
      ["State Representative District 1A", { kind: "state-lower", district: "1a" }],
      ["State Representative 151", { kind: "state-lower", district: "151" }],
      ["State Representative, District 001", { kind: "state-lower", district: "1" }],
      ["State Assembly, District 42", { kind: "state-lower", district: "42" }],
      ["Kansas House of Representatives 2", { kind: "state-lower", district: "2" }],
      [
        "NC HOUSE OF REPRESENTATIVES DISTRICT 001 (VOTE FOR 1)",
        { kind: "state-lower", district: "1" },
      ],
      [
        "1ST DISTRICT REPRESENTATIVE IN STATE LEGISLATURE 2 YEAR TERM (1) POSITION",
        { kind: "state-lower", district: "1" },
      ],
      [
        "Representative in the General Assembly / 1st Legislative District",
        { kind: "state-lower", district: "1" },
      ],
      [
        "State Representative --  92nd Representative District",
        { kind: "state-lower", district: "92" },
      ],
      ["Tennessee House of Representatives District 98", { kind: "state-lower", district: "98" }],
    ];
    for (const [title, expected] of cases)
      expect([title, office(title)]).toEqual([title, expected]);
  });

  test("an office that only names a district isn't a legislator's", () => {
    for (const title of [
      "State Board of Education Member - Congressional District 1",
      "Regent of the University of Colorado - Congressional District 2",
      "State School Board District 1 (Multi-County)",
      "District Attorney - Atlantic Judicial Circuit (Special Primary)",
      "District Court Judge - 1st Judicial District - Contiguglia",
      "Supreme Court - Justice Position #01",
      "PSC - District 3",
      "Barrington: Town Council",
      "Coventry: Non-Partisan Town Council District 1",
      "Regional Transportation District Director - District B",
      "Mayor - Farmville (Town of Farmville)",
      "College of Southern Idaho Trustee Zone 1",
      "For Public Service Commissioner - 6 Year Term District 02",
      "GOVERNOR OF WAYNE STATE UNIVERSITY",
      "REGENT OF THE UNIVERSITY OF MICHIGAN",
    ]) {
      expect([title, office(title)]).toEqual([title, { kind: "other" }]);
    }
  });
});

describe("every contest of eleven states' counts", () => {
  const titles = JSON.parse(
    readFileSync(join(import.meta.dir, "fixtures/state/titles-2026-11-03.json"), "utf8"),
  ) as Record<string, [string, 0 | 1][]>;

  /** How many distinct districts (and seats) of each chamber a state's count has, specials aside. */
  function seats(code: string, hints = {}) {
    const found: Record<string, Set<string>> = {};
    for (const [title, measure] of titles[code] ?? []) {
      if (measure) continue;
      const o = contestOffice(title, hints);
      if (!o.district || o.special) continue;
      const set = found[o.kind] ?? new Set<string>();
      found[o.kind] = set;
      set.add(`${o.district}${o.seat ? `/${o.seat}` : ""}`);
    }
    return Object.fromEntries(Object.entries(found).map(([kind, set]) => [kind, set.size]));
  }

  test("the seats each state was electing, no more and no fewer", () => {
    // Arizona: 9 in Congress, 30 legislative districts (two representatives each, one contest).
    expect(seats("az")).toEqual({ "us-house": 9, "state-upper": 30, "state-lower": 30 });
    expect(seats("ga")).toEqual({ "us-house": 14, "state-upper": 56, "state-lower": 180 });
    // Idaho: two House seats a district, each its own contest.
    expect(seats("id")).toEqual({ "us-house": 2, "state-upper": 35, "state-lower": 70 });
    expect(seats("ri")).toEqual({ "us-house": 2, "state-upper": 38, "state-lower": 75 });
    expect(seats("ut")).toEqual({ "us-house": 4, "state-upper": 15, "state-lower": 75 });
    // Virginia elects its legislature in odd years: one House of Delegates seat was filled.
    expect(seats("va", { bareHouseIsCongress: true })).toEqual({
      "us-house": 11,
      "state-lower": 1,
    });
    // Washington: two House positions a district.
    expect(seats("wa")).toEqual({ "us-house": 10, "state-upper": 24, "state-lower": 98 });
    expect(seats("co")).toEqual({ "us-house": 8, "state-upper": 21, "state-lower": 65 });
    expect(seats("ia")).toEqual({ "us-house": 4, "state-upper": 25, "state-lower": 100 });
    // South Carolina's Senate wasn't up (one special, not counted here).
    expect(seats("sc")).toEqual({ "us-house": 7, "state-lower": 124 });
    expect(seats("wv", { bareHouseIsCongress: true })).toEqual({
      "us-house": 2,
      "state-upper": 17,
      "state-lower": 100,
    });
    // The district is a column of its own in these three states' exports; the title has it joined on.
    // South Dakota: one House seat, 35 Senate districts, 37 House districts (26A, 26B, 28A, 28B).
    expect(seats("sd")).toEqual({ "us-house": 1, "state-upper": 35, "state-lower": 37 });
    // Nebraska's one chamber, half of it up.
    expect(seats("ne")).toEqual({ "us-house": 3, "state-upper": 25 });
    expect(seats("nc")).toEqual({ "us-house": 14, "state-upper": 50, "state-lower": 120 });
    // Minnesota's House districts are a Senate district's halves: 1A, 1B.
    expect(seats("mn")).toEqual({ "us-house": 8, "state-upper": 67, "state-lower": 134 });
    expect(seats("pa")).toEqual({ "us-house": 17, "state-upper": 25, "state-lower": 203 });
    expect(seats("mi")).toEqual({ "us-house": 13, "state-upper": 38, "state-lower": 110 });
    // Texas: 38 in Congress, half the Senate, the whole House.
    expect(seats("tx")).toEqual({ "us-house": 38, "state-upper": 16, "state-lower": 150 });
    // New Mexico's Senate wasn't up: one seat was filled.
    expect(seats("nm")).toEqual({ "us-house": 3, "state-upper": 1, "state-lower": 70 });
  });

  test("one Senate race and one governor's at most, and no town's race among the state's", () => {
    for (const [code, rows] of Object.entries(titles)) {
      const kinds = rows
        .filter(([, measure]) => !measure)
        .map(([title]) => contestOffice(title, { bareHouseIsCongress: code === "va" }).kind);
      expect([code, kinds.filter((k) => k === "us-senate").length <= 1]).toEqual([code, true]);
      expect([code, kinds.filter((k) => k === "governor").length <= 1]).toEqual([code, true]);
    }
  });
});

describe("a measure", () => {
  test("its sides, however the office words them", () => {
    for (const yes of [
      "Yes",
      "YES",
      "Bonds Yes",
      "Bonds - Yes",
      "Levy Yes",
      "Be Retained Yes",
      "Yes/For",
      "For",
      "Approve",
      "Approved",
      "Yes, in favor of the question",
    ]) {
      expect([yes, measureSide(yes)]).toEqual([yes, "yes"]);
    }
    for (const no of [
      "No",
      "Bonds - No",
      "Levy No",
      "Be Retained No",
      "No/Against",
      "Against",
      "Reject",
      "Rejected",
      "No, opposed to the question",
    ]) {
      expect([no, measureSide(no)]).toEqual([no, "no"]);
    }
    for (const person of [
      "No Candidate Filed",
      "Yesenia Lopez",
      "Noah Smith",
      "Write-in",
      "Ford",
    ]) {
      expect([person, measureSide(person)]).toEqual([person, undefined]);
    }
  });

  test("one the whole state votes on, by its title", () => {
    for (const title of [
      "PROPOSITION 141",
      "Proposed Constitutional Amendment 1",
      "Proposed Constitutional Amendment Question 1",
      "Idaho Constitutional Amendment: House Joint Resolution 4",
      "Proposition 1: Reproductive Freedom & Privacy Act",
      "Advisory Question: House Bill 932",
      "Constitutional Amendment A",
      "Initiative Measure No. IP26-645",
      "Amendment 81 (CONSTITUTIONAL)",
      "Constitutional Amendment 1",
      "AMENDMENT NO 1: CITIZENSHIP REQUIREMENT TO VOTE IN WEST VIRGINIA ELECTIONS AMENDMENT",
      "State Issue 3 To require voters to present photo identification in order to vote",
      "Statewide Ballot Question No. 6",
      "Question 1: Constitutional Amendment",
      "CI-132 CONSTITUTIONAL INITIATIVE NO. 132",
      "Public Question #1",
      "ISSUE NO. 1",
    ]) {
      expect([title, isStatewideMeasureTitle(title)]).toEqual([title, true]);
    }
    for (const title of [
      "City of Bothell - Proposition No. 1",
      "Public Hospital District No. 1 - Public Hospital District No. 1, Proposition 1",
      "Auburn School District No. 408 - Proposition No. 1",
      "City of Cedar Rapids - Public Measure D",
      "American Falls Joint School District Supplemental Levy",
      "Spartanburg County School District 2 Referendum-Question 1",
      "Town of Irmo Form of Government Referendum",
    ]) {
      expect([title, isStatewideMeasureTitle(title)]).toEqual([title, false]);
    }
  });
});
