import { describe, expect, setSystemTime, test } from "bun:test";
import { createForecastsSource, FORECAST_TTL_MS, LAST_GOOD_MS } from "../src/forecasts";

/** A fetch that answers each request with the next response, counting calls. */
function scripted(...responses: Array<Response | Error>) {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push(String(input));
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const good = () =>
  new Response('{"event":{}}', { headers: { "content-type": "application/json" } });
const tooMany = () => new Response('{"error":{"code":"too_many_requests"}}', { status: 429 });

describe("forecasts proxy", () => {
  test("a 429 with nothing kept is relayed, uncacheable", async () => {
    const { fetchImpl } = scripted(tooMany());
    const res = await createForecastsSource(fetchImpl).proxy("/events/X", "");
    expect(res.status).toBe(429);
    expect(res.ttlMs).toBe(0);
    expect(res.stale).toBeUndefined();
  });

  test("a 429 after a good answer serves that answer, marked stale", async () => {
    const start = new Date("2026-10-24T20:00:00Z");
    setSystemTime(start);
    try {
      const { calls, fetchImpl } = scripted(good(), tooMany(), new TypeError("offline"));
      const source = createForecastsSource(fetchImpl);
      expect((await source.proxy("/events/X", "")).status).toBe(200);

      setSystemTime(new Date(start.getTime() + FORECAST_TTL_MS + 1));
      const stale = await source.proxy("/events/X", "");
      expect(stale).toMatchObject({ status: 200, body: '{"event":{}}', ttlMs: 0 });
      expect(stale.stale).toEqual({ fetchedAt: start.getTime(), upstreamStatus: 429 });

      const offline = await source.proxy("/events/X", "");
      expect(offline.stale?.upstreamStatus).toBe(502);
      expect(calls).toHaveLength(3);
    } finally {
      setSystemTime();
    }
  });

  test("a copy older than LAST_GOOD_MS isn't served", async () => {
    const start = new Date("2026-10-24T20:00:00Z");
    setSystemTime(start);
    try {
      const { fetchImpl } = scripted(good(), tooMany());
      const source = createForecastsSource(fetchImpl);
      await source.proxy("/events/X", "");
      setSystemTime(new Date(start.getTime() + LAST_GOOD_MS));
      const res = await source.proxy("/events/X", "");
      expect(res.status).toBe(429);
      expect(res.stale).toBeUndefined();
    } finally {
      setSystemTime();
    }
  });

  test("a network failure with nothing kept throws (the route answers 502)", async () => {
    const { fetchImpl } = scripted(new TypeError("offline"));
    await expect(createForecastsSource(fetchImpl).proxy("/events/X", "")).rejects.toThrow(
      "offline",
    );
  });
});
