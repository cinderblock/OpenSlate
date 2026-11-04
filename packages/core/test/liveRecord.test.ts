import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type FeedFile, type FileValidators, readCountyReport } from "../src/countyReport";
import { CA_COUNTY_FEEDS, parseClaritySummary } from "../src/countyResults";
import { countyEntries, sosEntries, sosRecordedPaths, sosReportTime } from "../src/liveRecord";
import { appendChoices, mergeHistories, type RaceHistory } from "../src/raceHistory";
import { CA_2026_GENERAL, nextCheck, QUICK_CHECK_MS } from "../src/recordSchedule";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
const json = (name: string) => JSON.parse(fixture(name));

describe("the state's reports", () => {
  test("report time: California wall time to an instant", () => {
    // 8:08 a.m. PST = 16:08Z.
    expect(sosReportTime("November 4, 2026, 8:08 a.m.")).toBe(Date.parse("2026-11-04T16:08:00Z"));
    // PDT in October: 8:15 p.m. = 03:15Z the next day.
    expect(sosReportTime("October 20, 2026, 8:15 p.m.")).toBe(Date.parse("2026-10-21T03:15:00Z"));
    expect(sosReportTime("soon")).toBeUndefined();
  });

  test("an office: one race, most votes first, precincts and time", () => {
    const [governor, ...rest] = sosEntries("governor", json("sos-governor.json"));
    expect(rest).toEqual([]);
    expect(governor?.id).toBe("governor");
    expect(governor?.p).toBe(100);
    expect(governor?.at).toBe(Date.parse("2026-11-04T16:08:00Z"));
    expect(governor?.choices.map((c) => c.name)).toEqual(["Xavier Becerra", "Steve Hilton"]);
    expect(governor?.choices[0]?.votes).toBe(4_992_161);
  });

  test("the propositions: one Yes / No race each, by number", () => {
    const props = sosEntries("ballot-measures", json("sos-ballot-measures.json"));
    expect(props.length).toBeGreaterThan(1);
    expect(props[0]?.id).toBe("prop/1");
    expect(props[0]?.choices.map((c) => c.name)).toEqual(["Yes", "No"]);
  });

  test("the Supreme Court: one retention vote per justice", () => {
    const justices = sosEntries("supreme-court", json("sos-supreme-court.json"));
    expect(justices[0]).toMatchObject({
      id: "supreme-court/kelli-m-evans",
      choices: [
        { name: "Yes", votes: 4_380_187 },
        { name: "No", votes: 1_752_274 },
      ],
    });
  });

  test("every whole-state document, once", () => {
    const paths = sosRecordedPaths();
    expect(new Set(paths).size).toBe(paths.length);
    expect(paths).toContain("us-rep/district/52");
    expect(paths).toContain("board-of-equalization/district/4");
    expect(sosEntries("status", {})).toEqual([]);
  });
});

