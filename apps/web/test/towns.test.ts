import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Feature, FeatureCollection } from "geojson";
import { topology } from "topojson-server";
import type { Topology } from "topojson-specification";
import {
  areaFromHit,
  cityPaths,
  decodeStateGeo,
  localityCandidates,
  locate,
  mergeFoundArea,
  placeNameFor,
  townCandidates,
  townFor,
  townIsUnique,
  townPaths,
} from "../src/lib/geo";
import { type Area, jurisdictionLabel } from "../src/lib/jurisdictions";
import { townLabel, townSlug } from "../src/lib/towns";

/**
 * Towns and townships (src/lib/towns.ts): how they're spelled in a path, and
 * how a lookup finds one, on made-up states of squares shaped like the real
 * cases (a Vermont village inside the town of its name, Pennsylvania's
 * Washington Townships, a New York town around the city of its name).
 */

describe("a town's path segment", () => {
  const town = (name: string, basename: string) => ({ name, basename });

  test("a township says so, a charter township the same way", () => {
    expect(townSlug("us/pa", town("Washington township", "Washington"))).toBe(
      "washington-township",
    );
    expect(townSlug("us/mi", town("Canton charter township", "Canton"))).toBe("canton-township");
    expect(townSlug("us/nj", town("Upper Freehold township", "Upper Freehold"))).toBe(
      "upper-freehold-township",
    );
  });

  test("a New England town is its bare name", () => {
    expect(townSlug("us/ma", town("Lexington town", "Lexington"))).toBe("lexington");
    expect(townSlug("us/vt", town("St. Albans town", "St. Albans"))).toBe("st-albans");
    expect(townSlug("us/me", town("Matinicus Isle plantation", "Matinicus Isle"))).toBe(
      "matinicus-isle-plantation",
    );
  });

  test("a town anywhere else says it's a town", () => {
    expect(townSlug("us/ny", town("Ithaca town", "Ithaca"))).toBe("ithaca-town");
    expect(townSlug("us/wi", town("Madison town", "Madison"))).toBe("madison-town");
  });

  test("a numbered township is its whole name", () => {
    expect(townSlug("us/ks", town("Township 5", "5"))).toBe("township-5");
  });

  test("what to call one", () => {
    expect(townLabel("us/ma", town("Lexington town", "Lexington"))).toBe("Lexington");
    expect(townLabel("us/ny", town("Ithaca town", "Ithaca"))).toBe("Town of Ithaca");
    expect(townLabel("us/pa", town("Washington township", "Washington"))).toBe(
      "Washington Township",
    );
    expect(townLabel("us/mi", town("Canton charter township", "Canton"))).toBe(
      "Canton Charter Township",
    );
    expect(townLabel("us/ks", town("Township 5", "5"))).toBe("Township 5");
  });

  test("a path under a county reads as the town, then the county", () => {
    expect(jurisdictionLabel("us/pa/greene-county/washington-township")).toBe(
      "Washington Township, Greene County",
    );
    expect(jurisdictionLabel("us/ma/lexington")).toBe("Lexington");
  });
});

