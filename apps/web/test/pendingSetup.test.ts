import { describe, expect, test } from "bun:test";
import {
  addPending,
  type PendingSetup,
  pendingEntries,
  settlePending,
} from "../src/lib/pendingSetup";
import type { CatalogEntry } from "../src/lib/query";
import { sourceIdOf } from "../src/lib/sources";

const URL_ = "https://example.org/index.json";

function entry(slug: string): CatalogEntry {
  return {
    slug,
    election: "2026-11-03",
    path: `orgs/${slug}/2026-11-03/signed.slate`,
    issuer: { key: "ed25519:R" },
    attribution: { of: { name: slug, uri: `https://${slug}.example.org` } },
    positions: 3,
    issued_at: "2026-10-24T00:00:00Z",
  } as CatalogEntry;
}

const path = (slug: string) => entry(slug).path;

function pending(slugs: string[], picks: PendingSetup["picks"] = {}): PendingSetup {
  return { catalogUrl: URL_, paths: slugs.map(path), picks };
}

describe("addPending", () => {
  test("starts fresh when nothing is pending", () => {
    const next = pending(["a"], { [path("a")]: "follow" });
    expect(addPending(null, next)).toEqual(next);
  });

  test("keeps what an earlier download still has to fetch; the newest standing wins", () => {
    const current = pending(["a", "b"], { [path("a")]: "follow" });
    const next = pending(["b", "c"], { [path("a")]: "disagree", [path("c")]: "follow" });
    expect(addPending(current, next)).toEqual({
      catalogUrl: URL_,
      paths: [path("a"), path("b"), path("c")],
      picks: { [path("a")]: "disagree", [path("c")]: "follow" },
    });
  });

  test("a bundle download stays one", () => {
    const current = { ...pending(["a"]), bundle: true };
    expect(addPending(current, pending(["b"])).bundle).toBe(true);
  });

  test("another catalog's download replaces it", () => {
    const next = { ...pending(["b"]), catalogUrl: "https://other.example/index.json" };
    expect(addPending(pending(["a"]), next)).toEqual(next);
  });
});

describe("settlePending", () => {
  test("drops settled paths and their picks", () => {
    const current = pending(["a", "b"], { [path("a")]: "follow", [path("b")]: "disagree" });
    expect(settlePending(current, [path("a")])).toEqual(
      pending(["b"], { [path("b")]: "disagree" }),
    );
  });

  test("null once everything is settled", () => {
    expect(settlePending(pending(["a"]), [path("a")])).toBeNull();
    expect(settlePending(null, [path("a")])).toBeNull();
  });
});

describe("pendingEntries", () => {
  test("the catalog's entries for what's pending, skipping gone and removed sources", () => {
    const catalog = ["a", "b", "c"].map(entry);
    const removed = new Set([sourceIdOf(entry("c"))]);
    const result = pendingEntries(pending(["a", "gone", "c"]), catalog, removed);
    expect(result.map((e) => e.slug)).toEqual(["a"]);
  });
});
