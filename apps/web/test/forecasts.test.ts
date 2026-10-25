import { afterEach, describe, expect, test } from "bun:test";
import {
  ForecastUnavailableError,
  forecastEventQueryOptions,
  forecastsSource,
} from "../src/lib/forecasts";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function stubRelay(res: Response): void {
  globalThis.fetch = (async () => res) as unknown as typeof fetch;
}

const envelope = {
  event: { event_ticker: "KXGOVCA-26", title: "Governor of California" },
  markets: [{ ticker: "KXGOVCA-26-A", yes_sub_title: "A", last_price_dollars: "0.6" }],
};

describe("Kalshi forecasts through the relay", () => {
  test("a fresh answer has no staleAsOf", async () => {
    stubRelay(Response.json(envelope));
    const forecast = await forecastsSource.forecastForEvent("KXGOVCA-26");
    expect(forecast?.candidates[0]).toMatchObject({ name: "A", probability: 0.6 });
    expect(forecast?.staleAsOf).toBeUndefined();
  });

  test("the relay's last good copy carries when it was fetched", async () => {
    stubRelay(
      Response.json(envelope, {
        headers: {
          "X-OpenSlate-Stale": "true",
          "X-OpenSlate-Fetched-At": "2026-10-24T22:12:00.000Z",
          "X-OpenSlate-Upstream-Status": "429",
        },
      }),
    );
    const forecast = await forecastsSource.forecastForEvent("KXGOVCA-26");
    expect(forecast?.staleAsOf).toBe("2026-10-24T22:12:00.000Z");
  });

  test("a missing event is null, an error is a ForecastUnavailableError", async () => {
    stubRelay(new Response("", { status: 404 }));
    expect(await forecastsSource.forecastForEvent("KXNOPE-26")).toBeNull();

    stubRelay(new Response('{"error":{"code":"too_many_requests"}}', { status: 429 }));
    const error = await forecastsSource.forecastForEvent("KXGOVCA-26").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForecastUnavailableError);
    expect((error as ForecastUnavailableError).rateLimited).toBe(true);
  });

  test("a rate limit isn't retried; other errors are, once", () => {
    const { retry } = forecastEventQueryOptions("KXGOVCA-26");
    expect(retry(0, new ForecastUnavailableError(429, ""))).toBe(false);
    expect(retry(0, new ForecastUnavailableError(503, ""))).toBe(true);
    expect(retry(1, new ForecastUnavailableError(503, ""))).toBe(false);
    expect(retry(0, new TypeError("Failed to fetch"))).toBe(true);
  });
});
