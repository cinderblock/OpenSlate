import { afterEach, expect, test } from "bun:test";
import worker from "../src/index";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

// Kalshi forecasts are a self-hosted opt-in (apps/server, KALSHI_FORECASTS=true):
// the public worker neither relays them nor says it could.
test("the public worker has no Kalshi forecasts", async () => {
  const asked: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    asked.push(String(input));
    return new Response("unexpected");
  }) as typeof fetch;

  const res = await worker.fetch(
    new Request("https://api.example/api/forecasts/v2/events/KXGOVCA-26?include_markets=true"),
  );
  expect(res.status).toBe(404);
  expect(asked).toEqual([]);

  const health = (await (
    await worker.fetch(new Request("https://api.example/api/health"))
  ).json()) as Record<string, unknown>;
  expect(health.forecasts).toBeUndefined();
  expect(JSON.stringify(health)).not.toContain("kalshi");
});
