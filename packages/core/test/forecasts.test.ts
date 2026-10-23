import { describe, expect, test } from "bun:test";
import { inferKalshiEventTickers } from "../src/forecasts";

const election = "2026-11-03";

describe("inferKalshiEventTickers", () => {
  test("a statewide race gets the state's tickers", () => {
    expect(
      inferKalshiEventTickers({ title: "Governor of California", jurisdiction: "us/ca", election }),
    ).toEqual(["KXGOVCA-26", "GOVPARTYCA-26", "KXGOVCAPRIMARY-26"]);
  });

  test("a House race gets its district's tickers from the jurisdiction", () => {
    expect(
      inferKalshiEventTickers({
        title: "US House of Representatives, California District 10",
        jurisdiction: "us/ca/cd-10",
        election,
      }),
    ).toEqual(["KXCA10-26", "HOUSECA10-26", "KXCA10PRIMARY-26"]);
  });

  test("races that only look like a statewide one get nothing", () => {
    for (const subject of [
      { title: "Lieutenant Governor of California", jurisdiction: "us/ca" },
      { title: "California State Senate, District 10", jurisdiction: "us/ca/sd-10" },
      { title: "Huntington Beach City Attorney", jurisdiction: "us/ca/huntington-beach" },
      {
        title: "Los Angeles Community College District Board, Seat 4",
        jurisdiction: "us/ca/los-angeles",
      },
    ]) {
      expect(inferKalshiEventTickers({ ...subject, election })).toEqual([]);
    }
  });
});
