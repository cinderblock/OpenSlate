import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { neighbors } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import {
  areaFromHit,
  COURT_OF_APPEAL_BY_COUNTY,
  cityPaths,
  decodeStateGeo,
  fourColor,
  localityCandidates,
  locate,
  lookupsAt,
  mergeFoundArea,
  touching,
} from "../src/lib/geo";
import { placeRace } from "../src/lib/jurisdictions";

// The real shipped file: these points are checked against the Census
// geocoder's answers for the same addresses (2026-10-20).
const topology = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "public", "geo", "us-ca.topo.json"), "utf8"),
) as Topology;
const geo = decodeStateGeo("us/ca", topology);

describe("locate (shipped California boundaries)", () => {
  const cases = [
    [
      "SF City Hall",
      -122.41831,
      37.778536,
      { cd: "11", sd: "11", ad: "17" },
      "San Francisco",
      "San Francisco",
    ],
    [
      "Santa Rosa (CD 1 since Prop 50)",
      -122.712414,
      38.438218,
      { cd: "1", sd: "2", ad: "2" },
      "Sonoma",
      "Santa Rosa",
    ],
    [
      "Palm Springs",
      -116.511784,
      33.823239,
      { cd: "48", sd: "19", ad: "47" },
      "Riverside",
      "Palm Springs",
    ],
    [
      "Palo Alto (SD 13)",
      -122.160542,
      37.444812,
      { cd: "16", sd: "13", ad: "23" },
      "Santa Clara",
      "Palo Alto",
    ],
    [
      "LA City Hall",
      -118.245594,
      34.051623,
      { cd: "34", sd: "26", ad: "54" },
      "Los Angeles",
      "Los Angeles",
    ],
  ] as const;
  for (const [name, lon, lat, districts, county, place] of cases) {
    test(name, () => {
      const hit = locate(geo, lon, lat);
      expect(hit?.districts).toEqual(districts);
      expect(hit?.county).toBe(county);
      expect(hit?.place).toBe(place);
    });
  }

  test("has every district", () => {
    expect(geo.layers.cd).toHaveLength(52);
    expect(geo.layers.sd).toHaveLength(40);
    expect(geo.layers.ad).toHaveLength(80);
    expect(geo.layers.county).toHaveLength(58);
  });

  test("finds school, BOE, college and supervisorial districts, as their sources do", () => {
    // Checked 2026-10-24/25 against the Census geocoder (schools) and point
    // queries of each source service (the rest): plans/sub-county-districts.md.
    // Huntington Beach: an elementary and a high school district, no unified one.
    expect(locate(geo, -117.998, 33.668)?.lookups).toEqual({
      unsd: { id: "none" },
      elsd: { id: "18030", name: "Huntington Beach City Elementary School District" },
      scsd: { id: "18060", name: "Huntington Beach Union High School District" },
      boe: { id: "4" },
      ccd: { id: "830", name: "Coast Community College District" },
      sup: { id: "Orange|1" },
    });
    const at = (lon: number, lat: number) => {
      const found = locate(geo, lon, lat)?.lookups ?? {};
      return Object.fromEntries(Object.entries(found).map(([layer, { id }]) => [layer, id]));
    };
    expect(at(-122.41831, 37.778536)).toMatchObject({ unsd: "34410", boe: "2", ccd: "360" });
    expect(at(-118.245594, 34.051623)).toMatchObject({
      unsd: "22710",
      ccd: "740",
      sup: "Los Angeles|1",
    });
    expect(at(-117.3795, 33.1959)).toMatchObject({ ccd: "50", sup: "San Diego|5" }); // Oceanside
    expect(at(-122.3255, 37.563)).toMatchObject({ ccd: "370", sup: "San Mateo|2" }); // San Mateo
    expect(at(-121.8863, 37.3382)).toMatchObject({ ccd: "470", sup: "Santa Clara|2" }); // San Jose
    expect(geo.lookups.unsd).toHaveLength(346);
    expect(geo.lookups.elsd).toHaveLength(517);
    expect(geo.lookups.scsd).toHaveLength(112);
    expect(geo.lookups.boe).toHaveLength(4);
    expect(geo.lookups.ccd).toHaveLength(72);
  });

  test("near a lookup layer's line, that layer is left unknown", () => {
    const line = geo.lookups.elsd.find((s) => s.id === "18030")?.polygons[0]?.[0]?.[0];
    if (!line) throw new Error("no HB City SD vertex");
    const [lon = 0, lat = 0] = line;
    const found = lookupsAt(geo, lon, lat, { county: "Orange" });
    expect(found?.lookups.elsd).toBeUndefined();
    expect(found?.nearLine).toContain("elsd");
    // SF City Hall is within 75 m of a supervisorial district line.
    expect(locate(geo, -122.41831, 37.778536)?.lookups?.sup).toBeUndefined();
  });

  test("finds city council districts, as their sources do", () => {
    // Checked 2026-10-27 against each source at full resolution
    // (plans/council-districts-lookup.md).
    const council = (lon: number, lat: number) => locate(geo, lon, lat)?.lookups?.council?.id;
    expect(council(-122.0197, 37.3998)).toBe("Sunnyvale|6"); // Lakewood
    expect(council(-122.0258, 37.3525)).toBe("Sunnyvale|3"); // Ortega Park
    expect(council(-121.8995, 37.3005)).toBe("San Jose|6"); // Willow Glen
    expect(council(-122.2517, 37.8442)).toBe("Oakland|1"); // Rockridge
    expect(council(-118.27, 34.0869)).toBe("Los Angeles|13"); // Silver Lake
    expect(council(-117.1297, 32.7479)).toBe("San Diego|3"); // North Park
    expect(council(-117.79, 33.677)).toBe("Irvine|5"); // Woodbridge
    expect(council(-122.487, 37.594)).toBe("Pacifica|4"); // Linda Mar
    // Newport Beach votes citywide on every district seat: no lookup.
    expect(geo.lookups.council.some((s) => s.id.startsWith("Newport Beach|"))).toBe(false);
    expect(council(-117.9298, 33.6189)).toBeUndefined();
  });

  test("council districts only for the city the point is in", () => {
    // A Sunnyvale point said to be in a city we have no council map for.
    expect(
      lookupsAt(geo, -122.0197, 37.3998, { county: "Santa Clara", place: "Cupertino" })?.lookups
        .council,
    ).toBeUndefined();
  });

  test("supervisorial districts only for the county the point is in", () => {
    // A Huntington Beach point said to be in a county we have no map for.
    expect(lookupsAt(geo, -117.998, 33.668, { county: "Inyo" })?.lookups.sup).toBeUndefined();
  });

  test("outside the state is null", () => {
    expect(locate(geo, -125.5, 36)).toBeNull(); // Pacific
    expect(locate(geo, -115, 36.2)).toBeNull(); // Las Vegas
  });

  test("unincorporated land has a county but no city", () => {
    // Inyo County, far from any city.
    const hit = locate(geo, -117.6, 36.6);
    expect(hit?.county).toBe("Inyo");
    expect(hit?.place).toBeUndefined();
  });
});

