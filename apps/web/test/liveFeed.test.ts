import { describe, expect, test } from "bun:test";
import { feedOfKey, feedState, noteAnswer, refetchDelay, SOS_FEED } from "../src/lib/liveFeed";

describe("which feed a results query reads", () => {
  test("the state's contests, a county's count, not the county list", () => {
    expect(feedOfKey(["sos-ca", "governor", null])).toBe(SOS_FEED);
    expect(feedOfKey(["sos-ca", "county-ca", "santa-clara"])).toBe("santa-clara");
    expect(feedOfKey(["sos-ca", "counties"])).toBeUndefined();
    expect(feedOfKey(["race-history", "governor"])).toBeUndefined();
  });
});

describe("polling lined up with the relay's recorder", () => {
  const headers = (h: Record<string, string>) => new Response("", { headers: h });

  test("the relay's answer says which report it is and when the next is due", () => {
    noteAnswer("orange", headers({ "X-Report-Version": "5000", "X-Ready-By": "90000" }));
    expect(feedState("orange")).toMatchObject({ version: 5000, readyBy: 90_000 });
    // An older answer (a cache) doesn't take the version back.
    noteAnswer("orange", headers({ "X-Report-Version": "4000" }));
    expect(feedState("orange").version).toBe(5000);
    // A source's own answer (no recorder) says nothing.
    noteAnswer("orange", headers({}));
    expect(feedState("orange").version).toBe(5000);
  });

  test("asks a second or few after the next report is due, else every minute", () => {
    noteAnswer("marin", headers({ "X-Report-Version": "1", "X-Ready-By": "100000" }));
    expect(refetchDelay("marin", 70_000, 0)).toBe(31_000);
    expect(refetchDelay("marin", 70_000, 1)).toBe(34_000);
    // Due any moment: a few seconds; far off: the old minute; long overdue: the minute too.
    expect(refetchDelay("marin", 99_000, 0)).toBe(5_000);
    expect(refetchDelay("marin", 0, 0)).toBe(60_000);
    expect(refetchDelay("marin", 200_000, 0)).toBe(60_000);
    expect(refetchDelay("no-such-feed", 0, 0)).toBe(60_000);
    expect(refetchDelay(undefined, 0, 0)).toBe(60_000);
  });
});
