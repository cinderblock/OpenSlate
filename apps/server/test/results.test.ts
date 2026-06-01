import { describe, expect, test } from "bun:test";
import { LIVE_TTL_MS, SETTLED_TTL_MS, deriveTtl } from "../src/results";

describe("deriveTtl", () => {
  test("/race/{id} with percent_reporting < 100 → live", () => {
    expect(deriveTtl("/race/26131", '{"id":26131,"percent_reporting":62.5}')).toBe(LIVE_TTL_MS);
  });

  test("/race/{id} with percent_reporting === 100 → settled", () => {
    expect(deriveTtl("/race/26131", '{"id":26131,"percent_reporting":100}')).toBe(SETTLED_TTL_MS);
  });

  test("/race/{id} with no percent_reporting field → settled", () => {
    expect(deriveTtl("/race/26131", '{"id":26131}')).toBe(SETTLED_TTL_MS);
  });

  test("/race/{id} returning SVG (non-JSON) → live", () => {
    expect(deriveTtl("/race/26131", "<svg xmlns=...></svg>")).toBe(LIVE_TTL_MS);
  });

  test("/race/search → settled regardless of body", () => {
    expect(deriveTtl("/race/search", '{"count":1,"races":[]}')).toBe(SETTLED_TTL_MS);
  });

  test("/race/{id}/history → settled (path-shape check)", () => {
    expect(deriveTtl("/race/26131/history", '["2026-01-01T00:00:00Z"]')).toBe(SETTLED_TTL_MS);
  });

  test("/getElectionYears → settled", () => {
    expect(deriveTtl("/getElectionYears", '["2026","2025"]')).toBe(SETTLED_TTL_MS);
  });

  test("/getElectionDates → settled", () => {
    expect(deriveTtl("/getElectionDates", '{"year":2026,"dates":[]}')).toBe(SETTLED_TTL_MS);
  });
});
