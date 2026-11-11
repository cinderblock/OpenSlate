import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CountyContest } from "../src/countyResults";
import {
  parseStateFeed,
  parseStateFiles,
  STATE_FEEDS,
  type StateFeed,
  stateFeed,
  stateFeedPathTtl,
  stateFeedUrl,
  texasTime,
  UNREACHED_STATE_FEEDS,
} from "../src/stateResults";

/**
 * States' feeds, cut from what each published for the 2026-11-03 general
 * (fetched 2026-11-10). The Enhanced Voting fixtures keep whole contests but
 * only the fields the parser reads; the Clarity ones are the state's own
 * bytes, a few contests each.
 */

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(import.meta.dir, "fixtures/state", name), "utf8"));
const feedOf = (code: string): StateFeed => {
  const feed = stateFeed(code);
  if (!feed) throw new Error(`no feed for ${code}`);
  return feed;
};
const read = (code: string, kind: "data" | "summary") =>
  parseStateFeed(feedOf(code), fixture(`${code}-${kind}.json`));
const named = (contests: CountyContest[], title: string): CountyContest => {
  const hit = contests.find((c) => c.title === title);
  if (!hit)
    throw new Error(`no contest "${title}" among ${contests.map((c) => c.title).join("; ")}`);
  return hit;
};

describe("the registry", () => {
  test("a state by its postal code, in either case; nothing for a state not read", () => {
    expect(stateFeed("va")?.office).toBe("Virginia Department of Elections");
    expect(stateFeed("VA")?.name).toBe("Virginia");
    expect(stateFeed("ca")).toBeUndefined();
    expect(stateFeed("constructor")).toBeUndefined();
    expect(stateFeed(undefined)).toBeUndefined();
  });

  test("every feed is https, says who counts and what its reporting counts", () => {
    for (const [code, feed] of Object.entries(STATE_FEEDS)) {
      expect([code, /^[a-z]{2}$/.test(code)]).toEqual([code, true]);
      expect(feed.base.startsWith("https://")).toBe(true);
      expect(feed.base.endsWith("/")).toBe(false);
      expect(feed.page.startsWith("https://")).toBe(true);
      expect(feed.office.length).toBeGreaterThan(feed.name.length);
      expect(feed.election).toBe("2026-11-03");
      expect(feed.units).toMatch(/^[a-z ]+$/);
    }
  });

  test("only the files a feed is made of may be asked for", () => {
    const virginia = feedOf("va");
    expect(stateFeedPathTtl(virginia, "data")).toBe(60);
    expect(stateFeedPathTtl(virginia, "current_ver.txt")).toBeNull();
    expect(stateFeedPathTtl(virginia, "../../jurisdictions/virginia")).toBeNull();
    const colorado = feedOf("co");
    expect(stateFeedPathTtl(colorado, "current_ver.txt")).toBe(60);
    // A versioned file never changes.
    expect(stateFeedPathTtl(colorado, "386671/json/en/summary.json")).toBe(3600);
    expect(stateFeedPathTtl(colorado, "386671/json/en/electionsettings.json")).toBeNull();
    expect(stateFeedPathTtl(colorado, "data")).toBeNull();
  });
});

