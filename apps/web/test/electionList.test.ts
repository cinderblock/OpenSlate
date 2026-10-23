import { describe, expect, test } from "bun:test";
import type { SlatePayload, Subject } from "@openslate/core";
import { electionEntries } from "../src/lib/electionList";

const TODAY = "2026-10-23";

function payload(subjects: Subject[], context?: { election: string }): SlatePayload {
  return {
    v: 1,
    issuer: { key: "ed25519:A", name: "A" },
    issued_at: "2026-10-01T00:00:00Z",
    ...(context ? { context } : {}),
    positions: subjects.map((subject) => ({ subject, stance: "endorse" })),
  } as SlatePayload;
}

describe("electionEntries", () => {
  test("a slate's dated elections list without Google", () => {
    const slates = [
      payload([{ title: "Governor", election: "2026-11-03" }]),
      payload([{ title: "Prop 1" }], { election: "2026-11-03" }),
    ];
    expect(electionEntries([], slates, [], TODAY)).toEqual([
      {
        id: "2026-11-03",
        electionDay: "2026-11-03",
        sources: { google: false, slates: 2, drafts: 0 },
        past: false,
      },
    ]);
  });

  test("a slate counts once per election, by Google id or date", () => {
    const google = [{ id: "9000", name: "General", electionDay: "2026-11-03" }];
    const slates = [
      payload([
        { title: "Governor", id: "vip:9000:gov", election: "2026-11-03" },
        { title: "Treasurer", election: "2026-11-03" },
      ]),
    ];
    const [entry] = electionEntries(google, slates, ["2026-11-03", "2026-11-03"], TODAY);
    expect(entry?.id).toBe("9000");
    expect(entry?.sources).toEqual({ google: true, slates: 1, drafts: 2 });
  });

  test("past elections and undated ids", () => {
    const entries = electionEntries([], [], ["2024-11-05", "legacy-id"], TODAY);
    expect(entries.map((e) => [e.id, e.past])).toEqual([
      ["2024-11-05", true],
      ["legacy-id", undefined],
    ]);
  });
});
