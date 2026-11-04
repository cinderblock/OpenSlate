import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CA_2026_GENERAL } from "@openslate/core/recordSchedule";
import { answerTtl, recordedFile } from "../src/recorded";
import { Recorder, type RecorderEnv } from "../src/recorder";

const fixtures = join(import.meta.dir, "../../../packages/core/test/fixtures");
const fixture = (name: string) => readFileSync(join(fixtures, name), "utf8");

/** Durable Object state over bun:sqlite, alarms and sockets in memory. */
function fakeState() {
  const db = new Database(":memory:");
  let alarm: number | null = null;
  const sent: string[] = [];
  const sql = {
    exec(query: string, ...params: unknown[]) {
      const statements = query.split(";").filter((q) => q.trim());
      if (params.length === 0 && statements.length > 1) {
        db.exec(query);
        return { toArray: () => [] };
      }
      const rows = db.query(query).all(...(params as never[])) as Record<string, unknown>[];
      return { toArray: () => rows };
    },
  };
  return {
    sent,
    alarmAt: () => alarm,
    state: {
      storage: {
        sql,
        getAlarm: async () => alarm,
        setAlarm: async (at: number) => {
          alarm = at;
        },
      },
      setWebSocketAutoResponse() {},
      getWebSockets: () => [{ send: (m: string) => sent.push(m) }],
      acceptWebSocket() {},
    },
  };
}

function fakeBucket() {
  const objects = new Map<string, string>();
  return {
    objects,
    put: async (key: string, text: string) => {
      objects.set(key, text);
    },
    get: async (key: string) => {
      const text = objects.get(key);
      return text === undefined ? null : { text: async () => text };
    },
  };
}

const realFetch = globalThis.fetch;
const realNow = Date.now;
let asked: { url: string; headers: Record<string, string> }[] = [];

function serve(handler: (url: string, headers: Record<string, string>) => Response) {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = (init?.headers ?? {}) as Record<string, string>;
    asked.push({ url, headers });
    return handler(url, headers);
  }) as typeof fetch;
}

beforeEach(() => {
  asked = [];
  // Election night: checks every minute.
  Date.now = () => CA_2026_GENERAL.pollsClose + 60 * 60_000;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
});

function recorder() {
  const fake = fakeState();
  const bucket = fakeBucket();
  const env = { REPORTS: bucket } as unknown as RecorderEnv;
  const r = new Recorder(fake.state as unknown as DurableObjectState, env);
  return { r, fake, bucket };
}

describe("a county's recorder", () => {
  const csv = fixture("lvt-summary-orange.csv");
  const lastModified = "Wed, 04 Nov 2026 09:36:23 GMT";

  test("keeps the report, records each race, and asks only for a newer file next", async () => {
    const { r, fake, bucket } = recorder();
    serve((_url, headers) =>
      headers["If-Modified-Since"] === lastModified
        ? new Response(null, { status: 304 })
        : new Response(csv, {
            headers: { "Content-Type": "text/csv", "Last-Modified": lastModified, ETag: 'W/"c6"' },
          }),
    );
    await r.start("orange");
    expect(fake.alarmAt()).not.toBeNull();
    await r.alarm();

    expect(asked.map((a) => a.url)).toEqual([
      "https://www.livevoterturnout.com/ENR/orangecaenr/24/summary_24.csv",
    ]);
    expect(asked[0]?.headers["User-Agent"]).toContain("OpenSlate");
    expect([...bucket.objects.values()]).toEqual([csv]);
    const latest = await r.latest("summary_24.csv");
    expect(latest?.lastModified).toBe(Date.parse(lastModified));
    expect(latest?.version).toBe(Date.now());
    expect(JSON.parse(fake.sent.at(-1) ?? "{}")).toMatchObject({ type: "report", feed: "orange" });
    // Next check a minute later (election night).
    expect(fake.alarmAt()).toBe(Date.now() + 60_000);

    expect(await r.status()).toMatchObject({ feed: "orange", files: 1, absent: 0, error: null });
    const races = await r.history("county-ca/orange/no-such-race");
    expect(races).toBeNull();

    asked = [];
    await r.alarm();
    expect(asked[0]?.headers["If-Modified-Since"]).toBe(lastModified);
    expect(asked[0]?.headers["If-None-Match"]).toBe('W/"c6"');
    expect(bucket.objects.size).toBe(1);
    expect(JSON.parse(fake.sent.at(-1) ?? "{}")).toMatchObject({ type: "checked" });
  });
});