describe("Enhanced Voting, as states run it", () => {
  test("Virginia: when the count was published, and that it isn't official yet", () => {
    const count = read("va", "data");
    expect(count.asOf).toBe(Date.parse("2026-11-10T23:10:33.124623Z"));
    expect(count.official).toBe(false);
    expect(count.contests.map((c) => c.title)).toEqual([
      "Member, United States Senate",
      "Member, House of Representatives (1st District)",
      "Member, House of Representatives (11th District)",
      "Member, House of Delegates (20th District)",
      "Mayor - Farmville (Town of Farmville)",
      "Proposed Constitutional Amendment Question 1",
    ]);
  });

  test("Virginia: a contest's choices, the English name of several languages", () => {
    const senate = named(read("va", "data").contests, "Member, United States Senate");
    expect(senate.measure).toBe(false);
    // "Vote for only one", in words.
    expect(senate.voteFor).toBe(1);
    // Units are localities: every county and independent city.
    expect(senate.precincts).toEqual({ total: 133, reporting: 133 });
    expect(senate.choices[0]).toEqual({
      name: "Mark R. Warner",
      party: "D",
      votes: 2216084,
      percent: expect.any(Number),
    });
    const total = senate.choices.reduce((sum, c) => sum + c.percent, 0);
    expect(Math.abs(total - 100)).toBeLessThan(0.1);
    const amendment = named(
      read("va", "data").contests,
      "Proposed Constitutional Amendment Question 1",
    );
    expect(amendment.measure).toBe(true);
    expect(amendment.choices.map((c) => c.name)).toEqual(["Yes", "No"]);
  });

  test("Georgia: the party and the incumbent's mark come out of the name", () => {
    const { contests } = read("ga", "data");
    const senate = named(contests, "US Senate");
    expect(senate.choices.map((c) => [c.name, c.party, c.incumbent ?? false])).toEqual([
      ["Mike Collins", "Rep", false],
      ["Jon Ossoff", "Dem", true],
    ]);
    // A title with its Spanish beside it is kept whole; the district is read from it.
    expect(
      named(contests, "State Senate - District 5/ Senador Estatal del Distrito 5").choices.length,
    ).toBeGreaterThan(0);
  });

  test("Rhode Island: a question is approved or rejected, and says which group it's in", () => {
    const { contests } = read("ri", "data");
    const question = named(contests, "1. HIGHER EDUCATION FACILITIES - $275,000,000");
    expect(question.measure).toBe(true);
    expect(question.category).toBe("State Questions");
    expect(question.choices.map((c) => c.name).sort()).toEqual(["Approve", "Reject"]);
    expect(named(contests, "Senator in Congress").category).toBe("Federal");
    expect(named(contests, "Senator in Congress").choices[0]?.name).toBe("John F. Reed");
  });

  test("Utah: a party by its whole name, an amendment voted for or against", () => {
    const { contests } = read("ut", "data");
    const house = named(contests, "U.S. House District 1");
    expect(house.choices.map((c) => c.party)).toContain("Democratic");
    const amendment = named(contests, "Constitutional Amendment A");
    expect(amendment.measure).toBe(true);
    expect(amendment.choices.map((c) => c.name).sort()).toEqual(["AGAINST", "FOR"]);
  });

  test("Arizona: a ticket keeps both names and their parties; a judge is retained or not", () => {
    const { contests } = read("az", "data");
    const governor = named(contests, "Governor and Lieutenant Governor");
    expect(governor.choices[0]?.name).toMatch(/^.+ \([A-Z]+\) \/ .+ \([A-Z]+\)$/);
    // The feed prints two spaces before a one-digit district.
    expect(named(contests, "State Senator - District No. 1").measure).toBe(false);
    const justice = named(
      contests,
      "Shall Justice John Lopez IV, Justice of the Supreme Court be retained in office?",
    );
    expect(justice.measure).toBe(true);
  });
});

