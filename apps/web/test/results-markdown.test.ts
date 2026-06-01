import { describe, expect, test } from "bun:test";
import type { Position, Race, SlatePayload } from "@openslate/core";
import { slateToMarkdown } from "../src/lib/results-markdown";

function makePosition(title: string, stance: Position["stance"], choice?: string): Position {
  return {
    subject: { title },
    stance,
    choice,
  };
}

function makeRace(winner: string, winnerPct = 60, reporting = 100): Race {
  return {
    id: 1,
    election_name: "Mayor 2024",
    percent_reporting: reporting,
    candidates: [
      { name: winner, winner: true, percent: winnerPct },
      { name: "Other", winner: false, percent: 100 - winnerPct },
    ],
  };
}

function payload(overrides: Partial<SlatePayload> = {}): SlatePayload {
  return {
    v: 1,
    issuer: { key: "ed25519:test", name: "Jane Voter" },
    issued_at: "2026-05-31T00:00:00Z",
    positions: [],
    ...overrides,
  };
}

describe("slateToMarkdown", () => {
  test("firsthand slate leads with issuer name", () => {
    const md = slateToMarkdown(payload({ positions: [makePosition("Mayor", "endorse", "Jane")] }), [
      makeRace("Jane"),
    ]);
    expect(md).toContain("# Results for Jane Voter");
    expect(md).toContain("✅ win");
    expect(md).toContain("| Mayor | endorse | Jane | Jane (60.0%) | 100.0% | ✅ win |");
  });

  test("secondhand slate leads with reported entity + attribution sub-line", () => {
    const md = slateToMarkdown(
      payload({
        issuer: { key: "k", name: "Researcher" },
        attribution: {
          of: { name: "Sierra Club" },
          mode: "scraped",
          retrieved_at: "2024-01-01T00:00:00Z",
        },
        positions: [makePosition("Mayor", "endorse", "Jane")],
      }),
      [makeRace("Jane")],
    );
    expect(md).toContain("# Results reported for Sierra Club");
    expect(md).toContain("Secondhand report signed by Researcher");
    expect(md).toContain("scraped");
  });

  test("escapes pipe characters in cells", () => {
    const md = slateToMarkdown(
      payload({ positions: [makePosition("Pipes | here", "endorse", "Carol")] }),
      [makeRace("Carol")],
    );
    expect(md).toContain("Pipes \\| here");
  });

  test("missing race renders ❓ not matched and dashes", () => {
    const md = slateToMarkdown(payload({ positions: [makePosition("Mayor", "endorse", "Jane")] }), [
      undefined,
    ]);
    expect(md).toContain("❓ not matched");
    expect(md).toContain("| Mayor | endorse | Jane | — | — | ❓ not matched |");
  });

  test("oppose-the-loser renders as ✅ win", () => {
    const md = slateToMarkdown(payload({ positions: [makePosition("Mayor", "oppose", "Other")] }), [
      makeRace("Jane"),
    ]);
    expect(md).toContain("✅ win");
  });

  test("includes civicAPI attribution footer", () => {
    const md = slateToMarkdown(payload({ positions: [makePosition("Mayor", "endorse", "Jane")] }), [
      makeRace("Jane"),
    ]);
    expect(md).toContain("Source: civicAPI");
    expect(md).toContain("OpenSlate");
  });
});
