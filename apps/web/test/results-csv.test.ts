import { describe, expect, test } from "bun:test";
import type { Position, Race, SlatePayload } from "@openslate/core";
import { slateToCsv, suggestCsvFilename } from "../src/lib/results-csv";

function makePosition(
  title: string,
  stance: Position["stance"],
  choice?: string,
  extra: Partial<Position["subject"]> = {},
): Position {
  return {
    subject: { title, ...extra },
    stance,
    choice,
  };
}

function makeRace(
  id: number,
  name: string,
  winner: string,
  winnerPct?: number,
  reporting?: number,
): Race {
  return {
    id,
    election_name: name,
    percent_reporting: reporting,
    candidates: [
      { name: winner, winner: true, percent: winnerPct },
      { name: "Other", winner: false, percent: winnerPct ? 100 - winnerPct : undefined },
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

describe("slateToCsv", () => {
  test("emits a header row + one row per position", () => {
    const csv = slateToCsv(
      payload({
        positions: [
          makePosition("Mayor", "endorse", "Jane"),
          makePosition("Prop 12", "oppose", "Yes"),
        ],
      }),
      [makeRace(1, "Mayor 2024", "Jane", 55.5, 100), makeRace(2, "Prop 12", "No", 60, 100)],
    );
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("subject_title");
    expect(lines[1]).toContain("Mayor,,,,endorse,Jane,1,Mayor 2024,Jane,55.50,100.0,win");
    expect(lines[2]).toContain("Prop 12,,,,oppose,Yes,2,Prop 12,No,60.00,100.0,win");
  });

  test("quotes fields containing commas / quotes / newlines", () => {
    const csv = slateToCsv(
      payload({
        positions: [makePosition('Race "with quotes", commas', "endorse", "X,Y")],
      }),
      [undefined],
    );
    const dataLine = csv.split("\r\n")[1] ?? "";
    expect(dataLine).toContain('"Race ""with quotes"", commas"');
    expect(dataLine).toContain('"X,Y"');
  });

  test("missing race → unresolved outcome, blank race columns", () => {
    const csv = slateToCsv(payload({ positions: [makePosition("Mayor", "endorse", "Jane")] }), [
      undefined,
    ]);
    const dataLine = csv.split("\r\n")[1] ?? "";
    expect(dataLine).toContain(",,,,,,unresolved");
  });

  test("includes subject id / jurisdiction / election when populated", () => {
    const csv = slateToCsv(
      payload({
        positions: [
          makePosition("Mayor", "endorse", "Jane", {
            id: "vip:abc",
            jurisdiction: "us/ca/sf",
            election: "2024-11-05",
          }),
        ],
      }),
      [makeRace(1, "Mayor", "Jane", 60, 100)],
    );
    expect(csv).toContain("vip:abc");
    expect(csv).toContain("us/ca/sf");
    expect(csv).toContain("2024-11-05");
  });
});

describe("suggestCsvFilename", () => {
  test("uses issuer name + election date", () => {
    const name = suggestCsvFilename(
      payload({
        issuer: { key: "k", name: "Jane Voter" },
        context: { election: "2024-11-05" },
      }),
    );
    expect(name).toBe("openslate-jane-voter-2024-11-05.csv");
  });

  test("prefers attribution.of.name when present", () => {
    const name = suggestCsvFilename(
      payload({
        issuer: { key: "k", name: "Researcher" },
        attribution: {
          of: { name: "Sierra Club" },
          mode: "scraped",
          retrieved_at: "2024-01-01T00:00:00Z",
        },
      }),
    );
    expect(name).toContain("sierra-club");
  });

  test("falls back to issued_at date when no context.election", () => {
    const name = suggestCsvFilename(
      payload({
        issuer: { key: "k", name: "Jane Voter" },
        issued_at: "2026-05-31T00:00:00Z",
      }),
    );
    expect(name).toBe("openslate-jane-voter-2026-05-31.csv");
  });

  test("falls back to 'slate' when names are missing", () => {
    const name = suggestCsvFilename(payload({ issuer: { key: "k" } }));
    expect(name).toContain("openslate-slate-");
  });
});
