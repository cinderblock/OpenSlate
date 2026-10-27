import { afterEach, describe, expect, test } from "bun:test";
import {
  sanitizeUsageEvent,
  setUsageEnabled,
  setUsageSink,
  track,
  USAGE_SCHEMA,
  type UsageEvent,
  usageEnabled,
} from "../src/lib/usage";

/** Every event the schema allows: each combination of its dims' values. */
function allAllowedEvents(): Array<{ name: string; dims?: Record<string, string> }> {
  const out: Array<{ name: string; dims?: Record<string, string> }> = [];
  for (const [name, dims] of Object.entries(USAGE_SCHEMA)) {
    const entries = Object.entries(dims as Record<string, readonly string[]>);
    if (entries.length === 0) {
      out.push({ name });
      continue;
    }
    let combos: Array<Record<string, string>> = [{}];
    for (const [key, values] of entries) {
      combos = combos.flatMap((combo) => values.map((value) => ({ ...combo, [key]: value })));
    }
    for (const combo of combos) out.push({ name, dims: combo });
  }
  return out;
}

describe("USAGE_SCHEMA", () => {
  test("dim values are identifiers, never free text", () => {
    for (const dims of Object.values(USAGE_SCHEMA)) {
      for (const values of Object.values(dims as Record<string, readonly string[]>)) {
        for (const value of values) expect(value).toMatch(/^[a-z0-9/$._-]+$/);
      }
    }
  });
});

describe("sanitizeUsageEvent", () => {
  test("passes every allowed event through unchanged", () => {
    for (const event of allAllowedEvents()) {
      expect(sanitizeUsageEvent(event.name, event.dims)).toEqual(event);
    }
  });

  test("returns a copy, not the caller's object", () => {
    const dims = { source: "catalog" };
    const clean = sanitizeUsageEvent("slate.import", dims);
    expect(clean?.dims).not.toBe(dims);
  });

  test("drops unknown and inherited event names", () => {
    for (const name of ["slate.vote", "", "__proto__", "constructor", "toString", 42, null]) {
      expect(sanitizeUsageEvent(name, undefined)).toBeNull();
    }
  });

  test("drops values outside the closed list", () => {
    expect(sanitizeUsageEvent("slate.import", { source: "Jane Doe" })).toBeNull();
    expect(sanitizeUsageEvent("page.view", { route: "/race/Governor of California" })).toBeNull();
    expect(sanitizeUsageEvent("results.export", { format: "CSV" })).toBeNull();
    expect(sanitizeUsageEvent("results.export", { format: " csv" })).toBeNull();
  });

  test("drops extra, missing and non-string dims", () => {
    expect(sanitizeUsageEvent("slate.import", { source: "catalog", choice: "yes" })).toBeNull();
    expect(sanitizeUsageEvent("slate.import", {})).toBeNull();
    expect(sanitizeUsageEvent("slate.import", undefined)).toBeNull();
    expect(sanitizeUsageEvent("slate.import", { source: ["catalog"] })).toBeNull();
    expect(
      sanitizeUsageEvent("slate.import", { source: { toString: () => "catalog" } }),
    ).toBeNull();
    expect(sanitizeUsageEvent("slate.import", ["catalog"])).toBeNull();
    expect(sanitizeUsageEvent("slate.import", "catalog")).toBeNull();
  });

  test("drops dims on an event that has none", () => {
    expect(sanitizeUsageEvent("identity.create", { stance: "endorse" })).toBeNull();
    expect(sanitizeUsageEvent("identity.create", {})).toBeNull();
  });

  test("drops dims that only look right through the prototype", () => {
    const inherited = Object.create({ source: "catalog" });
    expect(sanitizeUsageEvent("slate.import", inherited)).toBeNull();
    const nullProto = Object.assign(Object.create(null), { source: "catalog" });
    expect(sanitizeUsageEvent("slate.import", nullProto)).toBeNull();
  });
});

describe("track", () => {
  const sent: Array<[string, Record<string, string> | undefined]> = [];
  setUsageSink({ track: (name, dims) => sent.push([name, dims]) });

  afterEach(() => {
    sent.length = 0;
    setUsageEnabled(false);
  });

  test("sends nothing until the user opts in", () => {
    expect(usageEnabled()).toBe(false);
    track({ name: "identity.create" });
    expect(sent).toEqual([]);
  });

  test("sends allowed events once opted in, and stops when opted out", () => {
    setUsageEnabled(true);
    track({ name: "slate.import", dims: { source: "qr" } });
    setUsageEnabled(false);
    track({ name: "identity.create" });
    expect(sent).toEqual([["slate.import", { source: "qr" }]]);
  });

  test("drops an event forged past the types", () => {
    setUsageEnabled(true);
    track({
      name: "slate.import",
      dims: { source: "catalog", candidate: "Jane Doe" },
    } as unknown as UsageEvent);
    track({
      name: "page.view",
      dims: { route: "/race/Governor of California" },
    } as unknown as UsageEvent);
    track({ name: "ballot.choice", dims: { choice: "Yes on 1" } } as unknown as UsageEvent);
    expect(sent).toEqual([]);
  });
});
