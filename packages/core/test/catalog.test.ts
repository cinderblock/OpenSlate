import { describe, expect, test } from "bun:test";
import { racesByJurisdiction } from "../src/catalog";
import type { SlatePayload } from "../src/schema";

const E = "2026-11-03";

function payload(
  positions: SlatePayload["positions"],
  context?: SlatePayload["context"],
): SlatePayload {
  return {
    v: 1,
    issuer: { key: "ed25519:x" },
    issued_at: "2026-10-24T00:00:00Z",
    positions,
    ...(context ? { context } : {}),
  } as SlatePayload;
}

describe("racesByJurisdiction", () => {
  test("counts distinct races per jurisdiction", () => {
    const gov = { title: "Governor", kind: "race", jurisdiction: "us/ca", election: E };
    const board = { title: "Board", kind: "race", jurisdiction: "us/ca/sf", election: E };
    expect(
      racesByJurisdiction(
        payload([
          { subject: gov, stance: "endorse", choice: "Alice" },
          { subject: board, stance: "endorse", choice: "Bob" },
          // A second pick in the same race is still one race.
          { subject: board, stance: "endorse", choice: "Carol" },
        ]),
      ),
    ).toEqual({ "us/ca": 1, "us/ca/sf": 1 });
  });

  test("falls back to the slate's context, then to none", () => {
    const mayor = { title: "Mayor", kind: "race", election: E };
    const prop = { title: "Prop A", kind: "measure", election: E };
    expect(
      racesByJurisdiction(
        payload(
          [
            { subject: mayor, stance: "endorse", choice: "Dana" },
            { subject: prop, stance: "endorse", choice: "Yes" },
          ],
          { election: E, jurisdiction: "us/ca/oakland" },
        ),
      ),
    ).toEqual({ "us/ca/oakland": 2 });
    expect(racesByJurisdiction(payload([{ subject: mayor, stance: "neutral" }]))).toEqual({
      "": 1,
    });
  });
});
