/**
 * Builds `public/geo/us-ca.topo.json`: California's congressional, State
 * Senate, Assembly, county, city and school district boundaries, for finding
 * someone's districts on their own device (the map picker and "Use my
 * location"; see src/lib/geo.ts and plans/find-my-districts.md). School
 * districts (unified, elementary, secondary), Board of Equalization districts,
 * community college districts and counties' supervisorial districts are looked
 * up, not drawn: they place the races only part of a county or the state votes
 * on (plans/sub-county-districts.md).
 *
 * Sources: the Census Bureau's TIGERweb "Current" map service (the boundaries
 * in force for this year's elections: the 120th Congress districts, 2026 state
 * legislative districts, school districts), and for what Census doesn't map,
 * the body that draws or keeps it (`OTHER_SOURCES`). Each layer is fetched near
 * full resolution, joined into one topology so neighbours share their border,
 * then simplified topologically (shared borders stay shared, so no slivers or
 * overlaps) and quantized.
 *
 *   bun run geo                    fetch (cached in the OS temp dir) and build
 *   bun run geo --refresh          refetch from TIGERweb
 *   bun run geo --check            also report how often the simplified
 *                                  districts disagree with full resolution
 *
 * Re-run after redistricting or when Census publishes a new vintage, and commit
 * the output.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";
import { feature, quantize } from "topojson-client";
import { topology } from "topojson-server";
import { presimplify, simplify } from "topojson-simplify";
import type { GeometryCollection, Topology } from "topojson-specification";
import { LOOKUP_LAYERS, decodeStateGeo, lookupsAt } from "../src/lib/geo";

const SERVICE =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer";
const STATE_FIPS = "06";

/**
 * Our layer name → TIGERweb layer id, which attribute becomes the feature id,
 * and for school districts the name kept beside it (their id, the LEA code,
 * says nothing to a voter).
 */
const LAYERS: Record<string, { id: number; key: string; name?: string }> = {
  cd: { id: 54, key: "BASENAME" }, // 120th Congressional Districts
  sd: { id: 56, key: "BASENAME" }, // 2026 State Legislative Districts - Upper
  ad: { id: 58, key: "BASENAME" }, // 2026 State Legislative Districts - Lower
  county: { id: 82, key: "BASENAME" },
  place: { id: 28, key: "BASENAME" }, // Incorporated Places
  unsd: { id: 14, key: "GEOID", name: "NAME" }, // Unified School Districts
  elsd: { id: 18, key: "GEOID", name: "NAME" }, // Elementary School Districts
  scsd: { id: 16, key: "GEOID", name: "NAME" }, // Secondary School Districts
};

/**
 * Boundaries Census doesn't publish, each from whoever draws or keeps them, as
 * our layer name, the ArcGIS layer to query, and how a feature's attributes
 * become its id (and name). Supervisorial districts are one layer for every
 * county we have, ids `<County>|<district>` with the county as TIGER names it.
 */
type Attributes = Record<string, unknown>;
const OTHER_SOURCES: {
  layer: "boe" | "ccd" | "sup";
  url: string;
  where?: string;
  id: (a: Attributes) => string;
  name?: (a: Attributes) => string;
}[] = [
  {
    // California Citizens Redistricting Commission's 2021 maps, on the state GIS.
    layer: "boe",
    url: "https://services.gis.ca.gov/arcgis/rest/services/Government/CaliforniaDistricts/MapServer/3",
    id: (a) => String(a.DISTRICT),
  },
  {
    // CCC GIS Collaborative / Foundation for California Community Colleges, from
    // the districts' legal narratives (public domain); ids are the Chancellor's
    // Office district codes (Coast = 830).
    layer: "ccd",
    url: "https://services3.arcgis.com/iUKM0a3Vouz02bg4/arcgis/rest/services/CCC_Boundaries/FeatureServer/0",
    id: (a) => String(a.DID),
    name: (a) => `${a.DistrictNa} Community College District`,
  },
  {
    // SCAG: Los Angeles, Orange, Riverside, San Bernardino, Ventura, Imperial.
    layer: "sup",
    url: "https://maps.scag.ca.gov/scaggis/rest/services/OpenData/Supervisorial_boundary_scag/MapServer/0",
    id: (a) => `${a.COUNTY}|${a.DISTRICT}`,
  },
  {
    layer: "sup",
    url: "https://gis-public.sandiegocounty.gov/arcgis/rest/services/Hosted/COSD_Boundaries/FeatureServer/1",
    id: (a) => `San Diego|${a.distno}`,
  },
  {
    layer: "sup",
    url: "https://services2.arcgis.com/tcv2cMrq63AgvbHF/arcgis/rest/services/PlanningOfficeDataService2/FeatureServer/5",
    id: (a) => `Santa Clara|${a.DISTRICT}`,
  },
  {
    layer: "sup",
    url: "https://services5.arcgis.com/ROBnTHSNjoZ2Wm1P/arcgis/rest/services/Supervisorial_Districts/FeatureServer/0",
    id: (a) => `Alameda|${a.DISTRICT}`,
  },
  {
    layer: "sup",
    url: "https://services.arcgis.com/yq3FgOI44hYHAFVZ/arcgis/rest/services/Supervisor_Districts_Land_Boundaries/FeatureServer/0",
    id: (a) => `San Mateo|${a.District}`,
  },
  {
    // DataSF, the 2022 districts.
    layer: "sup",
    url: "https://services.arcgis.com/Zs2aNLFN00jrS4gG/arcgis/rest/services/Current_Supervisor_Districts/FeatureServer/0",
    id: (a) => `San Francisco|${a.supervisor}`,
  },
];
type OtherLayer = (typeof OTHER_SOURCES)[number]["layer"];
type LayerName = keyof typeof LAYERS | OtherLayer;

