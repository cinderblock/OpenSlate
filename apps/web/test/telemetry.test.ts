import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "telemetry-collector";
import { type UsageTransport, batchingSink } from "../src/lib/telemetry";
import { setUsageEnabled, setUsageSink, track } from "../src/lib/usage";

function recorder() {
  const tracked: Array<[string, { dims?: Record<string, string> } | undefined]> = [];
  let flushes = 0;
  const transport: UsageTransport = {
    track: (event, options) => tracked.push([event, options]),
    flushUsage: async () => {
      flushes++;
    },
  };
  return { transport, tracked, flushes: () => flushes };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("batchingSink", () => {
  test("holds events and sends them together in one flush", async () => {
    const r = recorder();
    const sink = batchingSink(r.transport, { isEnabled: () => true, batchMs: 10 });
    sink.track("page.view", { route: "/results" });
    sink.track("identity.create");
    expect(r.tracked).toEqual([]);

    await wait(30);
    expect(r.tracked).toEqual([
      ["page.view", { dims: { route: "/results" } }],
      ["identity.create", {}],
    ]);
    expect(r.flushes()).toBe(1);
  });

  test("sends nothing if stats were switched off before the batch went out", async () => {
    let enabled = true;
    const r = recorder();
    const sink = batchingSink(r.transport, { isEnabled: () => enabled, batchMs: 10 });
    sink.track("identity.create");
    enabled = false;
    await wait(30);
    expect(r.tracked).toEqual([]);
    expect(r.flushes()).toBe(0);
  });

  test("discard drops the waiting batch and its timer", async () => {
    const r = recorder();
    const sink = batchingSink(r.transport, { isEnabled: () => true, batchMs: 10 });
    sink.track("identity.create");
    sink.discard();
    sink.flush();
    await wait(30);
    expect(r.tracked).toEqual([]);
  });
});

describe("opting out", () => {
  afterEach(() => {
    setUsageEnabled(false);
    setUsageSink(null);
  });

  test("discards events tracked but not yet sent", async () => {
    const r = recorder();
    const sink = batchingSink(r.transport, { batchMs: 10 });
    setUsageSink(sink);
    setUsageEnabled(true);
    track({ name: "slate.sign" });
    setUsageEnabled(false);
    setUsageEnabled(true);
    await wait(30);
    expect(r.tracked).toEqual([]);
  });
});

describe("what goes over the wire", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("one request: the events, the build and the environment, nothing else", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      return new Response(null, { status: 202 });
    }) as typeof fetch;

    const client = new Client({
      endpoint: "https://collector.example",
      ingestKey: "ek1.openslate.web.test",
      release: "abc1234",
      environment: "production",
      usageFlushMs: 60 * 60_000,
    });
    const sink = batchingSink(client, { isEnabled: () => true, batchMs: 60 * 60_000 });
    sink.track("page.view", { route: "/race/$key" });
    sink.track("results.export", { format: "csv" });
    sink.flush();
    await wait(0);

    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.url).toBe("https://collector.example/u/ek1.openslate.web.test");
    expect(request?.init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(request?.init.body))).toEqual({
      events: [
        { event: "page.view", dims: { route: "/race/$key" } },
        { event: "results.export", dims: { format: "csv" } },
      ],
      release: "abc1234",
      environment: "production",
    });
  });
});
