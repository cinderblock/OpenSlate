import { afterEach, expect, test } from "bun:test";
import { COUNTY_RESULTS_USER_AGENT } from "@openslate/core/countyResults";
import { clearCountyCaCache } from "../src/countyCa";
import worker from "../src/index";
import { stateFeedUpstream } from "../src/stateFeeds";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  clearCountyCaCache();
});

const VIRGINIA =
  "https://enr.elections.virginia.gov/results/public/api/elections/virginia/2026-November-General";
const COLORADO = "https://results.enr.clarityelections.com/CO/127407";

test("only listed states' feed files reach a state", () => {
  expect(stateFeedUpstream("/api/state/va/data")).toEqual({ url: `${VIRGINIA}/data`, ttl: 60 });
  expect(stateFeedUpstream("/api/state/VA/data")).toEqual({ url: `${VIRGINIA}/data`, ttl: 60 });
  expect(stateFeedUpstream("/api/state/co/current_ver.txt")).toEqual({
    url: `${COLORADO}/current_ver.txt`,
    ttl: 60,
  });
  expect(stateFeedUpstream("/api/state/co/386671/json/en/summary.json")).toEqual({
    url: `${COLORADO}/386671/json/en/summary.json`,
    ttl: 3600,
  });
  // Another file of the same site, another state's kind of file, a path out of the feed.
  expect(stateFeedUpstream("/api/state/co/386671/json/en/electionsettings.json")).toBeNull();
  expect(stateFeedUpstream("/api/state/co/data")).toBeNull();
  expect(stateFeedUpstream("/api/state/va/current_ver.txt")).toBeNull();
  expect(stateFeedUpstream("/api/state/va/../../jurisdictions/virginia")).toBeNull();
  // A state with no feed here, something that isn't a state, no file at all.
  expect(stateFeedUpstream("/api/state/ca/data")).toBeNull();
  expect(stateFeedUpstream("/api/state/constructor/data")).toBeNull();
  expect(stateFeedUpstream("/api/state/va")).toBeNull();
});

test("the worker relays a state's count with its TTL, open CORS and an honest User-Agent", async () => {
  const asked: { url: string; ua: string | null }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    asked.push({ url: String(input), ua: new Headers(init?.headers).get("User-Agent") });
    return new Response('{"ballotItems":[]}', {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Set-Cookie": "x=1",
      },
    });
  }) as typeof fetch;
  const res = await worker.fetch(new Request("https://api.example/api/state/va/data"));
  expect(res.status).toBe(200);
  expect(asked).toEqual([{ url: `${VIRGINIA}/data`, ua: COUNTY_RESULTS_USER_AGENT }]);
  expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(res.headers.get("X-Data-Source")).toBe("State election office");
  // Nothing of the state's own headers that would stop a browser reading it.
  expect(res.headers.get("Cross-Origin-Resource-Policy")).toBeNull();
  expect(res.headers.get("Set-Cookie")).toBeNull();
  expect(await res.text()).toBe('{"ballotItems":[]}');

  // A second ask within the minute is answered from the first.
  await worker.fetch(new Request("https://api.example/api/state/va/data"));
  expect(asked).toHaveLength(1);
});

test("anything else under the prefix is not found, and never asks upstream", async () => {
  let asked = 0;
  globalThis.fetch = (async () => {
    asked++;
    return new Response("unexpected");
  }) as unknown as typeof fetch;
  for (const path of ["/api/state/va/x", "/api/state/zz/data", "/api/state/"]) {
    const res = await worker.fetch(new Request(`https://api.example${path}`));
    expect([path, res.status]).toEqual([path, 404]);
  }
  expect(asked).toBe(0);
});

test("the health answer names the route", async () => {
  const res = await worker.fetch(new Request("https://api.example/api/health"));
  expect(((await res.json()) as { state_feeds?: string }).state_feeds).toBe("/api/state/");
});