/**
 * Visvalingam weight (planar triangle area, degrees²) below which a point is
 * dropped. Measured with --check (2026-10-20): 1e-7 ships 1.76 MB (594 KB
 * gzipped) and puts about 1 in 4,000 random city points in a different
 * district than full resolution; 1e-6 halves the size but triples the
 * misses. The lookup warns near a district line either way.
 */
const MIN_WEIGHT = Number(process.env.GEO_MIN_WEIGHT ?? 1e-7);
/**
 * The same for borders only lookup layers use (school, BOE, community college
 * and supervisorial districts): never drawn, and a point near one of their
 * lines is left unknown (NEAR_LINE_METERS in src/lib/geo.ts), so they can be
 * coarser. Measured with --check (2026-10-25), of 20,000 random city points per
 * layer: 1e-6 ships 3.48 MB (888 KB brotli) and sets 1 supervisorial district
 * wrong; 3e-7 ships 3.74 MB (954 KB) and 1e-7 4.05 MB (1,024 KB), with none
 * wrong. Unknown (near a line) is 0.2–5% per layer at each.
 */
const LOOKUP_MIN_WEIGHT = Number(process.env.GEO_LOOKUP_MIN_WEIGHT ?? 3e-7);
/** Layers the map draws; every other layer is only looked up. */
const DRAWN = ["cd", "sd", "ad", "county", "place"];

/** Arc indexes a geometry collection uses, at any depth. */
function arcsOf(object: GeometryCollection): Set<number> {
  const out = new Set<number>();
  const walk = (arcs: unknown): void => {
    if (typeof arcs === "number") out.add(arcs < 0 ? ~arcs : arcs);
    else if (Array.isArray(arcs)) for (const a of arcs) walk(a);
  };
  for (const geometry of object.geometries) walk((geometry as { arcs?: unknown }).arcs);
  return out;
}
/** Grid size per axis; across California's ~10° that is about 5 m. */
const QUANTIZATION = 2e5;

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, "..", "public", "geo", "us-ca.topo.json");
const cacheDir = join(tmpdir(), "openslate-geo-cache");
const args = new Set(process.argv.slice(2));

/**
 * Query an ArcGIS layer as GeoJSON, cached as `<cacheName>.geojson`. The default
 * offset, ~1 m, is near full resolution but drops TIGER's collinear vertices.
 */
async function fetchGeoJSON(
  layerUrl: string,
  where: string,
  outFields: string,
  cacheName: string,
  maxAllowableOffset = "0.00001",
): Promise<FeatureCollection> {
  const cached = join(cacheDir, `${cacheName}.geojson`);
  if (!args.has("--refresh") && existsSync(cached)) {
    return JSON.parse(readFileSync(cached, "utf8")) as FeatureCollection;
  }
  const params = new URLSearchParams({
    where,
    outFields,
    returnGeometry: "true",
    outSR: "4326",
    maxAllowableOffset,
    geometryPrecision: "6",
    f: "geojson",
  });
  console.log(`fetching ${cacheName} (${layerUrl})…`);
  const response = await fetch(`${layerUrl}/query?${params}`);
  if (!response.ok) throw new Error(`${cacheName}: HTTP ${response.status}`);
  const collection = (await response.json()) as FeatureCollection & {
    exceededTransferLimit?: boolean;
  };
  if (collection.exceededTransferLimit) throw new Error(`${cacheName}: result truncated`);
  if (!collection.features?.length) throw new Error(`${cacheName}: no features`);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cached, JSON.stringify(collection));
  return collection;
}