describe("TotalVote's CSV exports", () => {
  const text = (name: string) =>
    readFileSync(join(import.meta.dir, "fixtures/state", name), "utf8");

  test("only a feed's named files may be asked for, and each is a query on the state's site", () => {
    const south = feedOf("sd");
    expect(stateFeedPathTtl(south, "legislature")).toBe(60);
    expect(stateFeedPathTtl(south, "resultsCSV.aspx")).toBeNull();
    expect(stateFeedPathTtl(south, "data")).toBeNull();
    expect(stateFeedPathTtl(south, "constructor")).toBeNull();
    expect(stateFeedUrl(south, "legislature")).toBe(
      "https://electionresults.sd.gov/resultsCSV.aspx?text=All&type=LEG&map=DIST",
    );
    expect(stateFeedUrl(feedOf("va"), "data")).toBe(
      "https://enr.elections.virginia.gov/results/public/api/elections/virginia/2026-November-General/data",
    );
  });

  test("South Dakota: three exports, one count; the district joins the title", () => {
    const { contests, asOf } = parseStateFiles(feedOf("sd"), {
      statewide: text("sd-statewide.csv"),
      questions: text("sd-questions.csv"),
      legislature: text("sd-legislature.csv"),
    });
    // The export's clock is the server's, not the count's.
    expect(asOf).toBeUndefined();
    expect(contests).toHaveLength(85);
    const senate = named(contests, "United States Senator");
    expect(senate.choices).toEqual([
      { name: "Mike Rounds", party: "REP", votes: 184589, percent: 60.5 },
      { name: "Brian L Bengs", party: "IND", votes: 120513, percent: 39.5 },
    ]);
    // `="671/671"`, as Excel would want it.
    expect(senate.precincts).toEqual({ total: 671, reporting: 671 });
    expect(named(contests, "State Senator District 01").voteFor).toBe(1);
    // A two-member House district is one contest.
    expect(named(contests, "State Representative District 01").voteFor).toBe(2);
    expect(contests.map((c) => c.title)).toContain("State Representative District 26A");
    const amendment = contests.find((c) => c.title.startsWith("Constitutional Amendment I:"));
    expect(amendment?.measure).toBe(true);
    expect(amendment?.choices.map((c) => c.name).sort()).toEqual(["No", "Yes"]);
  });

  test("Nebraska: every contest in one export, the same race name for every district", () => {
    const { contests } = parseStateFiles(feedOf("ne"), { all: text("ne-all.csv") });
    expect(contests.map((c) => c.title)).toEqual(
      expect.arrayContaining([
        "For United States Senator - 6 Year Term",
        "For Governor and Lt. Governor",
        "For Representative in Congress - 2 Year Term District 01",
        "For Representative in Congress - 2 Year Term District 02",
        "For Member of the Legislature District 02",
        "Proposed Amendment No. 1",
      ]),
    );
    expect(named(contests, "Proposed Amendment No. 1").measure).toBe(true);
  });

  test("New Mexico: columns in another order, read by name", () => {
    const { contests } = parseStateFiles(feedOf("nm"), { state: text("nm-state.csv") });
    const senate = named(contests, "United States Senator");
    expect(senate.choices.map((c) => [c.name, c.party, c.votes])).toEqual([
      ["LARRY E MARKER", "REP", 266434],
      ["BEN R LUJAN", "DEM", 458756],
    ]);
    expect(senate.precincts).toEqual({ total: 2204, reporting: 2204 });
    expect(contests.map((c) => c.title)).toContain("United States Representative DISTRICT 1");
    expect(contests.map((c) => c.title)).toContain("State Representative DISTRICT 2");
  });

  test("something that isn't an export says so", () => {
    expect(() => parseStateFiles(feedOf("sd"), { statewide: "<html>Error</html>" })).toThrow(
      "not a results export",
    );
    expect(() => parseStateFiles(feedOf("va"), {})).toThrow("isn't read from named files");
    expect(() => parseStateFeed(feedOf("sd"), {})).toThrow("isn't one document");
  });
});

