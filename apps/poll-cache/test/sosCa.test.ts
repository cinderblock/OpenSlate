import { afterEach, expect, test } from "bun:test";
import worker, { sosCaUpstream } from "../src/index";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("only contest paths reach the Secretary of State", () => {
  expect(sosCaUpstream("/api/sos-ca/returns/governor")).toBe(
    "https://api.sos.ca.gov/returns/governor",
  );
  expect(sosCaUpstream("/api/sos-ca/returns/us-rep/district/16")).toBe(
    "https://api.sos.ca.gov/returns/us-rep/district/16",
  );
  expect(sosCaUpstream("/api/sos-ca/returns/ballot-measures/county/santa-clara")).toBe(
    "https://api.sos.ca.gov/returns/ballot-measures/county/santa-clara",
  );
  expect(sosCaUpstream("/api/sos-ca/returns/../admin")).toBeNull();
  expect(sosCaUpstream("/api/sos-ca/returns/governor?x=1")).toBeNull();
  expect(sosCaUpstream("/api/sos-ca/returns/a/b/c")).toBeNull();
});

test("the worker relays a contest with a minute's cache and open CORS", async () => {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    asked.push(String(input));
    return new Response(JSON.stringify({ raceTitle: "Governor" }), {
      headers: { "Content-Type": "application/json", "Set-Cookie": "x=1" },
    });
  }) as typeof fetch;
  const res = await worker.fetch(new Request("https://api.example/api/sos-ca/returns/governor"));
  expect(res.status).toBe(200);
  expect(asked).toEqual(["https://api.sos.ca.gov/returns/governor"]);
  expect(res.headers.get("Cache-Control")).toBe("public, max-age=60");
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  expect(res.headers.get("Set-Cookie")).toBeNull();
  expect(await res.json()).toEqual({ raceTitle: "Governor" });
});

test("anything else under the prefix is not found, and never asks upstream", async () => {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    asked.push(String(input));
    return new Response("unexpected");
  }) as typeof fetch;
  const res = await worker.fetch(new Request("https://api.example/api/sos-ca/returns/a/b/c/d"));
  expect(res.status).toBe(404);
  expect(asked).toEqual([]);
});
