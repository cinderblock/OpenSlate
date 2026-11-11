import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { CountyContest } from "../src/countyResults";
import {
  parseStateFeed,
  STATE_FEEDS,
  type StateFeed,
  stateFeed,
  stateFeedPathTtl,
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