// A tiny synthetic state: two districts side by side, split at x = 1.
const square = (x0: number, x1: number) => [
  [x0, 0],
  [x1, 0],
  [x1, 1],
  [x0, 1],
  [x0, 0],
];
const tiny = decodeStateGeo("us/xx", {
  type: "Topology",
  bbox: [0, 0, 2, 1],
  arcs: [square(0, 1), square(1, 2), square(0, 2)],
  objects: Object.fromEntries(
    (["cd", "sd", "ad", "county", "place"] as const).map((layer) => [
      layer,
      {
        type: "GeometryCollection",
        geometries:
          layer === "cd"
            ? [
                { type: "Polygon", arcs: [[0]], id: "1" },
                { type: "Polygon", arcs: [[1]], id: "2" },
              ]
            : [{ type: "Polygon", arcs: [[2]], id: layer === "county" ? "Somewhere" : "7" }],
      },
    ]),
  ),
} as unknown as Topology);

describe("locate (synthetic)", () => {
  test("near a line is flagged, the middle isn't", () => {
    // 0.0003° of longitude at the equator is ~33 m from the x = 1 line.
    expect(locate(tiny, 0.9997, 0.5)?.nearLine).toContain("cd");
    expect(locate(tiny, 0.5, 0.5)?.nearLine).toEqual([]);
    expect(locate(tiny, 1.5, 0.5)?.districts.cd).toBe("2");
  });
});

