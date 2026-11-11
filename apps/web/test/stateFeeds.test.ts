import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseStateFeed, type StateFeed, type Subject, stateFeed } from "@openslate/core";
import {
  isStateRaceId,
  stateContestFor,
  stateContestOfRace,
  stateCountRegions,
} from "../src/lib/counts";
import { feedContestResult } from "../src/lib/feedContest";
import { NotOnBallot } from "../src/lib/liveCount";
import {
  clearStateFeedCache,
  contestOfKey,
  districtsIn,
  feedOfRegion,
  fetchStateResults,
  measureToken,
  stateContestKey,
  stateFeedRegions,
  stateSections,
} from "../src/lib/stateFeeds";

/**
 * Other states' own counts, on what each published for the 2026-11-03
 * general (packages/core/test/fixtures/state, cut from the real feeds).
 */

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(import.meta.dir, "../../../packages/core/test/fixtures/state", name), "utf8"),
  );
const feedOf = (code: string): StateFeed => {
  const feed = stateFeed(code);
  if (!feed) throw new Error(`no feed for ${code}`);
  return feed;
};
const contestsOf = (code: string, kind: "data" | "summary") =>
  parseStateFeed(feedOf(code), fixture(`${code}-${kind}.json`)).contests;
const titles = (items: { contest: { title: string } }[]) => items.map((i) => i.contest.title);
const subject = (title: string, jurisdiction: string, election = "2026-11-03"): Subject => ({
  title,
  jurisdiction,
  election,
});

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  clearStateFeedCache();
});

describe("which states", () => {
  test("the feed states by name, and each is one whose count the results pages read", () => {
    const regions = stateFeedRegions();
    expect(regions).toContain("us/va");
    expect(regions).not.toContain("us/ca");
    expect(regions.indexOf("us/az")).toBeLessThan(regions.indexOf("us/wv"));
    for (const region of regions) expect(stateCountRegions()).toContain(region);
    // California keeps its own.
    expect(stateCountRegions()).toContain("us/ca");
  });

  test("a region's feed, from the state or a path inside it", () => {
    expect(feedOfRegion("us/va")?.code).toBe("va");
    expect(feedOfRegion("us/va/cd-7")?.feed.name).toBe("Virginia");
    expect(feedOfRegion("us/ca")).toBeNull();
    expect(feedOfRegion("us")).toBeNull();
    expect(feedOfRegion(undefined)).toBeNull();
  });
});