describe("states with a format of their own", () => {
  const text = (name: string) =>
    readFileSync(join(import.meta.dir, "fixtures/state", name), "utf8");

  test("North Carolina: a row per candidate, every value a string", () => {
    const north = feedOf("nc");
    expect(stateFeedUrl(north, "results")).toBe(
      "https://er.ncsbe.gov/enr/20261103/data/results_0.txt",
    );
    const { contests } = parseStateFiles(north, { results: text("nc-results.json") });
    expect(contests.map((c) => c.title)).toEqual([
      "US SENATE",
      "US HOUSE OF REPRESENTATIVES DISTRICT 01",
      "NC STATE SENATE DISTRICT 02",
      "NC HOUSE OF REPRESENTATIVES DISTRICT 001",
      "CONSTITUTIONAL AMENDMENT - REQUIRE PHOTO ID FOR VOTING",
      "TOWN OF GRIFTON MIXED BEVERAGE ELECTION",
    ]);
    const senate = named(contests, "US SENATE");
    expect(senate.choices[0]).toEqual({
      name: "Roy Cooper",
      party: "DEM",
      votes: 2477264,
      percent: 58.74,
    });
    expect(senate.voteFor).toBe(1);
    expect(senate.precincts).toEqual({ total: 2626, reporting: 2626 });
    const amendment = named(contests, "CONSTITUTIONAL AMENDMENT - REQUIRE PHOTO ID FOR VOTING");
    expect(amendment.measure).toBe(true);
    // A space for no party isn't a party.
    expect(amendment.choices.map((c) => [c.name, c.party])).toEqual([
      ["For", undefined],
      ["Against", undefined],
    ]);
    expect(() => parseStateFiles(north, { results: "{}" })).toThrow("not a results list");
  });

  test("Texas: sections of base64, an incumbent's mark, and Texas's clock", () => {
    const texas = feedOf("tx");
    expect(stateFeedUrl(texas, "election")).toBe(
      "https://goelect.txelections.civixapps.com/api-ivis-system/api/s3/enr/election/53815",
    );
    const { contests, asOf } = parseStateFiles(texas, { election: text("tx-election.json") });
    // "Nov 04, 2026 22:48:37" in Austin is 04:48:37 the next day in UTC (standard time).
    expect(asOf).toBe(Date.parse("2026-11-05T04:48:37Z"));
    expect(texasTime("Jul 04, 2026 12:00:00")).toBe(Date.parse("2026-07-04T17:00:00Z"));
    expect(texasTime("soon")).toBeUndefined();
    const governor = named(contests, "GOVERNOR");
    expect(governor.category).toBe("Statewide");
    const abbott = governor.choices.find((c) => c.name === "GREG ABBOTT");
    expect(abbott).toMatchObject({ party: "REP", votes: 4524527, incumbent: true });
    // A declared write-in has no party.
    expect(governor.choices.find((c) => c.name === "EDWARD EARL GILES")?.party).toBeUndefined();
    // The feed's stray spaces are closed up.
    expect(contests.map((c) => c.title)).toContain("U. S. SENATOR");
    expect(named(contests, "STATE SENATOR, DISTRICT 1").category).toBe("Districts");
    // No race in this feed says how much of it has reported.
    expect(governor.precincts).toBeUndefined();
    expect(() => parseStateFiles(texas, { election: "{}" })).toThrow("not an election document");
  });
});

