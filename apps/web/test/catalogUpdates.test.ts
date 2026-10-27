import { describe, expect, test } from "bun:test";
import type { SlatePayload } from "@openslate/core";
import {
  missingNews,
  type StoredSlate,
  staleImports,
  updateProblem,
} from "../src/lib/catalogUpdates";
import { EMPTY_AREA } from "../src/lib/jurisdictions";
import type { CatalogEntry } from "../src/lib/query";

const RESEARCHER = "ed25519:R";
const OF = { name: "Sierra Club California", kind: "organization" };

function payload(issuedAt: string, overrides: Partial<SlatePayload> = {}): SlatePayload {
  return {
    v: 1,
    issuer: { key: RESEARCHER },
    issued_at: issuedAt,
    context: { election: "2026-11-03", jurisdiction: "us/ca" },
    attribution: { of: OF, mode: "scraped", retrieved_at: "2026-10-01T00:00:00Z" },
    positions: [],
    ...overrides,
  };
}

function stored(token: string, p: SlatePayload): StoredSlate {
  return { token, payload: p };
}

function entry(issuedAt: string, overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    slug: "sierra-club-california",
    election: "2026-11-03",
    path: "orgs/sierra-club-california/2026-11-03/signed.slate",
    issuer: { key: RESEARCHER },
    attribution: { of: OF, mode: "scraped", retrieved_at: "2026-10-01T00:00:00Z" },
    positions: 4,
    scope: "us/ca",
    issued_at: issuedAt,
    ...overrides,
  };
}

describe("staleImports", () => {
  test("a newer entry replaces the slate the user has", () => {
    const mine = [stored("t1", payload("2026-10-20T00:00:00Z"))];
    const updates = staleImports(mine, [entry("2026-10-25T00:00:00Z")]);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ replaces: ["t1"], since: "2026-10-20T00:00:00Z" });
  });

  test("nothing to do when the entry is the same age or older", () => {
    const mine = [stored("t1", payload("2026-10-25T00:00:00Z"))];
    expect(staleImports(mine, [entry("2026-10-25T00:00:00Z")])).toEqual([]);
    expect(staleImports(mine, [entry("2026-10-20T00:00:00Z")])).toEqual([]);
  });

  test("compares instants, not strings", () => {
    // 01:00 at -08:00 is 09:00Z: later than 08:00Z though it sorts first as text.
    const mine = [stored("t1", payload("2026-10-25T08:00:00.000Z"))];
    expect(staleImports(mine, [entry("2026-10-25T01:00:00-08:00")])).toHaveLength(1);
  });

  test("replaces every copy the user has of the stream, judged by the newest", () => {
    const mine = [
      stored("t1", payload("2026-10-20T00:00:00Z")),
      stored("t2", payload("2026-10-22T00:00:00Z")),
    ];
    const [update] = staleImports(mine, [entry("2026-10-25T00:00:00Z")]);
    expect(update?.replaces.sort()).toEqual(["t1", "t2"]);
    expect(update?.since).toBe("2026-10-22T00:00:00Z");
  });

  test("leaves streams the user never imported alone", () => {
    expect(staleImports([], [entry("2026-10-25T00:00:00Z")])).toEqual([]);
  });

  test("another signer's report on the same source is a different stream", () => {
    const mine = [stored("t1", payload("2026-10-20T00:00:00Z", { issuer: { key: "ed25519:X" } }))];
    expect(staleImports(mine, [entry("2026-10-25T00:00:00Z")])).toEqual([]);
  });

  test("the same source in another election or place is a different stream", () => {
    const mine = [stored("t1", payload("2026-10-20T00:00:00Z"))];
    expect(staleImports(mine, [entry("2026-10-25T00:00:00Z", { scope: "us/ca/sf" })])).toEqual([]);
    expect(staleImports(mine, [entry("2026-10-25T00:00:00Z", { election: "2026-06-02" })])).toEqual(
      [],
    );
  });

  test("a firsthand slate matches by its signer alone", () => {
    const firsthand = payload("2026-10-20T00:00:00Z", { attribution: undefined });
    const { attribution: _, ...rest } = entry("2026-10-25T00:00:00Z");
    expect(staleImports([stored("t1", firsthand)], [rest])).toHaveLength(1);
  });
});

describe("updateProblem", () => {
  const [update] = staleImports(
    [stored("t1", payload("2026-10-20T00:00:00Z"))],
    [entry("2026-10-25T00:00:00Z")],
  );
  if (!update) throw new Error("expected an update");

  test("accepts the entry's newer slate", () => {
    expect(updateProblem(update, payload("2026-10-25T00:00:00Z"))).toBeUndefined();
  });

  test("rejects another signer's slate", () => {
    const other = payload("2026-10-25T00:00:00Z", { issuer: { key: "ed25519:X" } });
    expect(updateProblem(update, other)).toBe("signed by a different key");
  });

  test("rejects a slate for another source", () => {
    const other = payload("2026-10-25T00:00:00Z", {
      attribution: {
        of: { name: "Someone else" },
        mode: "scraped",
        retrieved_at: "2026-10-01T00:00:00Z",
      },
    });
    expect(updateProblem(update, other)).toBe("not the slate the catalog lists");
  });

  test("rejects a slate no newer than the user's", () => {
    expect(updateProblem(update, payload("2026-10-20T00:00:00Z"))).toBe(
      "not newer than the one you have",
    );
  });
});

describe("missingNews", () => {
  const news = entry("2026-10-25T00:00:00Z", {
    slug: "calmatters",
    path: "orgs/calmatters/2026-11-03/signed.slate",
    attribution: {
      of: { name: "CalMatters" },
      mode: "scraped",
      retrieved_at: "2026-10-01T00:00:00Z",
    },
    positions: 0,
    articles: 12,
    jurisdictions: { "us/ca": 12 },
  });
  const mine = [stored("t1", payload("2026-10-20T00:00:00Z"))];
  const none = { area: EMPTY_AREA, removed: new Set<string>() };

  test("news coverage for an election the user has, that they don't", () => {
    expect(missingNews(mine, [news], none)).toEqual([news]);
  });

  test("not endorsements, not another election, not one they have", () => {
    expect(missingNews(mine, [entry("2026-10-25T00:00:00Z")], none)).toEqual([]);
    expect(missingNews(mine, [{ ...news, election: "2026-06-02" }], none)).toEqual([]);
    const had = stored(
      "t2",
      payload("2026-10-20T00:00:00Z", {
        attribution: {
          of: { name: "CalMatters" },
          mode: "scraped",
          retrieved_at: "2026-10-01T00:00:00Z",
        },
      }),
    );
    expect(missingNews([...mine, had], [news], none)).toEqual([]);
  });

  test("not a source the user removed", () => {
    expect(missingNews(mine, [news], { ...none, removed: new Set(["of:calmatters"]) })).toEqual([]);
  });
});
