import { describe, expect, test } from "bun:test";
import { buildSlate, type Position } from "@openslate/core";
import { type MyPublishedSlate, myPositionsByRace } from "../src/lib/published";

const ME = "ed25519:7MAyr61uQe1HksFFqJAxGsjH1kksQ1FEVx7iC27sf6dB";
const OTHER_ME = "ed25519:7MAyr61uQe1HksFFqJAxGsjH1kksQ1FEVx7iC27sf6dC";
const E = "2026-11-03";

const governor = { title: "Governor", kind: "race", jurisdiction: "us/ca", election: E };
const propA = { title: "Prop A", kind: "measure", jurisdiction: "us/ca/sf", election: E };

function signed(
  token: string,
  publishedAt: string,
  positions: Position[],
  issuer = ME,
): MyPublishedSlate {
  return {
    token,
    issuerKey: issuer,
    publishedAt,
    payload: buildSlate({
      issuer: { key: issuer, name: "Me" },
      issuedAt: publishedAt,
      positions,
    }),
  };
}

describe("myPositionsByRace", () => {
  test("newest slate per identity speaks for a race; other races keep older slates", () => {
    const older = signed("t1", "2026-10-01T00:00:00Z", [
      { subject: governor, stance: "endorse", choice: "Ada" },
      { subject: propA, stance: "oppose", choice: "No", statement: "Too costly" },
    ]);
    const newer = signed("t2", "2026-10-15T00:00:00Z", [
      { subject: governor, stance: "lean_for", choice: "Bob" },
      { subject: governor, stance: "oppose", choice: "Ada" },
    ]);
    const twin = signed(
      "t3",
      "2026-10-02T00:00:00Z",
      [{ subject: governor, stance: "endorse", choice: "Cy" }],
      OTHER_ME,
    );
    const byRace = myPositionsByRace([older, newer, twin]);

    const gov = byRace.get("t:Governor|j:us/ca|e:2026-11-03") ?? [];
    expect(gov.map((p) => [p.issuerKey, p.stance, p.choice, p.token])).toEqual([
      [ME, "lean_for", "Bob", "t2"],
      [ME, "oppose", "Ada", "t2"],
      [OTHER_ME, "endorse", "Cy", "t3"],
    ]);
    expect(gov[0]?.issuerName).toBe("Me");

    const prop = byRace.get("t:Prop A|j:us/ca/sf|e:2026-11-03") ?? [];
    expect(prop).toHaveLength(1);
    expect(prop[0]).toMatchObject({ stance: "oppose", choice: "No", statement: "Too costly" });
  });

  test("empty in, empty out", () => {
    expect(myPositionsByRace([]).size).toBe(0);
  });
});