describe("Minnesota, Pennsylvania and Michigan", () => {
  const text = (name: string) =>
    readFileSync(join(import.meta.dir, "fixtures/state", name), "utf8");

  test("Minnesota: a file per office, semicolons, and an amendment's blank ballots left out", () => {
    // Read and parsed, but not offered: its host refuses the public relay.
    expect(stateFeed("mn")).toBeUndefined();
    const feed = UNREACHED_STATE_FEEDS.mn;
    if (!feed) throw new Error("no Minnesota feed");
    expect(stateFeedUrl(feed, "sthouse")).toBe(
      "https://electionresultsfiles.sos.mn.gov/20261103/LegislativeByDistrict.txt",
    );
    const texts = Object.fromEntries(
      Object.keys(feed.files ?? {}).map((name) => [name, text(`mn-${name}.txt`)]),
    );
    const { contests } = parseStateFiles(feed, texts);
    const house = named(contests, "U.S. Representative District 1");
    expect(house.choices).toEqual([
      { name: "Jake Johnson", party: "DFL", votes: 163055, percent: 49.99 },
      { name: "Brad Finstad", party: "R", votes: 162733, percent: 49.89 },
      // The write-in line has no party.
      { name: "WRITE-IN", votes: 391, percent: 0.12 },
    ]);
    expect(house.precincts).toEqual({ total: 750, reporting: 750 });
    expect(contests.map((c) => c.title)).toEqual(
      expect.arrayContaining([
        "U.S. Senator",
        "Governor & Lt Governor",
        "State Senator District 1",
        "State Representative District 1A",
        "State Representative District 1B",
      ]),
    );
    const amendment = named(contests, "CONSTITUTIONAL AMENDMENT 1");
    expect(amendment.measure).toBe(true);
    expect(amendment.choices.map((c) => [c.name, c.votes])).toEqual([
      ["YES", 2068204],
      ["NO", 666628],
    ]);
  });

  test("Pennsylvania: JSON inside a JSON string, office and district as words", () => {
    const feed = feedOf("pa");
    expect(stateFeedUrl(feed, "congress")).toBe(
      "https://www.electionreturns.pa.gov/api/ElectionReturn/GetOfficeData?officeId=11&methodName=GetOfficeDetails&electionid=117&electiontype=G&isactive=1",
    );
    const { contests } = parseStateFiles(feed, {
      governor: text("pa-governor.json"),
      congress: text("pa-congress.json"),
      senate: text("pa-senate.json"),
      house: text("pa-house.json"),
    });
    expect(contests.map((c) => c.title)).toEqual([
      "Governor",
      "Representative in Congress 1st Congressional District",
      "Representative in Congress 2nd Congressional District",
      "Senator in the General Assembly 2nd Senatorial District",
      "Senator in the General Assembly 4th Senatorial District",
      "Representative in the General Assembly 1st Legislative District",
      "Representative in the General Assembly 2nd Legislative District",
    ]);
    expect(named(contests, "Governor").choices[0]).toEqual({
      name: "JOSH SHAPIRO",
      party: "DEM",
      votes: 3019001,
      percent: 60.45,
    });
    expect(() => parseStateFiles(feed, { governor: '"{}"' })).toThrow("not an office's returns");
  });

  test("Michigan: every county's rows summed, the term and seats off the title", () => {
    const feed = feedOf("mi");
    const { contests } = parseStateFiles(feed, { results: text("mi-results.txt") });
    const senate = named(contests, "UNITED STATES SENATOR");
    expect(senate.category).toBe("Statewide");
    // Six counties of the file are in the fixture: their votes are added up.
    const rows = text("mi-results.txt")
      .split(/\r?\n/)
      .map((line) => line.split("\t"))
      .filter((row) => row[1] === "7");
    const total = rows.reduce((sum, row) => sum + Number(row[14]), 0);
    expect(new Set(rows.map((row) => row[4])).size).toBe(6);
    expect(senate.choices.reduce((sum, c) => sum + c.votes, 0)).toBe(total);
    expect(Math.abs(senate.choices.reduce((sum, c) => sum + c.percent, 0) - 100)).toBeLessThan(0.1);
    // A name is first, middle, last; a party is spelled out.
    expect(senate.choices.some((c) => / /.test(c.name) && c.party !== undefined)).toBe(true);
    expect(contests.map((c) => c.title)).toEqual(
      expect.arrayContaining([
        "GOVERNOR AND LIEUTENANT GOVERNOR",
        "1ST DISTRICT REPRESENTATIVE IN CONGRESS",
        "1ST DISTRICT STATE SENATOR",
        "1ST DISTRICT REPRESENTATIVE IN STATE LEGISLATURE",
        "PROPOSAL 2026-1",
      ]),
    );
    expect(named(contests, "PROPOSAL 2026-1").measure).toBe(true);
    expect(named(contests, "1ST DISTRICT REPRESENTATIVE IN CONGRESS").category).toBeUndefined();
    expect(() => parseStateFiles(feed, { results: "<html>" })).toThrow("not a results file");
  });
});

