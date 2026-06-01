import { describe, expect, test } from "bun:test";
import type { Subject } from "@openslate/core";
import { electionPhase, upcomingChipLabel } from "../src/lib/election-phase";

const NOW = new Date("2026-05-31T12:00:00Z");

function subj(election?: string): Subject {
  return election ? { title: "x", election } : { title: "x" };
}

describe("electionPhase", () => {
  test("no election field → unknown", () => {
    expect(electionPhase(subj(), NOW).kind).toBe("unknown");
  });

  test("garbage election → unknown", () => {
    expect(electionPhase(subj("not a date"), NOW).kind).toBe("unknown");
  });

  test("future date → upcoming with positive daysUntil", () => {
    const phase = electionPhase(subj("2026-11-03"), NOW);
    expect(phase.kind).toBe("upcoming");
    if (phase.kind === "upcoming") expect(phase.daysUntil).toBe(156);
  });

  test("past date → past with positive daysAgo", () => {
    const phase = electionPhase(subj("2024-11-05"), NOW);
    expect(phase.kind).toBe("past");
    if (phase.kind === "past") expect(phase.daysAgo).toBeGreaterThan(500);
  });

  test("same UTC day → today", () => {
    expect(electionPhase(subj("2026-05-31"), NOW).kind).toBe("today");
  });

  test("RFC 3339 datetime also parses", () => {
    expect(electionPhase(subj("2026-11-03T05:00:00.000Z"), NOW).kind).toBe("upcoming");
  });
});

describe("upcomingChipLabel", () => {
  test("election today", () => {
    expect(upcomingChipLabel(electionPhase(subj("2026-05-31"), NOW))).toBe("Election today");
  });

  test("election tomorrow uses singular", () => {
    expect(upcomingChipLabel(electionPhase(subj("2026-06-01"), NOW))).toBe("Election tomorrow");
  });

  test("within 7 days uses 'in N days'", () => {
    expect(upcomingChipLabel(electionPhase(subj("2026-06-05"), NOW))).toBe("Election in 5 days");
  });

  test("8-60 day window still uses 'in N days'", () => {
    expect(upcomingChipLabel(electionPhase(subj("2026-07-15"), NOW))).toBe("Election in 45 days");
  });

  test("far future falls back to date", () => {
    expect(upcomingChipLabel(electionPhase(subj("2027-11-02"), NOW))).toMatch(
      /Scheduled 2027-11-02/,
    );
  });

  test("past / unknown → null", () => {
    expect(upcomingChipLabel(electionPhase(subj("2024-11-05"), NOW))).toBeNull();
    expect(upcomingChipLabel(electionPhase(subj(), NOW))).toBeNull();
  });
});
