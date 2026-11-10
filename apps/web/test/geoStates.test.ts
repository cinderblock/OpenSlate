import { describe, expect, test } from "bun:test";
import type { Feature, FeatureCollection } from "geojson";
import { topology } from "topojson-server";
import type { Topology } from "topojson-specification";
import {
  areaFromHit,
  decodeStateGeo,
  decodeStateOutlines,
  locate,
  mergeFoundArea,
  shapeAt,
  statesAt,
} from "../src/lib/geo";
import type { Area } from "../src/lib/jurisdictions";

/**
 * What other states' boundary files hold that California's doesn't
 * (scripts/build-geo.ts): districts with letters or names for ids, a chamber
 * that isn't there, counties that aren't called counties, and a state on
 * both sides of the 180th meridian. Each on a made-up state of squares.
 */

const square = (
  id: string,
  [x0, y0, x1, y1]: [number, number, number, number],
  name?: string,
): Feature => ({
  type: "Feature",
  id,
  properties: name ? { name } : {},
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
        [x0, y0],
      ],
    ],
  },
});

const layer = (...features: Feature[]): FeatureCollection => ({
  type: "FeatureCollection",
  features,
});

function state(
  layers: Partial<Record<"cd" | "sd" | "ad" | "county" | "place", FeatureCollection>>,
  metadata: Record<string, unknown> = {},
): Topology {
  const built = topology({
    cd: layers.cd ?? layer(),
    sd: layers.sd ?? layer(),
    ad: layers.ad ?? layer(),
    county: layers.county ?? layer(),
    place: layers.place ?? layer(),
  }) as Topology & { metadata?: unknown };
  built.metadata = { vintage: "test", ...metadata };
  return built;
}

const NO_OPTIONS = { localities: [], districts: {} };

describe("a state that names and letters its districts", () => {
  // Two halves: west and east of longitude -72.
  const west: [number, number, number, number] = [-73, 44, -72, 45];
  const east: [number, number, number, number] = [-72, 44, -71, 45];
  const geo = decodeStateGeo(
    "us/vt",
    state({
      cd: layer(square("1", [-73, 44, -71, 45])),
      sd: layer(square("addison", west, "Addison"), square("washington", east, "Washington")),
      ad: layer(square("orleans-3", west, "Orleans-3"), square("35a", east, "35A")),
      county: layer(square("Addison", west), square("Washington", east)),
    }),
  );

  test("a point's districts are their ids, whatever shape those take", () => {
    expect(locate(geo, -72.5, 44.5)?.districts).toEqual({
      cd: "1",
      sd: "addison",
      ad: "orleans-3",
    });
    expect(locate(geo, -71.5, 44.5)?.districts).toEqual({
      cd: "1",
      sd: "washington",
      ad: "35a",
    });
  });

  test("the shape keeps the name its id stands for", () => {
    expect(shapeAt(geo, "sd", -72.5, 44.5)?.name).toBe("Addison");
    expect(shapeAt(geo, "ad", -71.5, 44.5)?.name).toBe("35A");
  });

  test("the area files them under the state's own families", () => {
    const hit = locate(geo, -72.5, 44.5);
    if (!hit) throw new Error("no hit");
    // Vermont's lower chamber is a House: `hd`, not California's `ad`.
    expect(areaFromHit(hit, "us/vt", NO_OPTIONS).area.districts).toEqual({
      "us/vt/cd": "1",
      "us/vt/sd": "addison",
      "us/vt/hd": "orleans-3",
    });
  });
});

describe("a state with one chamber", () => {
  const all: [number, number, number, number] = [-100, 40, -98, 42];
  const geo = decodeStateGeo(
    "us/ne",
    state({
      cd: layer(square("3", all)),
      sd: layer(square("46", all)),
      county: layer(square("Wheeler", all)),
    }),
  );

  test("the missing chamber is an empty layer, not an error", () => {
    expect(geo.layers.ad).toEqual([]);
    expect(locate(geo, -99, 41)?.districts).toEqual({ cd: "3", sd: "46" });
  });

  test("its one chamber is the legislature's: `ld`", () => {
    const hit = locate(geo, -99, 41);
    if (!hit) throw new Error("no hit");
    expect(areaFromHit(hit, "us/ne", NO_OPTIONS).area.districts).toEqual({
      "us/ne/cd": "3",
      "us/ne/ld": "46",
    });
  });
});

describe("counties that aren't called counties", () => {
  const all: [number, number, number, number] = [-91, 29, -89, 31];
  const geo = decodeStateGeo(
    "us/la",
    state({
      cd: layer(square("2", all)),
      county: layer(square("Orleans", all, "Orleans Parish")),
      place: layer(square("New Orleans", all)),
    }),
  );

  test("the hit carries the county's own name", () => {
    const hit = locate(geo, -90, 30);
    expect(hit?.county).toBe("Orleans");
    expect(hit?.countyName).toBe("Orleans Parish");
    if (!hit) throw new Error("no hit");
    expect(areaFromHit(hit, "us/la", NO_OPTIONS).places).toEqual(["New Orleans", "Orleans Parish"]);
  });
});