describe("the state's recorder", () => {
  const docs: Record<string, string> = {
    governor: fixture("sos-governor.json"),
    "ballot-measures": fixture("sos-ballot-measures.json"),
    "supreme-court": fixture("sos-supreme-court.json"),
    status: "{}",
    "us-rep/district/12": JSON.stringify({
      Reporting: "50% (1 of 2) precincts reporting",
      ReportingTime: "November 4, 2026, 8:08 a.m.",
      candidates: [
        { Name: "Lateefah Simon", Votes: "10" },
        { Name: "Jamie Joyce", Votes: "20" },
      ],
    }),
  };

  function serveState() {
    serve((url) => {
      const path = url.replace("https://api.sos.ca.gov/returns/", "");
      const doc = docs[path];
      // Every other district: not on this ballot.
      return doc ? Response.json(JSON.parse(doc)) : new Response("", { status: 500 });
    });
  }

  test("reads every document once, skips districts not on the ballot, records races", async () => {
    const { r } = recorder();
    serveState();
    await r.start("sos-ca");
    await r.alarm();
    const urls = asked.map((a) => a.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls.length).toBe(8 + 52 + 40 + 80 + 4 + 3);

    const house = await r.history("us-rep/district/12");
    expect(house).toEqual({
      names: ["Jamie Joyce", "Lateefah Simon"],
      points: [{ at: Date.parse("2026-11-04T16:08:00Z"), p: 50, v: [20, 10] }],
    });
    expect((await r.history("prop/1"))?.names).toEqual(["Yes", "No"]);
    // The catalog spells a justice without the middle initial.
    expect((await r.history("supreme-court/kelli-evans"))?.points).toHaveLength(1);
    expect(await r.latest("us-rep/district/13")).toBeNull();
  });

  test("a quick check reads only the governor's race when nothing moved", async () => {
    const { r } = recorder();
    serveState();
    await r.start("sos-ca");
    await r.alarm();
    // Settle: the files after a new report, twice more.
    await r.alarm();
    await r.alarm();
    asked = [];
    await r.alarm();
    expect(asked.map((a) => a.url)).toEqual(["https://api.sos.ca.gov/returns/governor"]);
  });

  test("a race's numbers that didn't change add no point", async () => {
    const { r } = recorder();
    serveState();
    await r.start("sos-ca");
    await r.alarm();
    Date.now = () => CA_2026_GENERAL.pollsClose + 2 * 60 * 60_000;
    docs["us-rep/district/12"] = (docs["us-rep/district/12"] ?? "")
      .replace('"20"', '"25"')
      .replace("8:08 a.m.", "9:08 a.m.");
    docs.governor = (docs.governor ?? "").replace("8:08 a.m.", "9:08 a.m.");
    await r.alarm();
    const house = await r.history("us-rep/district/12");
    expect(house?.points.map((p) => p.v)).toEqual([
      [20, 10],
      [25, 10],
    ]);
    expect((await r.history("prop/1"))?.points).toHaveLength(1);
  });
});

describe("the relay's answers", () => {
  test("which files the recorder may hold", () => {
    expect(recordedFile("/api/sos-ca/returns/governor")).toEqual({
      feed: "sos-ca",
      path: "governor",
    });
    expect(recordedFile("/api/county-ca/santa-clara/current_ver.txt")).toEqual({
      feed: "santa-clara",
      path: "current_ver.txt",
    });
    expect(recordedFile("/api/county-ca/santa-clara/../x")).toBeNull();
    expect(recordedFile("/api/county-ca/santa-clara/384997/json/en/summary.json")?.path).toBe(
      "384997/json/en/summary.json",
    );
    expect(recordedFile("/api/county-ca/orange/summary_24.csv")?.feed).toBe("orange");
    // A contest's per-county breakdown isn't kept: passed through without asking.
    expect(recordedFile("/api/sos-ca/returns/governor/county/santa-clara")).toBeNull();
    expect(recordedFile("/api/results/v2/race/1")).toBeNull();
  });

  test("good until the next report is in; by version, for an hour", () => {
    const now = 1_000_000;
    expect(answerTtl({ readyBy: now + 42_000 }, false, now)).toBe(42);
    expect(answerTtl({ readyBy: now - 5_000 }, false, now)).toBe(3);
    expect(answerTtl({ readyBy: now + 3_600_000 }, false, now)).toBe(60);
    expect(answerTtl({}, true, now)).toBe(3600);
  });
});
