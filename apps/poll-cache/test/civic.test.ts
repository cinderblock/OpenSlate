import { afterEach, describe, expect, test } from "bun:test";
import {
  CIVIC_ELECTIONS_PATH,
  CIVIC_VOTERINFO_PATH,
  civicCors,
  handleCivicElections,
  handleCivicVoterInfo,
} from "../src/civic";
import worker from "../src/index";

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stub Google: answer `body` with `status`; return the requests made. */
function stubGoogle(body: unknown, status = 200, headers: Record<string, string> = {}): Request[] {
  const seen: Request[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    seen.push(new Request(input, init));
    return new Response(JSON.stringify(body), { status, headers });
  }) as typeof fetch;
  return seen;
}

const voterInfo = {
  election: { id: "9000", electionDay: "2026-11-03" },
  normalizedInput: { state: "CA" },
  contests: [
    {
      office: "Governor",
      district: { name: "California", scope: "statewide" },
      candidates: [{ name: "Xavier Becerra", party: "Democratic" }],
    },
  ],
};

function post(body: unknown) {
  return new Request(`https://polls.example${CIVIC_VOTERINFO_PATH}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("handleCivicVoterInfo", () => {
  test("relays the address to Google with the key and returns the normalized ballot", async () => {
    const seen = stubGoogle(voterInfo);
    const res = await handleCivicVoterInfo(
      post({ address: "  1 Dr Carlton B Goodlett Pl,\n SF ", electionId: "9000" }),
      { key: "KEY" },
      {},
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const ballot = (await res.json()) as { state: string; contests: Array<{ subject: unknown }> };
    expect(ballot.state).toBe("ca");
    expect(ballot.contests[0]?.subject).toMatchObject({ title: "Governor", kind: "race" });

    const url = new URL(seen[0]?.url ?? "");
    expect(url.pathname).toBe("/civicinfo/v2/voterinfo");
    expect(url.searchParams.get("address")).toBe("1 Dr Carlton B Goodlett Pl, SF");
    expect(url.searchParams.get("electionId")).toBe("9000");
    expect(url.searchParams.get("key")).toBe("KEY");
  });

  test("501 without a key, and nothing sent", async () => {
    const seen = stubGoogle(voterInfo);
    const res = await handleCivicVoterInfo(post({ address: "x" }), {}, {});
    expect(res.status).toBe(501);
    expect(seen).toHaveLength(0);
  });

  test("rejects a bad request before asking Google", async () => {
    const seen = stubGoogle(voterInfo);
    for (const body of [
      {},
      { address: "x".repeat(201) },
      { address: "x", electionId: "a&b" },
      "{",
    ]) {
      expect((await handleCivicVoterInfo(post(body), { key: "KEY" }, {})).status).toBe(400);
    }
    const get = new Request(`https://polls.example${CIVIC_VOTERINFO_PATH}?address=x`);
    expect((await handleCivicVoterInfo(get, { key: "KEY" }, {})).status).toBe(405);
    expect(seen).toHaveLength(0);
  });

  test("passes Google's reason on for a bad address", async () => {
    stubGoogle({ error: { code: 400, message: "Failed to parse address" } }, 400);
    const res = await handleCivicVoterInfo(post({ address: "nowhere" }), { key: "KEY" }, {});
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toBe(
      "Google answered 400: Failed to parse address",
    );
  });
});

test("a bad relay key is the relay's problem, not the address's", async () => {
  stubGoogle(
    { error: { code: 400, message: "API key not valid. Please pass a valid API key." } },
    400,
  );
  const res = await handleCivicVoterInfo(post({ address: "x" }), { key: "bad" }, {});
  expect(res.status).toBe(502);
});

describe("handleCivicElections", () => {
  const get = () => new Request(`https://polls.example${CIVIC_ELECTIONS_PATH}`);

  test("trims the list and keeps Google's cache header", async () => {
    stubGoogle(
      { elections: [{ id: "9000", name: "General", electionDay: "2026-11-03", extra: 1 }] },
      200,
      { "Cache-Control": "private, max-age=600" },
    );
    const res = await handleCivicElections(get(), { key: "KEY" }, {});
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=600");
    expect(await res.json()).toEqual({
      elections: [{ id: "9000", name: "General", electionDay: "2026-11-03" }],
    });
  });

  test("an hour's cache when Google sends no header", async () => {
    stubGoogle({ elections: [] });
    const res = await handleCivicElections(get(), { key: "KEY" }, {});
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  test("501 without a key", async () => {
    expect((await handleCivicElections(get(), {}, {})).status).toBe(501);
  });
});

describe("civicCors", () => {
  test("names an allowed origin, or a local dev server", () => {
    const allowed = ["https://openslate.us"];
    expect(civicCors("https://openslate.us", allowed, "GET")["Access-Control-Allow-Origin"]).toBe(
      "https://openslate.us",
    );
    expect(civicCors("http://localhost:5173", allowed, "GET")["Access-Control-Allow-Origin"]).toBe(
      "http://localhost:5173",
    );
  });
  test("says nothing to other origins", () => {
    for (const origin of ["https://evil.example", "https://localhost.evil.example", null]) {
      expect(civicCors(origin, ["https://openslate.us"], "GET")).toEqual({ Vary: "Origin" });
    }
  });
});

describe("the worker", () => {
  const env = { GOOGLE_CIVIC_API_KEY: "KEY", CIVIC_ALLOWED_ORIGINS: "https://openslate.us" };

  test("answers the voterinfo preflight for an allowed origin", async () => {
    const res = await worker.fetch(
      new Request(`https://polls.example${CIVIC_VOTERINFO_PATH}`, {
        method: "OPTIONS",
        headers: { Origin: "https://openslate.us" },
      }),
      env,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://openslate.us");
    expect(res.headers.get("Access-Control-Allow-Methods")).toBe("POST, OPTIONS");
  });

  test("health says whether it can ask Google", async () => {
    const health = async (e: typeof env | Record<string, never>) =>
      (await (await worker.fetch(new Request("https://polls.example/api/health"), e)).json()) as {
        civic: boolean;
      };
    expect((await health(env)).civic).toBe(true);
    expect((await health({})).civic).toBe(false);
  });
});
