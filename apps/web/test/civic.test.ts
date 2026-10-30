import { afterEach, describe, expect, test } from "bun:test";
import { civicBallot, civicElections, civicProblemReport } from "../src/lib/civic";
import { LookupUnavailableError, parseConsents } from "../src/lib/lookups";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stub `fetch` with one answer; returns each call's URL and init. */
function stubFetch(body: unknown, status = 200): Array<{ url: string; init?: RequestInit }> {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), ...(init ? { init } : {}) });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return calls;
}

const voterInfo = {
  election: { id: "9000", electionDay: "2026-11-03" },
  normalizedInput: { state: "CA" },
  contests: [{ office: "Governor", district: { name: "California", scope: "statewide" } }],
};

describe("with your own key", () => {
  test("the ballot lookup goes straight to Google, naming only our origin", async () => {
    const calls = stubFetch(voterInfo);
    const ballot = await civicBallot("key", "MYKEY", "1 Main St, Oakland, CA");
    expect(ballot.state).toBe("ca");
    const url = new URL(calls[0]?.url ?? "");
    expect(url.host).toBe("civicinfo.googleapis.com");
    expect(url.searchParams.get("key")).toBe("MYKEY");
    expect(url.searchParams.get("address")).toBe("1 Main St, Oakland, CA");
    expect(calls[0]?.init?.referrerPolicy).toBe("origin");
    expect(calls[0]?.init?.cache).toBe("no-store");
  });

  test("Google's reason comes back as the error", async () => {
    stubFetch(
      { error: { code: 400, message: "API key not valid. Please pass a valid API key." } },
      400,
    );
    await expect(civicElections("key", "BAD")).rejects.toThrow(
      "Google answered 400: API key not valid. Please pass a valid API key.",
    );
  });
});

describe("through OpenSlate", () => {
  test("the address goes in a POST body to the relay, with no key", async () => {
    const calls = stubFetch({ contests: [], state: "ca" });
    expect(await civicBallot("relay", "", "1 Main St")).toEqual({ contests: [], state: "ca" });
    expect(calls[0]?.url).toBe("/api/civic/voterinfo");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init?.body))).toEqual({ address: "1 Main St" });
  });

  test("the relay's error message comes back as the error", async () => {
    stubFetch({ error: "this relay has no Google key, so it can't ask Google" }, 501);
    await expect(civicElections("relay", "")).rejects.toThrow("this relay has no Google key");
  });

  test("the elections list", async () => {
    const calls = stubFetch({
      elections: [{ id: "9000", name: "General", electionDay: "2026-11-03" }],
    });
    expect(await civicElections("relay", "")).toEqual([
      { id: "9000", name: "General", electionDay: "2026-11-03" },
    ]);
    expect(calls[0]?.url).toBe("/api/civic/elections");
  });
});

describe("when the relay can't answer", () => {
  test("a spent quota or an edge rate limit is unavailable, not a bug", async () => {
    for (const status of [429, 503]) {
      stubFetch({ error: "used up for now" }, status);
      await expect(civicBallot("relay", "", "1 Main St")).rejects.toBeInstanceOf(
        LookupUnavailableError,
      );
    }
  });

  test("so is a request that never gets an answer", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(civicBallot("relay", "", "1 Main St")).rejects.toBeInstanceOf(
      LookupUnavailableError,
    );
  });

  test("a broken relay stays a reportable error", async () => {
    stubFetch({ error: "Google answered 400: API key not valid" }, 502);
    const failure = await civicBallot("relay", "", "1 Main St").catch((err: unknown) => err);
    expect(failure).toBeInstanceOf(Error);
    expect(failure).not.toBeInstanceOf(LookupUnavailableError);
  });
});

describe("parseConsents", () => {
  test("the old self-hosted server consent becomes the relay one", () => {
    expect(
      parseConsents({ server: "2026-10-20T00:00:00Z", census: "2026-10-21T00:00:00Z" }),
    ).toEqual({
      google: "2026-10-20T00:00:00Z",
      census: "2026-10-21T00:00:00Z",
    });
  });
  test("keeps known lookups and drops the rest", () => {
    expect(parseConsents({ "google-key": "t", junk: "x", osm: 3 })).toEqual({ "google-key": "t" });
    expect(parseConsents(null)).toBeUndefined();
  });
});

describe("civicProblemReport", () => {
  test("names the lookup and route, and never a key", () => {
    const report = civicProblemReport(
      "ballot",
      "relay",
      "Google answered 403: key AIzaSyD-abcdefghijklmnopqrstuvwxyz12 is blocked",
    );
    expect(report).toContain("Lookup: the ballot lookup for an address");
    expect(report).toContain("Route: through OpenSlate's relay");
    expect(report).toContain("Error: Google answered 403: key [a key] is blocked");
    expect(report).not.toContain("AIza");
  });
});
