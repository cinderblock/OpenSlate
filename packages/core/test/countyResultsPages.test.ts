import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACVOTE_PAGE_PATH,
  CA_COUNTY_FEEDS,
  feedPathTtl,
  htmlText,
  isStateContest,
  lvtPagePath,
  parseAcvoteHtml,
  parseLvtHtml,
} from "../src/countyResults";

// Excerpts of the real pages, 2026-11-04 (see plans/county-results.md).
const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

test("San Joaquin's livevoterturnout page reads as contests, keyed by its race ids", () => {
  const { contests, asOf } = parseLvtHtml(fixture("lvt-page-san-joaquin.html"));
  // "11/4/2026 1:11:00 AM" is California's clock: 1:11 AM PST, 09:11Z.
  expect(asOf).toBe(Date.parse("2026-11-04T09:11:00Z"));
  expect(contests.map((c) => [c.key, c.title])).toEqual([
    ["1200", "Governor"],
    ["1405", "Congressional District 5"],
    ["2305", "Joshua Groban - For Associate Justice of the Supreme Court"],
    // The page doubles a space; titles come out single-spaced.
    ["3532", "City of Lodi Member, City Council District 1"],
    ["9001", "Proposition 1"],
    ["9115", "Measure T"],
  ]);
  const byKey = new Map(contests.map((c) => [c.key, c]));
  expect(byKey.get("3532")).toMatchObject({
    measure: false,
    voteFor: 1,
    choices: [
      { name: "MICHAEL CAROUBA", votes: 1922 },
      { name: "BRANDON SYWASSINK", votes: 1111 },
      { name: "DAWSON HAYRE", votes: 996 },
    ],
  });
  expect(byKey.get("3532")?.precincts).toBeUndefined();
  // A measure's NO row has the negative of its YES row's id.
  expect(byKey.get("9001")?.choices.map((c) => [c.name, c.votes, c.percent])).toEqual([
    ["YES", 66805, 57.11],
    ["NO", 50161, 42.89],
  ]);
  expect(byKey.get("9115")).toMatchObject({ measure: true, voteFor: 0 });
  expect(byKey.get("9115")?.choices.map((c) => c.name)).toEqual(["BONDS YES", "BONDS NO"]);
  const local = contests.filter((c) => !isStateContest(c)).map((c) => c.key);
  expect(local).toEqual(["2305", "3532", "9115"]);
});

test("Alameda's results page reads as contests: groups, precincts, seats, thresholds", () => {
  const { contests, asOf } = parseAcvoteHtml(fixture("acvote-alameda.html"));
  // "Wednesday, November 04, 2026; 2:07 AM": 2:07 AM PST, 10:07Z.
  expect(asOf).toBe(Date.parse("2026-11-04T10:07:00Z"));
  // Registration & Turnout isn't a contest; the propositions' shared table is one each.
  expect(contests.map((c) => [c.category, c.title])).toEqual([
    ["Federal", "U.S. Representative, 12th Congressional District"],
    ["State", "Proposition 1"],
    ["State", "Proposition 2"],
    ["Judicial", "Associate Justice of the Supreme Court - Joshua Groban"],
    ["City", "Members, City Council - Albany (RCV)"],
    ["City", "Mayor - Hayward"],
    ["Measures", "Measure I - Dublin USD"],
    ["Measures", "Measure EE - City of Oakland"],
  ]);
  const byTitle = new Map(contests.map((c) => [c.title, c]));
  expect(byTitle.get("Proposition 1")).toMatchObject({
    measure: true,
    precincts: { total: 627, reporting: 627 },
    choices: [
      { name: "Yes", votes: 211346 },
      { name: "No", votes: 91167 },
    ],
  });
  // "Vote for no more than Two (2)".
  expect(byTitle.get("Members, City Council - Albany (RCV)")).toMatchObject({
    key: "members-city-council-albany-rcv",
    voteFor: 2,
    precincts: { total: 3, reporting: 3 },
  });
  expect(byTitle.get("Mayor - Hayward")?.choices.map((c) => [c.name, c.votes])).toEqual([
    ["Mark Salinas", 15930],
    ["Tom Wong", 5222],
  ]);
  // "Needs 2/3 majority Yes votes to pass"; a majority measure carries none.
  expect(byTitle.get("Measure I - Dublin USD")).toMatchObject({ measure: true, threshold: "2/3" });
  expect(byTitle.get("Measure EE - City of Oakland")?.threshold).toBeUndefined();
  expect(contests.filter((c) => !isStateContest(c)).map((c) => c.category)).toEqual([
    "Judicial",
    "City",
    "City",
    "Measures",
    "Measures",
  ]);
});

test("a results page with no contest it can read throws, not an empty count", () => {
  expect(() => parseLvtHtml("<html><body>Maintenance</body></html>")).toThrow();
  expect(() => parseAcvoteHtml("<html><body><h2>Federal</h2></body></html>")).toThrow();
  // A heading with no rows under it (a changed layout) isn't a contest either.
  expect(() =>
    parseAcvoteHtml('<h2>City</h2><h4 class="racePanelHeading">Mayor - Hayward</h4><p>soon</p>'),
  ).toThrow();
});

test("the relay fetches only the page each HTML county is read from", () => {
  const sj = CA_COUNTY_FEEDS["san-joaquin"];
  const al = CA_COUNTY_FEEDS.alameda;
  if (!sj || !al) throw new Error("county missing");
  expect(lvtPagePath(sj)).toBe("en/Index_22.html");
  expect(feedPathTtl(sj, "en/Index_22.html")).toBe(60);
  expect(feedPathTtl(sj, "summary_22.csv")).toBeNull();
  expect(feedPathTtl(sj, "en/Index_21.html")).toBeNull();
  expect(feedPathTtl(al, ACVOTE_PAGE_PATH)).toBe(60);
  expect(feedPathTtl(al, "")).toBeNull();
  expect(feedPathTtl(al, "rcv/rcvresults.htm")).toBeNull();
});

test("HTML text: tags gone, entities decoded, spaces collapsed", () => {
  expect(htmlText("Hayward Area Recreation &amp; Park\n  <b>District</b>")).toBe(
    "Hayward Area Recreation & Park District",
  );
  expect(htmlText("O&#39;Neil&nbsp;&#x2013; A &bogus;")).toBe("O'Neil – A &bogus;");
});
