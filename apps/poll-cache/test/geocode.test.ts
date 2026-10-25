import { afterEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GEOCODE_PATH, type GeocodeResponse, handleGeocode, trimCensus } from "../src/geocode";
import worker from "../src/index";

// A real Census answer for SF City Hall (recorded 2026-10-20).
const cityHall = JSON.parse(
  readFileSync(join(import.meta.dir, "fixtures", "census-sf-city-hall.json"), "utf8"),
);

test("trimCensus keeps the address, point, districts, county and city", () => {
  expect(trimCensus(cityHall)).toEqual([
    {
      address: "1 DR CARLTON P GOODLETT PL, SAN FRANCISCO, CA, 94102",
      lon: -122.41831039539,
      lat: 37.778536095745,
      state: "CA",
      districts: { cd: "11", sd: "11", ad: "17" },
      county: "San Francisco",
      place: "San Francisco",
    },
  ]);
  expect(trimCensus({ result: { addressMatches: [] } })).toEqual([]);
  expect(() => trimCensus({ errors: ["nope"] })).toThrow();
});

describe("handleGeocode", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  function post(body: unknown) {
    return new Request(`https://api.example${GEOCODE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    });
  }

  test("forwards the address to Census, uncached, and answers no-store", async () => {
    const upstream = mock(async (_url: string, _init?: RequestInit) => Response.json(cityHall));
    globalThis.fetch = upstream as unknown as typeof fetch;
    const res = await handleGeocode(post({ address: "  1 Dr Carlton B Goodlett Pl,\n SF " }), {});
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await res.json()) as GeocodeResponse;
    expect(body.matches[0]?.districts).toEqual({ cd: "11", sd: "11", ad: "17" });

    const [url, init] = upstream.mock.calls[0] ?? [];
    const sent = new URL(String(url));
    expect(sent.host).toBe("geocoding.geo.census.gov");
    expect(sent.searchParams.get("address")).toBe("1 Dr Carlton B Goodlett Pl, SF");
    expect(init?.cache).toBe("no-store");
  });

  test("rejects anything but a POST with a short address", async () => {
    globalThis.fetch = mock(async () => Response.json(cityHall)) as unknown as typeof fetch;
    const get = new Request(`https://api.example${GEOCODE_PATH}?address=x`);
    expect((await handleGeocode(get, {})).status).toBe(405);
    expect((await handleGeocode(post("not json"), {})).status).toBe(400);
    expect((await handleGeocode(post({ address: "  " }), {})).status).toBe(400);
    expect((await handleGeocode(post({ address: "x".repeat(101) }), {})).status).toBe(400);
  });

  test("upstream trouble is a 502", async () => {
    globalThis.fetch = mock(
      async () => new Response("down", { status: 500 }),
    ) as unknown as typeof fetch;
    expect((await handleGeocode(post({ address: "somewhere" }), {})).status).toBe(502);
    globalThis.fetch = mock(async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch;
    expect((await handleGeocode(post({ address: "somewhere" }), {})).status).toBe(502);
  });
});

test("the worker answers the geocode preflight with POST allowed", async () => {
  const res = await worker.fetch(
    new Request(`https://api.example${GEOCODE_PATH}`, { method: "OPTIONS" }),
  );
  expect(res.status).toBe(204);
  expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
  expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
});
