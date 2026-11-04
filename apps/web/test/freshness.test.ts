import { describe, expect, test } from "bun:test";
import { FRESH_GRACE_MS, isOutOfDate } from "../src/lib/freshness";

describe("a live count's freshness", () => {
  const every = 60_000;
  test("current until its next check is overdue by the grace period", () => {
    expect(isOutOfDate(1_000, 1_000 + every, every)).toBe(false);
    expect(isOutOfDate(1_000, 1_000 + every + FRESH_GRACE_MS, every)).toBe(false);
    expect(isOutOfDate(1_000, 1_000 + every + FRESH_GRACE_MS + 1, every)).toBe(true);
  });

  test("a count never fetched isn't called out of date (it's still loading)", () => {
    expect(isOutOfDate(0, 10 * every, every)).toBe(false);
  });

  test("on waking, any overdue count is checked at once (no grace)", () => {
    expect(isOutOfDate(1_000, 1_000 + every + 1, every, 0)).toBe(true);
  });
});
