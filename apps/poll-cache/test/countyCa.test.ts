import { afterEach, expect, test } from "bun:test";
import { COUNTY_RESULTS_USER_AGENT } from "@openslate/core/countyResults";
import { clearCountyCaCache, countyCaUpstream } from "../src/countyCa";
import worker from "../src/index";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  clearCountyCaCache();
});

const BASE = "https://results.enr.clarityelections.com/CA/Santa_Clara/127570";

test("only listed counties' feed files reach a county", () => {
  expect(countyCaUpstream("/api/county-ca/santa-clara/current_ver.txt")).toEqual({
    url: `${BASE}/current_ver.txt`,
    ttl: 60,
  });
  expect(countyCaUpstream("/api/county-ca/santa-clara/383439/json/en/summary.json")).toEqual({
    url: `${BASE}/383439/json/en/summary.json`,
    ttl: 3600,
  });
  expect(countyCaUpstream("/api/county-ca/santa-clara/383439/json/ALL.json")).toBeNull();
  expect(countyCaUpstream("/api/county-ca/santa-clara/../../x")).toBeNull();
  expect(countyCaUpstream("/api/county-ca/nowhere/current_ver.txt")).toBeNull();
  expect(countyCaUpstream("/api/county-ca/constructor/current_ver.txt")).toBeNull();
  expect(countyCaUpstream("/api/county-ca/santa-clara")).toBeNull();
});

test("the worker relays a county file with its TTL, open CORS and an honest User-Agent", async () => {
  const asked: { url: string; ua: string | null }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    asked.push({ url: String(input), ua: new Headers(init?.headers).get("User-Agent") });
    return new Response("383439\r\n", {
      headers: {
        "Content-Type": "text/plain",
        "Last-Modified": "Wed, 04 Nov 2026 04:10:00 GMT",
        "Set-Cookie": "x=1",
      },
    });
  }) as typeof fetch;
  const res = await worker.fetch(
    new Request("https://api.example/api/county-ca/santa-clara/current_ver.txt"),
  );
  expect(res.status).toBe(200);
  expect(asked).toEqual([{ url: `${BASE}/current_ver.txt`, ua: COUNTY_RESULTS_USER_AGENT }]);
  expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
  expect(res.headers.get("Last-Modified")).toBe("Wed, 04 Nov 2026 04:10:00 GMT");
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(res.headers.get("Set-Cookie")).toBeNull();
  expect(await res.text()).toBe("383439\r\n");
});

test("anything else under the prefix is not found, and never asks upstream", async () => {
  let asked = 0;
  globalThis.fetch = (async () => {
    asked++;
    return new Response("unexpected");
  }) as unknown as typeof fetch;
  const res = await worker.fetch(new Request("https://api.example/api/county-ca/santa-clara/x"));
  expect(res.status).toBe(404);
  expect(asked).toBe(0);
});

test("a crowd asking at once costs the county one request; errors are kept 15 s", async () => {
  let asked = 0;
  globalThis.fetch = (async () => {
    asked++;
    await new Promise((r) => setTimeout(r, 20));
    return new Response("down", { status: 503 });
  }) as unknown as typeof fetch;
  const url = "https://api.example/api/county-ca/santa-clara/current_ver.txt";
  const answers = await Promise.all(
    Array.from({ length: 20 }, () => worker.fetch(new Request(url))),
  );
  expect(asked).toBe(1);
  expect(answers.every((r) => r.status === 503)).toBe(true);
  expect(answers[0]?.headers.get("Cache-Control")).toBe("public, max-age=15");
  await worker.fetch(new Request(url));
  expect(asked).toBe(1);
});

test("an unreachable county answers 502", async () => {
  globalThis.fetch = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  const res = await worker.fetch(
    new Request("https://api.example/api/county-ca/santa-clara/current_ver.txt"),
  );
  expect(res.status).toBe(502);
});

test("a livevoterturnout county's summary CSV is relayed with a minute's cache", () => {
  expect(countyCaUpstream("/api/county-ca/orange/summary_24.csv")).toEqual({
    url: "https://www.livevoterturnout.com/ENR/orangecaenr/24/summary_24.csv",
    ttl: 60,
  });
  expect(countyCaUpstream("/api/county-ca/orange/summary_24.xml")).toBeNull();
  expect(countyCaUpstream("/api/county-ca/orange/current_ver.txt")).toBeNull();
});

test("Los Angeles' feed is asked for with its election id, which the client can't change", () => {
  expect(countyCaUpstream("/api/county-ca/los-angeles/json")).toEqual({
    url: "https://results.lavote.gov/electionresults/json?electionid=4348",
    ttl: 60,
  });
  expect(countyCaUpstream("/api/county-ca/sacramento/data")).toEqual({
    url: "https://results.saccounty.gov/results/public/api/elections/sacramento-county-ca/69/data",
    ttl: 60,
  });
});

test("the two counties read from their results pages: that page only", () => {
  expect(countyCaUpstream("/api/county-ca/san-joaquin/en/Index_22.html")).toEqual({
    url: "https://www.livevoterturnout.com/ENR/sanjoaquincaenr/22/en/Index_22.html",
    ttl: 60,
  });
  expect(countyCaUpstream("/api/county-ca/alameda/index.htm")).toEqual({
    url: "https://alamedacountyca.gov/rovresults/260/index.htm",
    ttl: 60,
  });
  expect(countyCaUpstream("/api/county-ca/alameda/")).toBeNull();
  expect(countyCaUpstream("/api/county-ca/san-joaquin/summary_22.csv")).toBeNull();
});