describe("a state's contests, sorted for its page", () => {
  test("Virginia with no area: statewide, then Congress, then the rest", () => {
    const sections = stateSections("us/va", feedOf("va"), contestsOf("va", "data"));
    expect(titles(sections.statewide)).toEqual([
      "Member, United States Senate",
      "Proposed Constitutional Amendment Question 1",
    ]);
    expect(sections.mine).toEqual([]);
    expect(titles(sections.districts)).toEqual([
      "Member, House of Representatives (1st District)",
      "Member, House of Representatives (11th District)",
      "Member, House of Delegates (20th District)",
    ]);
    expect(titles(sections.other)).toEqual(["Mayor - Farmville (Town of Farmville)"]);
  });

  test("Virginia for a voter in the 11th: their district comes out of the list", () => {
    const area = { districts: { "us/va/cd": "11", "us/va/sd": "35", "us/va/hd": "7" } };
    expect(districtsIn("us/va", area)).toEqual({
      "us-house": "11",
      "state-upper": "35",
      "state-lower": "7",
    });
    const sections = stateSections("us/va", feedOf("va"), contestsOf("va", "data"), area);
    expect(titles(sections.mine)).toEqual(["Member, House of Representatives (11th District)"]);
    expect(titles(sections.districts)).toEqual([
      "Member, House of Representatives (1st District)",
      "Member, House of Delegates (20th District)",
    ]);
    // Another state's districts say nothing here.
    expect(districtsIn("us/va", { districts: { "us/md/cd": "11" } })).toEqual({});
  });

  test("Rhode Island: a statewide question by its group and by every town counting it", () => {
    const sections = stateSections("us/ri", feedOf("ri"), contestsOf("ri", "data"));
    expect(titles(sections.statewide)).toEqual([
      "Senator in Congress",
      "General Treasurer",
      "1. HIGHER EDUCATION FACILITIES - $275,000,000",
    ]);
    expect(titles(sections.other)).toEqual(["Barrington: Town Council"]);
  });

  test("Georgia: an office the whole state elects by district is statewide; Idaho's two seats stay two", () => {
    const georgia = stateSections("us/ga", feedOf("ga"), contestsOf("ga", "data"));
    expect(titles(georgia.statewide)).toContain("PSC - District 3");
    expect(titles(georgia.statewide)).toContain("Proposed Constitutional Amendment 1");
    const idaho = stateSections("us/id", feedOf("id"), contestsOf("id", "data"), {
      districts: { "us/id/hd": "1" },
    });
    expect(titles(idaho.mine)).toEqual([
      "State Representative District 1 Seat A",
      "State Representative District 1 Seat B",
    ]);
  });

  test("Washington: a city's proposition isn't the state's", () => {
    const sections = stateSections("us/wa", feedOf("wa"), contestsOf("wa", "data"));
    expect(titles(sections.statewide)).toEqual(["Initiative Measure No. IP26-645"]);
    expect(titles(sections.other)).toEqual(["City of Bothell - Proposition No. 1"]);
  });

  test("Colorado: a state board seat by congressional district isn't Congress", () => {
    const sections = stateSections("us/co", feedOf("co"), contestsOf("co", "summary"), {
      districts: { "us/co/cd": "1" },
    });
    expect(titles(sections.mine)).toEqual([
      "Representative to the 120th United States Congress - District 1",
    ]);
    expect(titles(sections.other)).toContain(
      "State Board of Education Member - Congressional District 1",
    );
    expect(titles(sections.statewide).slice(0, 3)).toEqual([
      "United States Senator",
      "Governor / Lieutenant Governor",
      "Attorney General",
    ]);
  });
});