type Box = [number, number, number, number];
const square = (id: string, [x0, y0, x1, y1]: Box, name?: string): Feature => ({
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
function state(layers: {
  county: FeatureCollection;
  place?: FeatureCollection;
  town?: FeatureCollection;
}): Topology {
  const all: Box = [-80, 40, -70, 46];
  const built = topology({
    cd: layer(square("1", all)),
    sd: layer(),
    ad: layer(),
    county: layers.county,
    place: layers.place ?? layer(),
    ...(layers.town ? { town: layers.town } : {}),
  }) as Topology & { metadata?: unknown };
  built.metadata = { vintage: "test" };
  return built;
}
const NONE = { localities: [], districts: {} };

describe("Vermont: a village inside the town of its name, and a city beside one", () => {
  // Windsor County: the town of Woodstock, the village in its middle, and Hartford.
  // Franklin County: St. Albans city, and the town of St. Albans around it (beside it, here).
  const geo = decodeStateGeo(
    "us/vt",
    state({
      county: layer(square("Windsor", [-73, 43, -72, 44]), square("Franklin", [-73, 44, -72, 45])),
      town: layer(
        square("Windsor|Woodstock town", [-73, 43, -72.5, 44], "Woodstock"),
        square("Windsor|Hartford town", [-72.5, 43, -72, 44], "Hartford"),
        square("Franklin|St. Albans town", [-73, 44, -72.5, 45], "St. Albans"),
      ),
      place: layer(
        square("Woodstock", [-72.8, 43.4, -72.7, 43.5], "Woodstock village"),
        square("St. Albans", [-72.5, 44, -72, 45], "St. Albans city"),
      ),
    }),
  );

  test("in the town, outside the village: the town, by its bare name or under its county", () => {
    const hit = locate(geo, -72.9, 43.2);
    expect(hit?.town).toEqual({ name: "Woodstock town", basename: "Woodstock", unique: true });
    expect(hit?.place).toBeUndefined();
    if (!hit) throw new Error("no hit");
    const found = areaFromHit(hit, "us/vt", NONE, cityPaths(geo));
    expect(found.places).toEqual(["Woodstock", "Windsor County"]);
    expect(found.area.found).toEqual([
      "us/vt/windsor-county",
      "us/vt/windsor",
      "us/vt/windsor-county/woodstock",
      "us/vt/woodstock",
    ]);
  });

  test("in the village: the village with its kind, and the town it's part of", () => {
    const hit = locate(geo, -72.75, 43.45);
    expect(hit?.place).toBe("Woodstock");
    expect(hit?.placeName).toBe("Woodstock village");
    expect(hit?.town?.name).toBe("Woodstock town");
    if (!hit) throw new Error("no hit");
    const found = areaFromHit(hit, "us/vt", NONE, cityPaths(geo));
    // Said once: the village's name is the town's.
    expect(found.places).toEqual(["Woodstock", "Windsor County"]);
    expect(found.area.found).toContain("us/vt/woodstock-village");
    expect(found.area.found).toContain("us/vt/woodstock");
    expect(found.area.found).toContain("us/vt/windsor-county/woodstock");
  });

  test("a race filed either way is on the ballot of someone in the town", () => {
    const hit = locate(geo, -72.9, 43.2);
    if (!hit) throw new Error("no hit");
    for (const path of ["us/vt/woodstock", "us/vt/windsor-county/woodstock"]) {
      const known = { localities: [path], districts: {} };
      expect(areaFromHit(hit, "us/vt", known, cityPaths(geo)).area.localities).toEqual([path]);
    }
    // The village's own races aren't the town's.
    const village = { localities: ["us/vt/woodstock-village"], districts: {} };
    expect(areaFromHit(hit, "us/vt", village, cityPaths(geo)).area.localities).toEqual([]);
  });

  test("the city of St. Albans isn't the town of St. Albans", () => {
    const city = locate(geo, -72.2, 44.5);
    expect(city?.town).toBeUndefined();
    expect(city?.placeName).toBe("St. Albans city");
    const town = locate(geo, -72.8, 44.5);
    expect(town?.town?.unique).toBe(true);
    if (!city || !town) throw new Error("no hit");
    expect(areaFromHit(city, "us/vt", NONE, cityPaths(geo)).area.found).toEqual([
      "us/vt/st-albans-city",
      "us/vt/franklin-county",
      "us/vt/franklin",
    ]);
    expect(areaFromHit(town, "us/vt", NONE, cityPaths(geo)).area.found).toEqual([
      "us/vt/franklin-county",
      "us/vt/franklin",
      "us/vt/franklin-county/st-albans",
      "us/vt/st-albans",
    ]);
  });

  test("a lookup somewhere else replaces the town", () => {
    const first = locate(geo, -72.9, 43.2);
    const second = locate(geo, -72.2, 43.5);
    if (!first || !second) throw new Error("no hit");
    const known = {
      localities: ["us/vt/woodstock", "us/vt/hartford", "us/vt/some-water-district"],
      districts: {},
    };
    const before: Area = {
      ...areaFromHit(first, "us/vt", known, cityPaths(geo)).area,
      localities: ["us/vt/woodstock", "us/vt/some-water-district"],
    };
    const after = mergeFoundArea(
      before,
      areaFromHit(second, "us/vt", known, cityPaths(geo)).area,
      geo,
    );
    expect(after.localities).toEqual(["us/vt/hartford", "us/vt/some-water-district"]);
  });

  test("every town's paths", () => {
    expect([...townPaths(geo)].sort()).toEqual([
      "us/vt/franklin-county/st-albans",
      "us/vt/hartford",
      "us/vt/st-albans",
      "us/vt/windsor-county/hartford",
      "us/vt/windsor-county/woodstock",
      "us/vt/woodstock",
    ]);
  });
});

describe("Pennsylvania: township names repeat", () => {
  const geo = decodeStateGeo(
    "us/pa",
    state({
      county: layer(square("Greene", [-80, 40, -79, 41]), square("Fayette", [-79, 40, -78, 41])),
      town: layer(
        square("Greene|Washington township", [-80, 40, -79.5, 41], "Washington"),
        square("Greene|Franklin township", [-79.5, 40, -79, 41], "Franklin"),
        square("Fayette|Washington township", [-79, 40, -78, 41], "Washington"),
      ),
    }),
  );

  test("one of two Washington Townships is filed under its county only", () => {
    const hit = locate(geo, -79.8, 40.5);
    expect(hit?.town).toEqual({
      name: "Washington township",
      basename: "Washington",
      unique: false,
    });
    if (!hit) throw new Error("no hit");
    const found = areaFromHit(hit, "us/pa", NONE, cityPaths(geo));
    expect(found.places).toEqual(["Washington Township", "Greene County"]);
    expect(found.area.found).toEqual([
      "us/pa/greene-county",
      "us/pa/greene",
      "us/pa/greene-county/washington-township",
    ]);
  });

  test("the only Franklin Township may go without its county", () => {
    const hit = locate(geo, -79.2, 40.5);
    if (!hit) throw new Error("no hit");
    expect(areaFromHit(hit, "us/pa", NONE, cityPaths(geo)).area.found).toEqual([
      "us/pa/greene-county",
      "us/pa/greene",
      "us/pa/greene-county/franklin-township",
      "us/pa/franklin-township",
    ]);
  });

  test("a bare path for a repeated name is nobody's", () => {
    const hit = locate(geo, -79.8, 40.5);
    if (!hit) throw new Error("no hit");
    const known = { localities: ["us/pa/washington-township"], districts: {} };
    expect(areaFromHit(hit, "us/pa", known, cityPaths(geo)).area.localities).toEqual([]);
  });
});

describe("New York: a town around the city of its name", () => {
  const geo = decodeStateGeo(
    "us/ny",
    state({
      county: layer(square("Tompkins", [-77, 42, -76, 43])),
      town: layer(square("Tompkins|Ithaca town", [-77, 42, -76.5, 43], "Ithaca")),
      place: layer(square("Ithaca", [-76.5, 42, -76, 43])),
    }),
  );

  test("the town says it's a town; the city has the name", () => {
    const town = locate(geo, -76.8, 42.5);
    const city = locate(geo, -76.2, 42.5);
    if (!town || !city) throw new Error("no hit");
    expect(areaFromHit(town, "us/ny", NONE, cityPaths(geo)).area.found).toEqual([
      "us/ny/tompkins-county",
      "us/ny/tompkins",
      "us/ny/tompkins-county/ithaca-town",
      "us/ny/ithaca-town",
    ]);
    expect(areaFromHit(town, "us/ny", NONE, cityPaths(geo)).places).toEqual([
      "Town of Ithaca",
      "Tompkins County",
    ]);
    expect(areaFromHit(city, "us/ny", NONE, cityPaths(geo)).area.found).toEqual([
      "us/ny/ithaca",
      "us/ny/city-of-ithaca",
      "us/ny/tompkins-county",
      "us/ny/tompkins",
    ]);
  });
});

describe("a town a geocoder named", () => {
  const geo = decodeStateGeo(
    "us/pa",
    state({
      county: layer(square("Greene", [-80, 40, -79, 41]), square("Fayette", [-79, 40, -78, 41])),
      town: layer(
        square("Greene|Washington township", [-80, 40, -79, 41], "Washington"),
        square("Fayette|Washington township", [-79, 40, -78.5, 41], "Washington"),
        square("Fayette|Dunbar township", [-78.5, 40, -78, 41], "Dunbar"),
      ),
      place: layer(square("Dunbar", [-78.3, 40.4, -78.2, 40.5], "Dunbar borough")),
    }),
  );
  const washington = { name: "Washington township", basename: "Washington" };
  const dunbar = { name: "Dunbar township", basename: "Dunbar" };

  test("the state's boundaries say whether its name is the only one", () => {
    expect(townIsUnique(geo, washington)).toBe(false);
    expect(townIsUnique(geo, dunbar)).toBe(true);
    expect(townFor(geo, washington, -79.5, 40.5)).toEqual({ ...washington, unique: false });
    expect(townFor(geo, dunbar, -78.4, 40.2)).toEqual({ ...dunbar, unique: true });
  });

  test("without them, nothing does: the town is under its county only", () => {
    const town = townFor(undefined, dunbar, -78.4, 40.2);
    expect(town).toEqual(dunbar);
    expect(town && townCandidates("us/pa", town, "us/pa/fayette-county")).toEqual([
      "us/pa/fayette-county/dunbar-township",
    ]);
  });

  test("a geocoder that names none: the town the boundaries put the point in", () => {
    expect(townFor(geo, undefined, -78.4, 40.2)).toEqual({ ...dunbar, unique: true });
    expect(townFor(undefined, undefined, -78.4, 40.2)).toBeUndefined();
  });

  test("a place keeps its whole name only where the boundaries carry one", () => {
    expect(placeNameFor(geo, "Dunbar")).toBe("Dunbar borough");
    expect(placeNameFor(geo, "Elsewhere")).toBeUndefined();
    expect(placeNameFor(undefined, "Dunbar")).toBeUndefined();
  });
});

test("a county that isn't called a county goes by what it is called", () => {
  expect(localityCandidates("us/la", "county", "Orleans", new Set(), "Orleans Parish")).toEqual([
    "us/la/orleans-parish",
    "us/la/orleans",
  ]);
  expect(localityCandidates("us/ak", "county", "Denali", new Set(), "Denali Borough")).toEqual([
    "us/ak/denali-borough",
    "us/ak/denali",
  ]);
  // A city has the bare name: Virginia's independent cities are both.
  expect(
    localityCandidates(
      "us/va",
      "county",
      "Alexandria",
      new Set(["us/va/alexandria"]),
      "Alexandria city",
    ),
  ).toEqual(["us/va/alexandria-city"]);
  expect(localityCandidates("us/tx", "county", "Travis")).toEqual([
    "us/tx/travis-county",
    "us/tx/travis",
  ]);
});

describe("the files the app ships", () => {
  const shipped = (code: string) =>
    decodeStateGeo(
      `us/${code}`,
      JSON.parse(
        readFileSync(join(import.meta.dir, `../public/geo/us-${code}.topo.json`), "utf8"),
      ) as Topology,
    );
  const foundAt = (geo: ReturnType<typeof shipped>, lat: number, lon: number) => {
    const hit = locate(geo, lon, lat);
    if (!hit) throw new Error("no hit");
    return areaFromHit(hit, geo.state, NONE, cityPaths(geo));
  };

  test("Vermont: Woodstock's village green is in the village and the town", () => {
    const vermont = shipped("vt");
    expect(vermont.towns.length).toBeGreaterThan(200);
    const green = foundAt(vermont, 43.6242, -72.5199);
    expect(green.places).toEqual(["Woodstock", "Windsor County"]);
    expect(green.area.found).toEqual([
      "us/vt/woodstock-village",
      "us/vt/windsor-county",
      "us/vt/windsor",
      "us/vt/windsor-county/woodstock",
      "us/vt/woodstock",
    ]);
    // The city of St. Albans, and the town of St. Albans west of it.
    expect(foundAt(vermont, 44.8109, -73.0832).area.found?.[0]).toBe("us/vt/st-albans-city");
    expect(foundAt(vermont, 44.81, -73.14).area.found).toContain("us/vt/st-albans");
  });

  test("Massachusetts: Lexington is a town, Boston a city", () => {
    const massachusetts = shipped("ma");
    expect(foundAt(massachusetts, 42.4473, -71.2245).area.found).toEqual([
      "us/ma/middlesex-county",
      "us/ma/middlesex",
      "us/ma/middlesex-county/lexington",
      "us/ma/lexington",
    ]);
    expect(foundAt(massachusetts, 42.3604, -71.058).area.found).toEqual([
      "us/ma/boston",
      "us/ma/city-of-boston",
      "us/ma/suffolk-county",
      "us/ma/suffolk",
    ]);
  });

  test("a state with no towns has no town layer", () => {
    expect(shipped("nv").towns).toEqual([]);
  });
});
