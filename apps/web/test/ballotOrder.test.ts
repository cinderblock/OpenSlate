import { describe, expect, test } from "bun:test";
import { ballotOrderFor, compareByAlphabet, sortParts } from "../src/lib/ballotOrder";
import { CA_DISTRICTS_2026 } from "../src/lib/ballotOrderCa";
import type { Area } from "../src/lib/jurisdictions";

const ALPHABET = "HXKWCPJOZALDNSQBIRYGVEFMTU";
const ELECTION = "2026-11-03";
const inAd = (ad: string, more: Record<string, string> = {}): Area => ({
  localities: [],
  districts: { "us/ca/ad": ad, ...more },
});
const governor = { election: ELECTION, jurisdiction: "us/ca", title: "Governor of California" };

describe("sortParts", () => {
  test("last name first, then first, then middle", () => {
    expect(sortParts("Xavier Becerra")).toEqual(["BECERRA", "XAVIER", ""]);
    expect(sortParts("Tony K. Thurmond")).toEqual(["THURMOND", "TONY", "K"]);
  });
  test("drops nicknames, suffixes and accents; keeps a particle with the last name", () => {
    expect(sortParts('Robert "Bob" Smith Jr.')).toEqual(["SMITH", "ROBERT", ""]);
    expect(sortParts("Kevin de León")).toEqual(["DELEON", "KEVIN", ""]);
    expect(sortParts("Mary-Kate O'Neil")).toEqual(["ONEIL", "MARYKATE", ""]);
  });
});

describe("compareByAlphabet", () => {
  test("letter by letter in the drawn order (the SoS's Campbell / Carlson example)", () => {
    // M is drawn 24th, R 18th: Carlson first.
    expect(compareByAlphabet(ALPHABET, "Ann Carlson", "Bo Campbell")).toBeLessThan(0);
    expect(compareByAlphabet(ALPHABET, "Steve Hilton", "Xavier Becerra")).toBeLessThan(0);
  });
  test("a shorter last name that the longer one starts with comes first", () => {
    expect(compareByAlphabet(ALPHABET, "Ann Ma", "Ann Mack")).toBeLessThan(0);
  });
  test("same last name: the first name decides", () => {
    expect(compareByAlphabet(ALPHABET, "Hal Lee", "Ann Lee")).toBeLessThan(0);
  });
});

describe("ballotOrderFor", () => {
  const names = ["Xavier Becerra", "Steve Hilton"];

  test("statewide: the drawn order in AD 1, rotated once per Assembly district", () => {
    expect(ballotOrderFor(governor, names, inAd("1"))).toEqual({
      basis: "ballot",
      names: ["Steve Hilton", "Xavier Becerra"],
    });
    expect(ballotOrderFor(governor, names, inAd("2"))?.names).toEqual([
      "Xavier Becerra",
      "Steve Hilton",
    ]);
    expect(ballotOrderFor(governor, names, inAd("17"))?.names).toEqual([
      "Steve Hilton",
      "Xavier Becerra",
    ]);
  });

  test("three names rotate one place per district", () => {
    const three = ["Ann Becker", "Ann Hale", "Ann Kim"]; // drawn: Hale, Kim, Becker
    expect(ballotOrderFor(governor, three, inAd("1"))?.names).toEqual([
      "Ann Hale",
      "Ann Kim",
      "Ann Becker",
    ]);
    expect(ballotOrderFor(governor, three, inAd("3"))?.names).toEqual([
      "Ann Becker",
      "Ann Hale",
      "Ann Kim",
    ]);
  });

  test("statewide without an Assembly district: the order varies", () => {
    const order = ballotOrderFor(governor, names, undefined);
    expect(order?.basis).toBe("varies");
    expect(order?.names).toEqual(names);
  });

  test("Congress rotates over the Assembly districts it reaches, lowest first", () => {
    const [cd, ads] = Object.entries(CA_DISTRICTS_2026.cd).find(
      ([n, list]) => list.length >= 2 && !CA_DISTRICTS_2026.cdUnsure[n],
    ) as [string, number[]];
    const race = {
      election: ELECTION,
      jurisdiction: `us/ca/cd-${cd}`,
      title: `US House, District ${cd}`,
    };
    expect(ballotOrderFor(race, names, inAd(String(ads[0])))?.names).toEqual([
      "Steve Hilton",
      "Xavier Becerra",
    ]);
    expect(ballotOrderFor(race, names, inAd(String(ads[1])))?.names).toEqual([
      "Xavier Becerra",
      "Steve Hilton",
    ]);
  });

  test("Congress: an Assembly district behind an unsure sliver varies", () => {
    const entry = Object.entries(CA_DISTRICTS_2026.cdUnsure).find(([n, unsure]) =>
      (CA_DISTRICTS_2026.cd[n] ?? []).some((ad) => ad > Math.min(...unsure)),
    );
    if (!entry) return;
    const [cd, unsure] = entry;
    const after = (CA_DISTRICTS_2026.cd[cd] ?? []).find((ad) => ad > Math.min(...unsure)) as number;
    const race = { election: ELECTION, jurisdiction: `us/ca/cd-${cd}`, title: "x" };
    expect(ballotOrderFor(race, names, inAd(String(after)))?.basis).toBe("varies");
  });

  test("Assembly: the drawn order within one county, unknown across counties", () => {
    const single = Object.entries(CA_DISTRICTS_2026.adCounties).find(
      ([, c]) => c.length === 1,
    )?.[0];
    const multi = Object.entries(CA_DISTRICTS_2026.adCounties).find(([, c]) => c.length > 1)?.[0];
    const race = (n: string | undefined) => ({
      election: ELECTION,
      jurisdiction: `us/ca/ad-${n}`,
      title: "x",
    });
    expect(ballotOrderFor(race(single), names, undefined)?.names).toEqual([
      "Steve Hilton",
      "Xavier Becerra",
    ]);
    expect(ballotOrderFor(race(multi), names, undefined)?.basis).toBe("varies");
  });

  test("Board of Equalization rotates like Congress", () => {
    const [n, ads] = Object.entries(CA_DISTRICTS_2026.boe)[0] as [string, number[]];
    const race = {
      election: ELECTION,
      jurisdiction: "us/ca",
      title: `California State Board of Equalization, District ${n}`,
    };
    const first = ads.find((ad) => !(CA_DISTRICTS_2026.boeUnsure[n] ?? []).some((u) => u <= ad));
    expect(ballotOrderFor(race, names, inAd(String(first)))?.basis).toBe(
      first === ads[0] ? "ballot" : "varies",
    );
    // Not AD 1's statewide rotation: its own.
    expect(ballotOrderFor(race, names, inAd("1"))?.basis).toBe(
      ads.includes(1) ? "ballot" : "varies",
    );
  });

  test("no rule: measures, retention questions, local races, other elections", () => {
    expect(ballotOrderFor({ ...governor, kind: "measure" }, names, inAd("1"))).toBeUndefined();
    expect(ballotOrderFor({ ...governor, retention: true }, names, inAd("1"))).toBeUndefined();
    expect(
      ballotOrderFor({ ...governor, jurisdiction: "us/ca/san-francisco" }, names, inAd("1")),
    ).toBeUndefined();
    expect(
      ballotOrderFor({ ...governor, election: "2024-11-05" }, names, inAd("1")),
    ).toBeUndefined();
  });
});