describe("a race from a slate, in its state's count", () => {
  test("by its jurisdiction and title", () => {
    expect(stateContestKey(subject("US Senate", "us/va"))).toBe("us-senate");
    expect(stateContestKey(subject("US House", "us/va/cd-11"))).toBe("us-house/11");
    expect(stateContestKey(subject("House of Delegates", "us/va/hd-20"))).toBe("state-lower/20");
    expect(stateContestKey(subject("Governor", "us/ga"))).toBe("governor");
    expect(stateContestKey(subject("Attorney General", "us/co"))).toBe("office/attorney");
    expect(stateContestKey(subject("State Representative, Seat B", "us/id/hd-1"))).toBe(
      "state-lower/1/b",
    );
    expect(stateContestKey(subject("Proposition 141", "us/az"))).toBe("measure/proposition/141");
    expect(stateContestKey(subject("Constitutional Amendment A", "us/ut"))).toBe(
      "measure/amendment/a",
    );
  });

  test("not another election's, another state's, or a town's", () => {
    expect(stateContestKey(subject("US Senate", "us/va", "2024-11-05"))).toBeUndefined();
    expect(stateContestKey(subject("US Senate", "us/tx"))).toBeUndefined();
    expect(stateContestKey(subject("Mayor", "us/va/farmville"))).toBeUndefined();
    expect(stateContestKey(subject("Some question", "us/va"))).toBeUndefined();
    expect(stateContestKey({ title: "US Senate" })).toBeUndefined();
  });

  test("a measure's number or letter", () => {
    expect(measureToken("PROPOSITION 141")).toBe("141");
    expect(measureToken("Proposed Constitutional Amendment Question 1")).toBe("1");
    expect(measureToken("Constitutional Amendment A")).toBe("a");
    expect(measureToken("Initiative Measure No. IP26-645")).toBe("ip26-645");
    expect(measureToken("1. HIGHER EDUCATION FACILITIES - $275,000,000")).toBe("1");
    expect(measureToken("Budget Stabilization Fund")).toBeUndefined();
  });

  test("the key finds the state's contest", () => {
    const virginia = contestsOf("va", "data");
    const feed = feedOf("va");
    expect(contestOfKey(feed, virginia, "us-senate")?.title).toBe("Member, United States Senate");
    expect(contestOfKey(feed, virginia, "us-house/11")?.title).toBe(
      "Member, House of Representatives (11th District)",
    );
    expect(contestOfKey(feed, virginia, "us-house/5")).toBeUndefined();
    expect(contestOfKey(feed, virginia, "measure/amendment/1")?.title).toBe(
      "Proposed Constitutional Amendment Question 1",
    );
    expect(contestOfKey(feed, virginia, "measure/amendment/2")).toBeUndefined();
    const idaho = contestsOf("id", "data");
    expect(contestOfKey(feedOf("id"), idaho, "state-lower/1/b")?.title).toBe(
      "State Representative District 1 Seat B",
    );
    // Two seats and the subject names neither: not one contest.
    expect(contestOfKey(feedOf("id"), idaho, "state-lower/1")).toBeUndefined();
    const colorado = contestsOf("co", "summary");
    expect(contestOfKey(feedOf("co"), colorado, "office/attorney")?.title).toBe("Attorney General");
    expect(contestOfKey(feedOf("co"), colorado, "governor")?.title).toBe(
      "Governor / Lieutenant Governor",
    );
    // A special election isn't the seat's regular contest.
    const west = contestsOf("wv", "summary");
    expect(contestOfKey(feedOf("wv"), west, "state-upper/3")?.title).toBe(
      "STATE SENATOR, 3rd Senatorial District",
    );
  });
});

