/**
 * Builds `public/geo/us-ca.topo.json`: California's congressional, State
 * Senate, Assembly, county and city boundaries, for finding someone's districts
 * on their own device (the map picker and "Use my location"; see
 * src/lib/geo.ts and plans/find-my-districts.md).
 *
 * Source: the Census Bureau's TIGERweb "Current" map service (the boundaries in
 * force for this year's elections: the 120th Congress districts, 2026 state
 * legislative districts). Each layer is fetched near full resolution, joined
 * into one topology so neighbours share their border, then simplified
 * topologically (shared borders stay shared, so no slivers or overlaps) and
 * quantized.
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

const SERVICE =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer";
const STATE_FIPS = "06";

/** Our layer name → TIGERweb layer id, and which attribute becomes the feature id. */
const LAYERS = {
  cd: { id: 54, key: "BASENAME" }, // 120th Congressional Districts
  sd: { id: 56, key: "BASENAME" }, // 2026 State Legislative Districts - Upper
  ad: { id: 58, key: "BASENAME" }, // 2026 State Legislative Districts - Lower
  county: { id: 82, key: "BASENAME" },
  place: { id: 28, key: "BASENAME" }, // Incorporated Places
} as const;
type LayerName = keyof typeof LAYERS;

/**
 * Visvalingam weight (planar triangle area, degrees²) below which a point is
 * dropped. Measured with --check (2026-10-20): 1e-7 ships 1.76 MB (594 KB
 * gzipped) and puts about 1 in 4,000 random city points in a different
 * district than full resolution; 1e-6 halves the size but triples the
 * misses. The lookup warns near a district line either way.
 */
const MIN_WEIGHT = Number(process.env.GEO_MIN_WEIGHT ?? 1e-7);
/** Grid size per axis; across California's ~10° that is about 5 m. */
const QUANTIZATION = 2e5;

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, "..", "public", "geo", "us-ca.topo.json");
const cacheDir = join(tmpdir(), "openslate-geo-cache");
const args = new Set(process.argv.slice(2));

async function fetchLayer(name: LayerName): Promise<FeatureCollection> {
  const cached = join(cacheDir, `${name}.geojson`);
  if (!args.has("--refresh") && existsSync(cached)) {
    return JSON.parse(readFileSync(cached, "utf8")) as FeatureCollection;
  }
  const { id, key } = LAYERS[name];
  const params = new URLSearchParams({
    where: `STATE='${STATE_FIPS}'`,
    outFields: key,
    returnGeometry: "true",
    outSR: "4326",
    // ~1 m: near full resolution, but drops TIGER's collinear vertices.
    maxAllowableOffset: "0.00001",
    geometryPrecision: "6",
    f: "geojson",
  });
  const url = `${SERVICE}/${id}/query?${params}`;
  console.log(`fetching ${name} (layer ${id})…`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
  const collection = (await response.json()) as FeatureCollection & {
    exceededTransferLimit?: boolean;
  };
  if (collection.exceededTransferLimit) throw new Error(`${name}: TIGERweb truncated the result`);
  if (!collection.features?.length) throw new Error(`${name}: no features`);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(cached, JSON.stringify(collection));
  return collection;
}

/** Keep only the id: every byte here ships to every visitor who opens the map. */
function slim(collection: FeatureCollection, key: string): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: collection.features.map((f): Feature => {
      const value = f.properties?.[key];
      if (typeof value !== "string" || !value) throw new Error(`feature without ${key}`);
      return { type: "Feature", id: value, properties: {}, geometry: f.geometry };
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
for (const name of Object.keys(LAYERS) as LayerName[]) {
  source[name] = slim(await fetchLayer(name), LAYERS[name].key);
}

const meta = (await (await fetch(`${SERVICE}?f=json`)).json()) as {
  documentInfo?: { Comments?: string };
};

const full = topology(source);
const simplified = quantize(simplify(presimplify(full), MIN_WEIGHT), QUANTIZATION) as Topology & {
  metadata?: unknown;
};
simplified.metadata = {
  source: `${SERVICE} (layers ${Object.entries(LAYERS)
    .map(([name, { id }]) => `${name}=${id}`)
    .join(", ")})`,
  vintage: meta.documentInfo?.Comments ?? "unknown",
  builtAt: new Date().toISOString().slice(0, 10),
  minWeight: MIN_WEIGHT,
  quantization: QUANTIZATION,
};

mkdirSync(dirname(outFile), { recursive: true });
const json = JSON.stringify(simplified);
writeFileSync(outFile, json);
console.log(
  `wrote ${outFile}: ${(json.length / 1024).toFixed(0)} KB, ${simplified.arcs.length} arcs`,
);
for (const name of Object.keys(LAYERS) as LayerName[]) {
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
}
