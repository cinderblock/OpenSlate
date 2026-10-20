import { describe, expect, test } from "bun:test";
import { parseCensusRelay, parseNominatim } from "../src/lib/lookups";

describe("parseNominatim", () => {
  test("keeps the point, label and state (recorded answer, trimmed)", () => {
    const answer = [
      {
        lat: "37.4441997",
        lon: "-122.1596747",
        display_name:
          "Palo Alto City Hall, 250, Hamilton Avenue, University South, Palo Alto, Santa Clara County, California, 94301, United States",
        address: { state: "California", "ISO3166-2-lvl4": "US-CA" },
      },
      { lat: "nope", lon: "-1" },
    ];
    expect(parseNominatim(answer)).toEqual([
      {
        label:
          "Palo Alto City Hall, 250, Hamilton Avenue, University South, Palo Alto, Santa Clara County, California, 94301, United States",
        lon: -122.1596747,
        lat: 37.4441997,
        state: "CA",
      },
    ]);
  });

  test("an error object is not a list of results", () => {
    expect(() => parseNominatim({ error: "Bad request" })).toThrow();
  });
});

describe("parseCensusRelay", () => {
  test("carries the official districts through", () => {
    const matches = parseCensusRelay({
      matches: [
        {
          address: "250 HAMILTON AVE, PALO ALTO, CA, 94301",
          lon: -122.160542,
          lat: 37.444812,
          state: "CA",
          districts: { cd: "16", sd: "13", ad: "23" },
          county: "Santa Clara",
          place: "Palo Alto",
        },
      ],
      source: "US Census Bureau Geocoder",
    });
    expect(matches).toEqual([
      {
        label: "250 HAMILTON AVE, PALO ALTO, CA, 94301",
        lon: -122.160542,
        lat: 37.444812,
        state: "CA",
        districts: { cd: "16", sd: "13", ad: "23" },
        county: "Santa Clara",
        place: "Palo Alto",
      },
    ]);
    expect(parseCensusRelay({ matches: [] })).toEqual([]);
    expect(() => parseCensusRelay({ error: "x" })).toThrow();
  });
});