describe("a county's reports", () => {
  const feed = CA_COUNTY_FEEDS["santa-clara"];
  if (!feed) throw new Error("no Santa Clara feed");
  const summary = fixture("clarity-summary-santa-clara.json");

  test("each race under the Results page's id; measures as Yes / No", () => {
    const contests = parseClaritySummary(JSON.parse(summary));
    const entries = countyEntries("santa-clara", contests, 1_000);
    expect(entries).toHaveLength(contests.length);
    const m = contests.findIndex((c) => c.measure);
    expect(entries[m]?.id).toBe(`county-ca/santa-clara/${contests[m]?.key}`);
    expect(entries[m]?.choices.map((c) => c.name)).toEqual(["Yes", "No"]);
    for (const e of entries) {
      expect(e.at).toBe(1_000);
      const votes = e.choices.map((c) => c.votes);
      if (!e.choices.some((c) => c.name === "Yes"))
        expect(votes).toEqual([...votes].sort((a, b) => b - a));
    }
  });

  test("Clarity: one small request when the version hasn't moved", async () => {
    const asked: string[] = [];
    const get = async (path: string): Promise<FeedFile> => {
      asked.push(path);
      return {
        path,
        status: 200,
        contentType: "text/plain",
        lastModified: 5_000,
        text: path === "current_ver.txt" ? "384997\n" : summary,
      };
    };
    const report = await readCountyReport(feed, get);
    if (report === "unchanged") throw new Error("expected a report");
    expect(report.version).toBe("384997");
    expect(report.updated).toBe(5_000);
    expect(report.files.map((f) => f.path)).toEqual([
      "current_ver.txt",
      "384997/json/en/summary.json",
    ]);
    asked.length = 0;
    expect(await readCountyReport(feed, get, { version: "384997" })).toBe("unchanged");
    expect(asked).toEqual(["current_ver.txt"]);
  });

  test("a single-file feed: asks with its validators, and a 304 is no change", async () => {
    const orange = CA_COUNTY_FEEDS.orange;
    if (!orange) throw new Error("no Orange feed");
    let asked: FileValidators | undefined;
    const get = async (path: string, v?: FileValidators): Promise<FeedFile> => {
      asked = v;
      return { path, status: 304, contentType: "text/csv", text: "" };
    };
    const previous = { version: "x", lastModified: 7_000, etag: 'W/"c6"' };
    expect(await readCountyReport(orange, get, previous)).toBe("unchanged");
    expect(asked).toEqual({ lastModified: 7_000, etag: 'W/"c6"' });
  });
});

describe("when to check next", () => {
  const c = CA_2026_GENERAL;
  const min = 60_000;
  const hour = 60 * min;

  test("every minute on election night", () => {
    expect(nextCheck(c.pollsClose + 5 * min, undefined, [], c)).toEqual({
      at: c.pollsClose + 6 * min,
      quick: false,
    });
  });

  test("an hour after the last change, the gap doubles each quiet hour, up to hourly", () => {
    const changed = c.nightEnd + hour;
    const gap = (quiet: number) =>
      (nextCheck(changed + quiet, changed, [], c)?.at ?? 0) - (changed + quiet);
    expect(gap(30 * min)).toBe(min);
    expect(gap(hour)).toBe(2 * min);
    expect(gap(3 * hour)).toBe(8 * min);
    expect(gap(10 * hour)).toBe(hour);
  });

  test("every 15 s around an announced release, until its report lands", () => {
    const release = c.nightEnd + 30 * hour;
    expect(nextCheck(release - 2 * min, c.nightEnd, [release], c)).toEqual({
      at: release - 2 * min + QUICK_CHECK_MS,
      quick: true,
    });
    // Landed: back to the ordinary schedule.
    expect(nextCheck(release + min, release, [release], c)?.quick).toBe(false);
    // Waiting hourly: wakes for the window.
    expect(nextCheck(release - 30 * min, c.nightEnd, [release], c)?.at).toBe(release - 5 * min);
  });

  test("stops once the count is certified, not at 100% of precincts", () => {
    expect(nextCheck(c.stop, undefined, [], c)).toBeNull();
    expect(nextCheck(c.stop - min, undefined, [], c)?.at).toBe(c.stop);
  });
});

describe("history from the relay and from this browser", () => {
  const yesNo = (yes: number, no: number) => [
    { name: "Yes", votes: yes },
    { name: "No", votes: no },
  ];
  const server: RaceHistory = appendChoices(
    appendChoices(undefined, yesNo(10, 5), undefined, 3_000),
    yesNo(20, 9),
    50,
    4_000,
  );

  test("the browser's points from before the relay's first come first", () => {
    const local = appendChoices(
      appendChoices(undefined, yesNo(1, 1), undefined, 1_000),
      yesNo(10, 5),
      undefined,
      3_000,
    );
    expect(mergeHistories(server, local)?.points.map((p) => [p.at, p.v])).toEqual([
      [1_000, [1, 1]],
      [3_000, [10, 5]],
      [4_000, [20, 9]],
    ]);
  });

  test("either alone stands", () => {
    expect(mergeHistories(server, undefined)).toBe(server);
    expect(mergeHistories(undefined, server)).toBe(server);
  });
});