function fetchLayer(name: keyof typeof LAYERS): Promise<FeatureCollection> {
  const { id, key, name: nameKey } = LAYERS[name] ?? { id: 0, key: "" };
  const outFields = nameKey ? `${key},${nameKey}` : key;
  return fetchGeoJSON(`${SERVICE}/${id}`, `STATE='${STATE_FIPS}'`, outFields, name);
}

/**
 * One `OTHER_SOURCES` layer from all its sources, slimmed to id (and name),
 * with a district a source splits into several features joined into one.
 */
async function fetchOther(layer: OtherLayer): Promise<FeatureCollection> {
  const byId = new Map<string, { name?: string; polygons: Position[][][] }>();
  for (const [i, src] of OTHER_SOURCES.entries()) {
    if (src.layer !== layer) continue;
    const collection = await fetchGeoJSON(src.url, src.where ?? "1=1", "*", `${layer}-${i}`);
    for (const f of collection.features) {
      const attributes = (f.properties ?? {}) as Attributes;
      const id = src.id(attributes);
      if (!id || /undefined|null/.test(id)) throw new Error(`${layer}: feature without an id`);
      const entry = byId.get(id) ?? { polygons: [] };
      const name = src.name?.(attributes);
      if (name) entry.name = name;
      if (f.geometry?.type === "Polygon") entry.polygons.push(f.geometry.coordinates);
      else if (f.geometry?.type === "MultiPolygon") entry.polygons.push(...f.geometry.coordinates);
      byId.set(id, entry);
    }
  }
  return {
    type: "FeatureCollection",
    features: [...byId].map(
      ([id, { name, polygons }]): Feature => ({
        type: "Feature",
        id,
        properties: name ? { name } : {},
        geometry: { type: "MultiPolygon", coordinates: polygons },
      }),
    ),
  };
}

/**
 * Keep only the id (and a school district's name): every byte here ships to
 * every visitor who opens the map. A GEOID loses its state prefix, leaving the
 * 5-digit LEA code that `district` paths use (`us/ca/elsd-18030`).
 */
function slim(collection: FeatureCollection, layer: keyof typeof LAYERS): FeatureCollection {
  const { key, name: nameKey } = LAYERS[layer] ?? { key: "" };
  return {
    type: "FeatureCollection",
    features: collection.features.map((f): Feature => {
      const value = f.properties?.[key];
      if (typeof value !== "string" || !value) throw new Error(`feature without ${key}`);
      const id = key === "GEOID" ? value.slice(STATE_FIPS.length) : value;
      const name = nameKey ? f.properties?.[nameKey] : undefined;
      if (nameKey && (typeof name !== "string" || !name))
        throw new Error(`${id} without ${nameKey}`);
      return { type: "Feature", id, properties: name ? { name } : {}, geometry: f.geometry };
    }),
  };
}