describe("map colours", () => {
  test("no two districts or counties that touch, even at a corner, share a colour", () => {
    for (const layer of ["cd", "sd", "ad", "county"] as const) {
      const object = topology.objects[layer] as GeometryCollection;
      const adjacency = touching(topology, object);
      const shapes = geo.layers[layer];
      expect(shapes).toHaveLength(adjacency.length);
      // Touching includes every shared border.
      neighbors(object.geometries).forEach((next, i) => {
        for (const j of next) expect(adjacency[i]).toContain(j);
      });
      adjacency.forEach((next, i) => {
        for (const j of next) expect(shapes[i]?.color).not.toBe(shapes[j]?.color);
      });
      expect(Math.max(...shapes.map((s) => s.color))).toBeLessThan(4);
    }
  });

  test("Assembly 38 and 40 meet at a single point and get different colours", () => {
    const ad = geo.layers.ad;
    const color = (id: string) => ad.find((s) => s.id === id)?.color;
    expect(color("38")).not.toBe(color("40"));
  });

  const graph = (n: number, edges: [number, number][]) => {
    const adjacency: number[][] = Array.from({ length: n }, () => []);
    for (const [a, b] of edges) {
      adjacency[a]?.push(b);
      adjacency[b]?.push(a);
    }
    return adjacency;
  };

  test("fourColor needs all four on an odd wheel, and is deterministic", () => {
    // A hub (0) inside a ring of five: the ring alone needs three colours,
    // and the hub touches all of them.
    const edges: [number, number][] = [
      [0, 1],
      [0, 2],
      [0, 3],
      [0, 4],
      [0, 5],
      [1, 2],
      [2, 3],
      [3, 4],
      [4, 5],
      [5, 1],
    ];
    const colors = fourColor(graph(6, edges)) ?? [];
    for (const [a, b] of edges) expect(colors[a]).not.toBe(colors[b]);
    expect(new Set(colors).size).toBe(4);
    expect(fourColor(graph(6, edges))).toEqual(colors);
  });

  test("fourColor gives up on five regions that all touch", () => {
    const edges: [number, number][] = [];
    for (let a = 0; a < 5; a++) for (let b = a + 1; b < 5; b++) edges.push([a, b]);
    expect(fourColor(graph(5, edges))).toBeUndefined();
  });
});