describe("reading a state's count", () => {
  function stub(routes: Record<string, { body: unknown; headers?: Record<string, string> }>) {
    const asked: string[] = [];
    globalThis.fetch = (async (input: string | URL | Request) => {
      const url = String(input);
      asked.push(url);
      const hit = Object.entries(routes).find(([path]) => url.endsWith(path));
      if (!hit) return new Response("not found", { status: 404 });
      const body = typeof hit[1].body === "string" ? hit[1].body : JSON.stringify(hit[1].body);
      return new Response(body, { headers: hit[1].headers ?? {} });
    }) as typeof fetch;
    return asked;
  }

  test("Enhanced Voting: one document, the state's own time for it", async () => {
    const asked = stub({ "/va/data": { body: fixture("va-data.json") } });
    const results = await fetchStateResults("va");
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatch(/\/api\/state\/va\/data$/);
    expect(results.state).toBe("va");
    expect(results.updated).toBe(Date.parse("2026-11-10T23:10:33.124623Z"));
    expect(results.official).toBe(false);
    expect(results.contests).toHaveLength(6);
    // The same count again is the same object: nothing downstream recomputes.
    expect(await fetchStateResults("va")).toBe(results);
  });

  test("Clarity: the version pointer, then that version's summary, once per version", async () => {
    const asked = stub({
      "/current_ver.txt": { body: "386671" },
      "/386671/json/en/summary.json": {
        body: fixture("co-summary.json"),
        headers: { "Last-Modified": "Tue, 10 Nov 2026 22:54:36 GMT" },
      },
    });
    const results = await fetchStateResults("co");
    // Colorado's site answers any browser, and nothing here routes through a
    // relay: it is asked directly. Virginia's (above) can't be.
    expect(asked[0]).toBe("https://results.enr.clarityelections.com/CO/127407/current_ver.txt");
    expect(results.version).toBe("386671");
    expect(results.updated).toBe(Date.parse("2026-11-10T22:54:36Z"));
    expect(results.contests.map((c) => c.title)).toContain("United States Senator");
    // The pointer hasn't moved: the summary isn't fetched again.
    expect(await fetchStateResults("co")).toBe(results);
    expect(asked.filter((url) => url.endsWith("summary.json"))).toHaveLength(1);
  });

  test("everyone asking at once shares one request", async () => {
    const asked = stub({ "/va/data": { body: fixture("va-data.json") } });
    const [a, b] = await Promise.all([fetchStateResults("va"), fetchStateResults("va")]);
    expect(a).toBe(b);
    expect(asked).toHaveLength(1);
  });

  test("a state that answers badly, and a state with no feed", async () => {
    stub({});
    await expect(fetchStateResults("va")).rejects.toThrow("Virginia's results site answered 404");
    await expect(fetchStateResults("zz")).rejects.toThrow("No results feed for zz");
  });

  test("the results pages get a race from it, as they do California's", async () => {
    stub({ "/va/data": { body: fixture("va-data.json") } });
    const hit = stateContestFor(subject("US House", "us/va/cd-11"));
    expect(hit?.raceId).toBe("st-va:us-house/11");
    expect(hit?.source.name).toBe("Virginia Department of Elections");
    expect(hit?.source.short).toBe("Department of Elections");
    expect(isStateRaceId("st-va:us-house/11")).toBe(true);
    expect(stateContestOfRace("st-va:us-house/11")?.contest).toBe("us-house/11");
    if (!hit) throw new Error("no hit");
    const result = await hit.source.fetchContest(hit.contest);
    expect(result.kind).toBe("candidates");
    expect(result.reporting.units).toBe("localities");
    const race = hit.source.toRace(hit.contest, result);
    expect(race.id).toBe("st-va:us-house/11");
    expect(race.province).toBe("VA");
    expect(race.election_date.slice(0, 10)).toBe("2026-11-03");
    expect(race.last_updated).toBe("2026-11-10T23:10:33.124Z");
    expect(race.candidates.length).toBeGreaterThan(1);
    // A district with no contest in the count.
    await expect(hit.source.fetchContest("us-house/12")).rejects.toBeInstanceOf(NotOnBallot);
    // California's subjects still go to California.
    expect(stateContestFor(subject("Governor", "us/ca"))?.source.region).toBe("us/ca");
  });
});

describe("a feed's contest as the pages show it", () => {
  test("a state's reporting counts what the state counts", () => {
    const senate = contestsOf("va", "data")[0];
    if (!senate) throw new Error("no contest");
    const result = feedContestResult(senate, 1_800_000_000_000, undefined, "localities");
    expect(result.reporting.text).toBe("133 of 133 localities reporting");
    expect(result.reporting.units).toBe("localities");
    expect(result.reporting.percent).toBe(100);
    // A county's stays as it was.
    const county = feedContestResult(senate, 1_800_000_000_000);
    expect(county.reporting.text).toBe("133 of 133 precincts reporting");
    expect(county.reporting.units).toBeUndefined();
  });

  test("a measure's yes and no, whatever the state calls them", () => {
    const question = contestsOf("ri", "data").find((c) => c.measure);
    const amendment = contestsOf("ut", "data").find((c) => c.measure);
    const colorado = contestsOf("co", "summary").find((c) => c.title.startsWith("Amendment 81"));
    for (const contest of [question, amendment, colorado]) {
      if (!contest) throw new Error("no measure");
      const result = feedContestResult(contest);
      if (result.kind !== "measure") throw new Error("not a measure");
      expect(result.measure.yes).toBeGreaterThan(0);
      expect(result.measure.no).toBeGreaterThan(0);
      expect(Math.abs(result.measure.yesPercent + result.measure.noPercent - 100)).toBeLessThan(
        0.2,
      );
    }
  });
});