function ringContains(ring: Position[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i] as [number, number];
    const [xj, yj] = ring[j] as [number, number];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function geometryContains(geometry: Geometry | null, x: number, y: number): boolean {
  if (!geometry) return false;
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.type === "MultiPolygon"
        ? geometry.coordinates
        : [];
  return polygons.some(
    (rings) =>
      ringContains(rings[0] ?? [], x, y) && !rings.slice(1).some((h) => ringContains(h, x, y)),
  );
}

function whichFeature(collection: FeatureCollection, x: number, y: number): string | undefined {
  return collection.features.find((f) => geometryContains(f.geometry, x, y))?.id as
    | string
    | undefined;
}

const source: Record<LayerName, FeatureCollection> = {} as Record<LayerName, FeatureCollection>;
for (const name of Object.keys(LAYERS)) {
  source[name] = slim(await fetchLayer(name), name);
}
for (const layer of new Set(OTHER_SOURCES.map((s) => s.layer))) {
  source[layer] = await fetchOther(layer);
}

const meta = (await (await fetch(`${SERVICE}?f=json`)).json()) as {
  documentInfo?: { Comments?: string };
};

const full = topology(source);
const weighted = presimplify(full);
// Points on borders no drawn layer uses are dropped below LOOKUP_MIN_WEIGHT:
// zero their weight there, and `simplify` drops them with the rest.
const drawn = new Set<number>();
for (const name of DRAWN)
  for (const arc of arcsOf(weighted.objects[name] as GeometryCollection)) drawn.add(arc);
for (const [i, arc] of weighted.arcs.entries()) {
  if (drawn.has(i)) continue;
  for (const point of arc) if ((point[2] ?? 0) < LOOKUP_MIN_WEIGHT) point[2] = 0;
}
const simplified = quantize(simplify(weighted, MIN_WEIGHT), QUANTIZATION) as Topology & {
  metadata?: unknown;
};
simplified.metadata = {
  source: `${SERVICE} (layers ${Object.entries(LAYERS)
    .map(([name, { id }]) => `${name}=${id}`)
    .join(", ")}); ${OTHER_SOURCES.map((s) => `${s.layer}: ${s.url}`).join("; ")}`,
  vintage: meta.documentInfo?.Comments ?? "unknown",
  builtAt: new Date().toISOString().slice(0, 10),
  minWeight: MIN_WEIGHT,
  lookupMinWeight: LOOKUP_MIN_WEIGHT,
  quantization: QUANTIZATION,
};

mkdirSync(dirname(outFile), { recursive: true });
const json = JSON.stringify(simplified);
writeFileSync(outFile, json);
console.log(
  `wrote ${outFile}: ${(json.length / 1024).toFixed(0)} KB, ${simplified.arcs.length} arcs`,
);
for (const name of Object.keys(source)) {
  const object = simplified.objects[name] as GeometryCollection;
  console.log(`  ${name}: ${object.geometries.length}`);
}

if (args.has("--check")) {
  // Random points inside cities (where people live and districts follow
  // streets): how often does the shipped file put one in a different district
  // than full resolution does?
  const places = source.place.features;
  const randomCityPoint = (): [number, number] => {
    for (;;) {
      const place = places[Math.floor(Math.random() * places.length)] as Feature;
      const ring = (
        place.geometry?.type === "Polygon"
          ? place.geometry.coordinates[0]
          : place.geometry?.type === "MultiPolygon"
            ? place.geometry.coordinates[0]?.[0]
            : undefined
      ) as Position[] | undefined;
      if (!ring) continue;
      const xs = ring.map((p) => p[0] as number);
      const ys = ring.map((p) => p[1] as number);
      const x = Math.min(...xs) + Math.random() * (Math.max(...xs) - Math.min(...xs));
      const y = Math.min(...ys) + Math.random() * (Math.max(...ys) - Math.min(...ys));
      if (geometryContains(place.geometry, x, y)) return [x, y];
    }
  };
  for (const name of ["cd", "sd", "ad"] as const) {
    const shipped = feature(simplified, simplified.objects[name] as GeometryCollection);
    let compared = 0;
    let differ = 0;
    while (compared < 20000) {
      const [x, y] = randomCityPoint();
      const truth = whichFeature(source[name], x, y);
      if (truth === undefined) continue;
      compared++;
      if (whichFeature(shipped, x, y) !== truth) differ++;
    }
    console.log(`  check ${name}: ${differ} of ${compared} random city points differ`);
  }
  // Lookup layers, as the app reads them (src/lib/geo.ts): a point near a line
  // is left unknown, so what matters is how often a district it does set is
  // wrong (a race hidden that's on the ballot), and how often it's unknown.
  const geo = decodeStateGeo("us/ca", simplified);
  const counts = Object.fromEntries(
    LOOKUP_LAYERS.map((l) => [l, { compared: 0, wrong: 0, unknown: 0 }]),
  );
  for (let i = 0; i < 20000; i++) {
    const [x, y] = randomCityPoint();
    const county = whichFeature(source.county, x, y);
    const found = lookupsAt(geo, x, y, county)?.lookups ?? {};
    for (const layer of LOOKUP_LAYERS) {
      const truth = whichFeature(source[layer], x, y);
      const count = counts[layer];
      if (truth === undefined || !count) continue;
      count.compared++;
      const id = found[layer]?.id;
      if (id === undefined) count.unknown++;
      else if (id !== truth) count.wrong++;
    }
  }
  for (const [layer, { compared, wrong, unknown }] of Object.entries(counts)) {
    console.log(
      `  check ${layer}: of ${compared} random city points, ${wrong} wrong, ${unknown} unknown`,
    );
  }
}