describe("a state across the 180th meridian", () => {
  // As the build writes Alaska: everything west of -180, in one piece.
  const mainland: [number, number, number, number] = [-170, 50, -130, 70];
  const farIslands: [number, number, number, number] = [-188, 51, -180, 53];
  const geo = decodeStateGeo(
    "us/ak",
    state(
      {
        cd: layer(square("1", [-188, 50, -130, 70])),
        sd: layer(square("s", farIslands, "S"), square("a", mainland, "A")),
        county: layer(
          square("Aleutians West", farIslands, "Aleutians West Census Area"),
          square("Anchorage", mainland, "Anchorage Municipality"),
        ),
      },
      { wrap: true },
    ),
  );

  test("a point east of the meridian is found where the file put it", () => {
    // Attu, at 172.9° east.
    const attu = locate(geo, 172.9, 52.9);
    expect(attu?.county).toBe("Aleutians West");
    expect(attu?.districts).toEqual({ cd: "1", sd: "s" });
    expect(shapeAt(geo, "county", 172.9, 52.9)?.id).toBe("Aleutians West");
  });

  test("a point west of it is found as ever", () => {
    expect(locate(geo, -149.9, 61.2)?.county).toBe("Anchorage");
    expect(locate(geo, -149.9, 61.2)?.countyName).toBe("Anchorage Municipality");
  });

  test("a state that doesn't wrap leaves eastern longitudes alone", () => {
    const guam = decodeStateGeo(
      "us/gu",
      state({
        cd: layer(square("1", [144, 13, 145, 14])),
        county: layer(square("Guam", [144, 13, 145, 14])),
      }),
    );
    expect(locate(guam, 144.7, 13.4)?.county).toBe("Guam");
    expect(locate(geo, 144.7, 13.4)).toBeNull();
  });
});

describe("a lookup in another state", () => {
  const california: Area = {
    localities: ["us/ca/sf", "us/ca/ebmud"],
    districts: { "us/ca/cd": "11", "us/ca/ad": "17", "us/ca/bart": "8", "us/ca/elsd": "34410" },
    labels: { "us/ca/elsd": "San Francisco Unified" },
    answers: { "us/ca/sf/council-3": true },
  };
  const texas: Area = {
    localities: ["us/tx/austin"],
    districts: { "us/tx/cd": "37", "us/tx/sd": "14", "us/tx/hd": "49" },
    found: ["us/tx/austin", "us/tx/travis-county"],
  };

  test("replaces where the voter votes: nothing of the old state is left", () => {
    expect(mergeFoundArea(california, texas)).toEqual(texas);
  });

  test("with the state's boundaries too", () => {
    const geo = decodeStateGeo(
      "us/tx",
      state({
        cd: layer(square("37", [-98, 30, -97, 31])),
        county: layer(square("Travis", [-98, 30, -97, 31])),
        place: layer(square("Austin", [-98, 30, -97, 31])),
      }),
    );
    expect(mergeFoundArea(california, texas, geo)).toEqual(texas);
  });

  test("in the same state, without its boundaries: districts set by hand stay, places are the lookup's", () => {
    const again: Area = {
      localities: ["us/ca/oakland"],
      districts: { "us/ca/cd": "12", "us/ca/ad": "18" },
    };
    const merged = mergeFoundArea(california, again);
    // BART isn't something a lookup finds; EBMUD can't be told from a city without the maps.
    expect(merged.localities).toEqual(["us/ca/oakland"]);
    expect(merged.districts).toEqual({ "us/ca/cd": "12", "us/ca/ad": "18", "us/ca/bart": "8" });
    expect(merged.labels).toBeUndefined();
    expect(merged.answers).toEqual({ "us/ca/sf/council-3": true });
  });
});

describe("which state a point is in", () => {
  const outlines = decodeStateOutlines(
    topology({
      state: layer(
        square("us/ca", [-124, 32, -114, 42]),
        square("us/nv", [-114, 35, -110, 42]),
        // As the build writes it: west of -180.
        square("us/ak", [-188, 51, -130, 71]),
      ),
    }) as Topology,
  );

  test("the state it's inside", () => {
    expect(statesAt(outlines, -120, 37)).toEqual(["us/ca"]);
    expect(statesAt(outlines, -112, 39)).toEqual(["us/nv"]);
    expect(statesAt(outlines, -80, 40)).toEqual([]);
  });

  test("near a border: the one it's in, then its neighbour", () => {
    // 5 km inside California, by the Nevada line.
    expect(statesAt(outlines, -114.05, 39)).toEqual(["us/ca", "us/nv"]);
    // 50 km in: California alone.
    expect(statesAt(outlines, -114.6, 39)).toEqual(["us/ca"]);
  });

  test("Alaska from either side of the 180th meridian", () => {
    expect(statesAt(outlines, -150, 61)).toEqual(["us/ak"]);
    expect(statesAt(outlines, 172.9, 52.9)).toEqual(["us/ak"]);
  });
});