describe("areaFromHit", () => {
  const known = {
    localities: ["us/ca/sf", "us/ca/los-angeles", "us/ca/los-angeles-county", "us/ca/marin"],
    districts: { "us/ca/cd": ["11"], "us/ca/sd": ["12"], "us/ca/bart": ["8"] },
  };

  test("sets every district (with no race too), the Court of Appeal, and known localities", () => {
    const sf = areaFromHit(
      {
        districts: { cd: "11", sd: "11", ad: "17" },
        county: "San Francisco",
        place: "San Francisco",
        nearLine: [],
      },
      "us/ca",
      known,
    );
    expect(sf.area).toEqual({
      localities: ["us/ca/sf"],
      districts: { "us/ca/cd": "11", "us/ca/sd": "11", "us/ca/ad": "17", "us/ca/coa": "1" },
      found: ["us/ca/sf", "us/ca/city-of-sf"],
    });
    expect(sf.notCovered).toEqual(["us/ca/bart"]);
    expect(sf.places).toEqual(["San Francisco"]);

    const la = areaFromHit(
      { districts: { cd: "34" }, county: "Los Angeles", place: "Los Angeles", nearLine: [] },
      "us/ca",
      known,
    );
    expect(la.area.localities).toEqual(["us/ca/los-angeles", "us/ca/los-angeles-county"]);
    expect(la.area.districts["us/ca/coa"]).toBe("2");
    expect(la.places).toEqual(["Los Angeles", "Los Angeles County"]);
  });

  test("sets lookup districts, with their names, and none where there is none", () => {
    const oc = { ...known, localities: [...known.localities, "us/ca/orange-county"] };
    const hb = areaFromHit(
      {
        districts: { cd: "42" },
        county: "Orange",
        nearLine: [],
        lookups: {
          unsd: { id: "none" },
          elsd: { id: "18030", name: "Huntington Beach City Elementary School District" },
          ccd: { id: "830", name: "Coast Community College District" },
          sup: { id: "Orange|1" },
        },
      },
      "us/ca",
      oc,
    );
    // Supervisorial districts under the county's path, as its races are filed.
    expect(hb.area.districts).toEqual({
      "us/ca/cd": "42",
      "us/ca/coa": "4",
      "us/ca/unsd": "none",
      "us/ca/elsd": "18030",
      "us/ca/ccd": "830",
      "us/ca/orange-county/sup": "1",
    });
    expect(hb.area.labels).toEqual({
      "us/ca/elsd": "Huntington Beach City Elementary School District",
      "us/ca/ccd": "Coast Community College District",
      "us/ca/orange-county/sup": "Orange County supervisorial district 1",
    });
    // Nothing imported is filed under the county yet: its supervisorial
    // district is still set, where its races would be.
    const bare = areaFromHit(
      { districts: {}, county: "Orange", nearLine: [], lookups: { sup: { id: "Orange|1" } } },
      "us/ca",
      known,
    );
    expect(bare.area.localities).toEqual([]);
    expect(bare.area.districts["us/ca/orange-county/sup"]).toBe("1");
    expect(bare.area.found).toEqual(["us/ca/orange-county", "us/ca/orange"]);
  });

  test("council districts under the city's path, as its races are filed", () => {
    const sunnyvale = areaFromHit(
      {
        districts: {},
        county: "Santa Clara",
        place: "Sunnyvale",
        nearLine: [],
        lookups: { council: { id: "Sunnyvale|3" } },
      },
      "us/ca",
      { ...known, localities: ["us/ca/sunnyvale"] },
    );
    expect(sunnyvale.area.localities).toEqual(["us/ca/sunnyvale"]);
    expect(sunnyvale.area.districts["us/ca/sunnyvale/council"]).toBe("3");
    expect(sunnyvale.area.labels?.["us/ca/sunnyvale/council"]).toBe("Sunnyvale council district 3");
    // Morgan Hill's districts are lettered.
    const morganHill = areaFromHit(
      {
        districts: {},
        place: "Morgan Hill",
        nearLine: [],
        lookups: { council: { id: "Morgan Hill|B" } },
      },
      "us/ca",
      known,
    );
    expect(morganHill.area.districts["us/ca/morgan-hill/council"]).toBe("b");
    expect(morganHill.area.labels?.["us/ca/morgan-hill/council"]).toBe(
      "Morgan Hill council district B",
    );
  });

  test("a county filed under its bare name still matches", () => {
    const hit = { districts: {}, county: "Marin", nearLine: [] };
    expect(areaFromHit(hit, "us/ca", known).area.localities).toEqual(["us/ca/marin"]);
  });

  test("a county never takes the path of a city with its name", () => {
    const cities = cityPaths(geo);
    const options = {
      localities: ["us/ca/orange", "us/ca/san-diego", "us/ca/san-diego-county"],
      districts: {},
    };
    // Huntington Beach, in Orange County: the City of Orange's races aren't its.
    const hb = { districts: {}, county: "Orange", place: "Huntington Beach", nearLine: [] };
    expect(areaFromHit(hb, "us/ca", options, cities).area.localities).toEqual([]);
    // Chula Vista, in San Diego County: the county's races, not the City of San Diego's.
    const cv = { districts: {}, county: "San Diego", place: "Chula Vista", nearLine: [] };
    expect(areaFromHit(cv, "us/ca", options, cities).area.localities).toEqual([
      "us/ca/san-diego-county",
    ]);
    // In the City of San Diego: both.
    const sd = { districts: {}, county: "San Diego", place: "San Diego", nearLine: [] };
    expect(areaFromHit(sd, "us/ca", options, cities).area.localities).toEqual([
      "us/ca/san-diego",
      "us/ca/san-diego-county",
    ]);
  });

  test("every path a city's races use, not just the first", () => {
    const options = {
      localities: [
        "us/ca/alameda",
        "us/ca/city-of-alameda",
        "us/ca/alameda-county",
        "us/ca/ventura",
      ],
      districts: {},
    };
    const alameda = { districts: {}, county: "Alameda", place: "Alameda", nearLine: [] };
    expect(areaFromHit(alameda, "us/ca", options, cityPaths(geo)).area.localities).toEqual([
      "us/ca/alameda",
      "us/ca/city-of-alameda",
      "us/ca/alameda-county",
    ]);
    // The Census's "San Buenaventura (Ventura)" is filed as Ventura.
    const ventura = {
      districts: {},
      county: "Ventura",
      place: "San Buenaventura (Ventura)",
      nearLine: [],
    };
    expect(areaFromHit(ventura, "us/ca", options, cityPaths(geo)).area.localities).toEqual([
      "us/ca/ventura",
    ]);
  });
});