describe("TotalResults: names in one document, votes in others", () => {
  const text = (name: string) =>
    readFileSync(join(import.meta.dir, "fixtures/state", name), "utf8");
  const read = (code: string) => {
    const feed = feedOf(code);
    return parseStateFiles(
      feed,
      Object.fromEntries(
        Object.keys(feed.files ?? {}).map((name) => [name, text(`${code}-${name}.json`)]),
      ),
    );
  };

  test("the files are queries on the state's API", () => {
    expect(stateFeedUrl(feedOf("ar"), "senate")).toBe(
      "https://enr-results-api.totalresults.com/Contest/GetContestResults?cId=arkansas&electionID=11b07106-031e-4d7c-911a-d01fb473d6dd&contestType=State%20Senate",
    );
    expect(stateFeedUrl(feedOf("nd"), "names")).toBe(
      "https://api.resultsnd.sos.nd.gov/Contest/GetContestSearchList?cid=north-dakota&electionID=348",
    );
  });

  test("Arkansas: the party is written before the name; an issue is voted for or against", () => {
    const { contests, asOf, official } = read("ar");
    expect(asOf).toBe(Date.parse("2026-11-10T22:31:52.2059921Z"));
    expect(official).toBe(false);
    const house = named(contests, "U.S. Congress District 01");
    expect(house.choices.map((c) => [c.name, c.party])).toEqual([
      ["Terri Yarbrough Green", "DEM"],
      ["Rick Crawford", "REP"],
      ["Steve G. Parsons", "LIB"],
    ]);
    expect(house.precincts?.total).toBeGreaterThan(100);
    const issue = named(contests, "ISSUE NO. 3");
    expect(issue.measure).toBe(true);
    expect(issue.choices.map((c) => [c.name, c.party])).toEqual([
      ["FOR ISSUE NO. 3", undefined],
      ["AGAINST ISSUE NO. 3", undefined],
    ]);
    expect(contests.map((c) => c.title)).toContain("STATE SENATE DISTRICT 30");
  });

  test("North Dakota: a party code of its own, names with their stray spaces closed up", () => {
    const { contests } = read("nd");
    const commissioner = named(contests, "Agriculture Commissioner");
    expect(commissioner.choices.map((c) => [c.name, c.party])).toEqual([
      ["Doug Goehring", "REP"],
      ["Vern Thompson", "DEM"],
      ["write-in", undefined],
    ]);
    // Two to elect in a House district.
    expect(named(contests, "State Representative District 01").voteFor).toBe(2);
    const measure = contests.find((c) => c.title.startsWith("Constitutional Measure No. 1"));
    expect(measure?.measure).toBe(true);
  });

  test("a results document for a contest the names don't have is left out, and a bad one says so", () => {
    const feed = feedOf("nd");
    expect(() =>
      parseStateFiles(feed, { names: "{}", statewide: "{}", legislature: "{}" }),
    ).toThrow("no list of contests");
    expect(() =>
      parseStateFiles(feed, {
        names: text("nd-names.json"),
        statewide: "{}",
        legislature: text("nd-legislature.json"),
      }),
    ).toThrow("no results");
  });
});

describe("Clarity, as states run it", () => {
  test("Colorado: offices, and a measure voted Yes/For or No/Against", () => {
    const { contests, asOf } = read("co", "summary");
    // Clarity's summary carries no time of its own.
    expect(asOf).toBeUndefined();
    const senate = named(contests, "United States Senator");
    expect(senate.choices.slice(0, 2).map((c) => [c.name, c.party, c.votes])).toEqual([
      ["Mark Baisley", "REP", 934667],
      ["John Hickenlooper", "DEM", 1613055],
    ]);
    // Units are counties.
    expect(senate.precincts?.total).toBe(64);
    const amendment = named(contests, "Amendment 81 (CONSTITUTIONAL)");
    expect(amendment.measure).toBe(true);
    expect(amendment.choices.map((c) => c.name)).toEqual(["Yes/For", "No/Against"]);
  });

  test("South Carolina: the party before each name comes off, and a straight-party tally isn't a contest", () => {
    const { contests } = read("sc", "summary");
    expect(contests.map((c) => c.title)).not.toContain("STRAIGHT PARTY 1");
    const governor = named(contests, "Governor and Lieutenant Governor");
    expect(governor.choices.find((c) => c.party === "REP")?.name).toBe(
      "Alan Wilson / Mike Reichenbach",
    );
    // The feed's doubled spaces are closed up.
    expect(contests.map((c) => c.title)).toContain("U.S. House of Representatives, District 1");
  });

  test("West Virginia: an amendment voted for or against", () => {
    const amendment = named(
      read("wv", "summary").contests,
      "AMENDMENT NO 1: CITIZENSHIP REQUIREMENT TO VOTE IN WEST VIRGINIA ELECTIONS AMENDMENT",
    );
    expect(amendment.measure).toBe(true);
  });
});