test("localityCandidates", () => {
  const cities = cityPaths(geo);
  // A city has San Mateo's name; no city has Marin's.
  expect(localityCandidates("us/ca", "county", "San Mateo", cities)).toEqual([
    "us/ca/san-mateo-county",
  ]);
  expect(localityCandidates("us/ca", "county", "Marin", cities)).toEqual([
    "us/ca/marin-county",
    "us/ca/marin",
  ]);
  expect(localityCandidates("us/ca", "county", "Ventura", cities)).toEqual([
    "us/ca/ventura-county",
  ]);
  expect(localityCandidates("us/ca", "place", "Alameda")).toEqual([
    "us/ca/alameda",
    "us/ca/city-of-alameda",
  ]);
  expect(localityCandidates("us/ca", "place", "El Paso de Robles (Paso Robles)")).toEqual([
    "us/ca/el-paso-de-robles",
    "us/ca/city-of-el-paso-de-robles",
    "us/ca/paso-robles",
    "us/ca/city-of-paso-robles",
  ]);
  expect(localityCandidates("us/ca", "county", "San Francisco", cities)).toEqual(["us/ca/sf"]);
});

test("every California county has exactly one Court of Appeal district", () => {
  const counties = geo.layers.county.map((s) => s.id).sort();
  expect(Object.keys(COURT_OF_APPEAL_BY_COUNTY).sort()).toEqual(counties);
});

test("mergeFoundArea replaces cities, counties and found districts, keeps the rest", () => {
  const previous = {
    localities: ["us/ca/oakland", "us/ca/ebmud"],
    districts: { "us/ca/cd": "12", "us/ca/bart": "4" },
  };
  const found = { localities: ["us/ca/sf"], districts: { "us/ca/cd": "11" } };
  expect(mergeFoundArea(previous, found, geo)).toEqual({
    localities: ["us/ca/sf", "us/ca/ebmud"],
    districts: { "us/ca/cd": "11", "us/ca/bart": "4" },
  });
});

test("mergeFoundArea keeps what the lookup found, and answers a recheck", () => {
  const previous = {
    localities: ["us/ca/san-diego", "us/ca/san-diego-county"],
    districts: {},
    recheck: ["us/ca/san-diego"],
  };
  const found = {
    localities: ["us/ca/san-diego-county"],
    districts: {},
    found: ["us/ca/chula-vista", "us/ca/city-of-chula-vista", "us/ca/san-diego-county"],
  };
  expect(mergeFoundArea(previous, found, geo)).toEqual(found);
});

test("mergeFoundArea always replaces school districts", () => {
  const previous = {
    localities: ["us/ca/oakland"],
    districts: { "us/ca/cd": "12", "us/ca/unsd": "29150" },
    labels: { "us/ca/unsd": "Oakland Unified School District" },
  };
  // A lookup near a school district line: no unified district to set.
  const found = { localities: ["us/ca/sf"], districts: { "us/ca/cd": "11" } };
  expect(mergeFoundArea(previous, found, geo)).toEqual({
    localities: ["us/ca/sf"],
    districts: { "us/ca/cd": "11" },
  });
});

test("mergeFoundArea drops the council district of the city you were in", () => {
  // Moving from Sunnyvale to a spot near a council line in Mountain View.
  const previous = {
    localities: ["us/ca/sunnyvale"],
    districts: { "us/ca/sunnyvale/council": "3" },
    labels: { "us/ca/sunnyvale/council": "Sunnyvale council district 3" },
  };
  const found = { localities: ["us/ca/mountain-view"], districts: {} };
  expect(mergeFoundArea(previous, found, geo)).toEqual(found);
});

test("a Sunnyvale address puts its own council race on the ballot and the others off", () => {
  // The voter's report that started this (plans/ballot-feedback-sunnyvale.md):
  // the listing files Sunnyvale's district races as council-1, -3 and -5.
  const hit = locate(geo, -122.0258, 37.3525); // Ortega Park, district 3
  if (!hit) throw new Error("not in California");
  const known = { localities: ["us/ca/sunnyvale", "us/ca/santa-clara-county"], districts: {} };
  const { area } = areaFromHit(hit, "us/ca", known, cityPaths(geo));
  const place = (n: number) => placeRace("us/ca/sunnyvale", `us/ca/sunnyvale/council-${n}`, area);
  expect([place(1), place(3), place(5)]).toEqual(["out", "in", "out"]);
});
