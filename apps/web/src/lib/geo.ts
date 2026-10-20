import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { AreaOptions } from "./collate";
import { type Area, localityPathFor } from "./jurisdictions";

/**
 * Finding someone's districts on their own device: boundary data shipped with
 * the app (`public/geo/us-ca.topo.json`, built by scripts/build-geo.ts from
 * Census TIGERweb) and a point-in-polygon lookup over it. Nothing here touches
 * the network except loading that static file. Pure apart from `loadStateGeo`;
 * unit-tested in test/geo.test.ts.
 */

export type GeoLayer = "cd" | "sd" | "ad" | "county" | "place";
export const DISTRICT_LAYERS = ["cd", "sd", "ad"] as const;
export type DistrictLayer = (typeof DISTRICT_LAYERS)[number];

/** States with boundary data, and the file each loads. */
export const GEO_FILES: Record<string, string> = {
  "us/ca": "geo/us-ca.topo.json",
};

type Rings = Position[][];

export interface GeoShape {
  id: string;
  /** Polygons, each an outer ring then holes. */
  polygons: Rings[];
  /** [minX, minY, maxX, maxY] */
  bbox: [number, number, number, number];
}

export interface StateGeo {
  state: string;
  layers: Record<GeoLayer, GeoShape[]>;
  /** [minX, minY, maxX, maxY] of the whole state. */
  bbox: [number, number, number, number];
  /** Where the data came from, for the map's footnote. */
  vintage: string;
}

function shapeOf(f: Feature<Polygon | MultiPolygon>): GeoShape {
  const polygons =
    f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  let [x0, y0, x1, y1] = [
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  ];
  for (const rings of polygons) {
    for (const [x, y] of rings[0] ?? []) {
      if (x === undefined || y === undefined) continue;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    }
  }
  return { id: String(f.id), polygons, bbox: [x0, y0, x1, y1] };
}

/** Decode a state's topology into per-layer shapes. */
export function decodeStateGeo(state: string, topology: Topology): StateGeo {
  const layers = {} as Record<GeoLayer, GeoShape[]>;
  for (const name of ["cd", "sd", "ad", "county", "place"] as const) {
    const object = topology.objects[name] as GeometryCollection | undefined;
    if (!object) throw new Error(`boundary data has no ${name} layer`);
    const collection = feature(topology, object) as unknown as {
      features: Feature<Polygon | MultiPolygon>[];
    };
    layers[name] = collection.features.filter((f) => f.geometry).map(shapeOf);
  }
  const bbox = (topology.bbox ?? [0, 0, 0, 0]) as [number, number, number, number];
  const metadata = (topology as { metadata?: { vintage?: string } }).metadata;
  return { state, layers, bbox, vintage: metadata?.vintage ?? "Census TIGERweb" };
}

const geoCache = new Map<string, Promise<StateGeo>>();

/** Fetch and decode a state's boundaries (once per page load). */
export function loadStateGeo(state: string): Promise<StateGeo> {
  const file = GEO_FILES[state];
  if (!file) return Promise.reject(new Error(`no boundary data for ${state}`));
  let pending = geoCache.get(state);
  if (!pending) {
    pending = fetch(`${import.meta.env.BASE_URL}${file}`)
      .then((response) => {
        if (!response.ok) throw new Error(`boundary data: HTTP ${response.status}`);
        return response.json() as Promise<Topology>;
      })
      .then((topology) => decodeStateGeo(state, topology));
    pending.catch(() => geoCache.delete(state));
    geoCache.set(state, pending);
  }
  return pending;
}

function ringContains(ring: Position[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi = 0, yi = 0] = ring[i] ?? [];
    const [xj = 0, yj = 0] = ring[j] ?? [];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function shapeContains(shape: GeoShape, x: number, y: number): boolean {
  const [x0, y0, x1, y1] = shape.bbox;
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  return shape.polygons.some(
    (rings) =>
      ringContains(rings[0] ?? [], x, y) && !rings.slice(1).some((h) => ringContains(h, x, y)),
  );
}

const METERS_PER_DEGREE_LAT = 110_574;
const METERS_PER_DEGREE_LON_AT_EQUATOR = 111_320;

/** Distance in metres from a point to the nearest edge of a shape (small-area approximation). */
function distanceToEdge(shape: GeoShape, x: number, y: number): number {
  const kx = METERS_PER_DEGREE_LON_AT_EQUATOR * Math.cos((y * Math.PI) / 180);
  const ky = METERS_PER_DEGREE_LAT;
  let best = Number.POSITIVE_INFINITY;
  for (const rings of shape.polygons) {
    for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        const [ax = 0, ay = 0] = ring[i - 1] ?? [];
        const [bx = 0, by = 0] = ring[i] ?? [];
        // Work in metres around the point.
        const px = 0;
        const py = 0;
        const ux = (ax - x) * kx;
        const uy = (ay - y) * ky;
        const vx = (bx - x) * kx;
        const vy = (by - y) * ky;
        const dx = vx - ux;
        const dy = vy - uy;
        const len = dx * dx + dy * dy;
        const t = len ? Math.max(0, Math.min(1, ((px - ux) * dx + (py - uy) * dy) / len)) : 0;
        const d = Math.hypot(ux + t * dx - px, uy + t * dy - py);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

/** The shape of one layer that contains a point, if any. */
export function shapeAt(
  geo: StateGeo,
  layer: GeoLayer,
  lon: number,
  lat: number,
): GeoShape | undefined {
  return geo.layers[layer].find((s) => shapeContains(s, lon, lat));
}

export interface GeoHit {
  /** District number per district layer (`"13"`), when the point is in one. */
  districts: Partial<Record<DistrictLayer, string>>;
  county?: string;
  /** Incorporated city, if any (unincorporated areas have none). */
  place?: string;
  /**
   * Layers whose boundary is within `nearMeters` of the point: the lookup may
   * be wrong there (simplified boundaries, imprecise location).
   */
  nearLine: GeoLayer[];
}

/** Default "near a line" distance: the shipped boundaries are simplified to within tens of metres. */
export const NEAR_LINE_METERS = 75;

/**
 * Which districts, county and city contain a point (longitude, latitude).
 * Null when the point is outside every county (outside the state, or at sea).
 */
export function locate(
  geo: StateGeo,
  lon: number,
  lat: number,
  nearMeters = NEAR_LINE_METERS,
): GeoHit | null {
  const found: Partial<Record<GeoLayer, string>> = {};
  const nearLine: GeoLayer[] = [];
  for (const layer of ["county", "cd", "sd", "ad", "place"] as const) {
    const shape = shapeAt(geo, layer, lon, lat);
    if (!shape) {
      if (layer === "county") return null;
      continue;
    }
    found[layer] = shape.id;
    if (distanceToEdge(shape, lon, lat) < nearMeters) nearLine.push(layer);
  }
  const districts: GeoHit["districts"] = {};
  for (const layer of DISTRICT_LAYERS) {
    const n = found[layer];
    if (n) districts[layer] = String(Number(n));
  }
  return { districts, county: found.county, place: found.place, nearLine };
}

/**
 * California Courts of Appeal by county (Gov. Code §69100–69106). Retention
 * races for appellate justices are filed under `us/ca/coa-<n>`.
 */
export const COURT_OF_APPEAL_BY_COUNTY: Record<string, string> = Object.fromEntries(
  Object.entries({
    1: "Alameda, Contra Costa, Del Norte, Humboldt, Lake, Marin, Mendocino, Napa, San Francisco, San Mateo, Solano, Sonoma",
    2: "Los Angeles, San Luis Obispo, Santa Barbara, Ventura",
    3: "Alpine, Amador, Butte, Calaveras, Colusa, El Dorado, Glenn, Lassen, Modoc, Mono, Nevada, Placer, Plumas, Sacramento, San Joaquin, Shasta, Sierra, Siskiyou, Sutter, Tehama, Trinity, Yolo, Yuba",
    4: "Imperial, Inyo, Orange, Riverside, San Bernardino, San Diego",
    5: "Fresno, Kern, Kings, Madera, Mariposa, Merced, Stanislaus, Tulare, Tuolumne",
    6: "Monterey, San Benito, Santa Clara, Santa Cruz",
  }).flatMap(([n, counties]) => counties.split(", ").map((county) => [county, n])),
);

/**
 * Locality paths a city or county may be filed under. The catalog spells
 * counties `<name>-county` (sometimes bare `<name>`), cities by name
 * (sometimes `city-of-<name>`), and San Francisco, a city and county, `sf`.
 */
export function localityCandidates(
  state: string,
  kind: "place" | "county",
  name: string,
): string[] {
  const base = localityPathFor(state, name);
  const slug = base.slice(state.length + 1);
  if (kind === "county") {
    return base === `${state}/sf` ? [base] : [`${base}-county`, base];
  }
  return [base, `${state}/city-of-${slug}`];
}

export interface AreaFromHit {
  area: Area;
  /** What the lookup found, in words, e.g. ["San Francisco (city)", "San Francisco County"]. */
  places: string[];
  /** District families that imported races use but the boundary data doesn't cover (BART…). */
  notCovered: string[];
}

/**
 * Turn a hit into an area. Districts are always set (a district with no race
 * this election is still the user's district); localities only when some
 * imported race is filed under them, so the area isn't filled with places
 * nothing uses.
 */
export function areaFromHit(hit: GeoHit, state: string, known: AreaOptions): AreaFromHit {
  const districts: Record<string, string> = {};
  for (const [layer, n] of Object.entries(hit.districts)) districts[`${state}/${layer}`] = n;
  const coa = hit.county ? COURT_OF_APPEAL_BY_COUNTY[hit.county] : undefined;
  if (state === "us/ca" && coa) districts[`${state}/coa`] = coa;

  const localities: string[] = [];
  const add = (kind: "place" | "county", name: string | undefined) => {
    if (!name) return;
    const path = localityCandidates(state, kind, name).find((p) => known.localities.includes(p));
    if (path && !localities.includes(path)) localities.push(path);
  };
  add("place", hit.place);
  add("county", hit.county);

  const covered = new Set(Object.keys(districts));
  const notCovered = Object.keys(known.districts).filter(
    (family) => family.startsWith(`${state}/`) && !covered.has(family),
  );
  const places = [
    ...(hit.place ? [hit.place] : []),
    // San Francisco is one city and county; say it once.
    ...(hit.county && !(hit.county === "San Francisco" && hit.place === hit.county)
      ? [`${hit.county} County`]
      : []),
  ];
  return { area: { localities, districts }, places, notCovered };
}

/**
 * Apply a lookup to the area someone already has. The lookup replaces what it
 * can know (its districts, and every locality that is a city or county); what
 * it can't (a BART district, EBMUD, a school district) is kept as it was.
 */
export function mergeFoundArea(previous: Area, found: Area, geo: StateGeo): Area {
  const cityOrCounty = new Set<string>();
  for (const shape of geo.layers.place) {
    for (const path of localityCandidates(geo.state, "place", shape.id)) cityOrCounty.add(path);
  }
  for (const shape of geo.layers.county) {
    for (const path of localityCandidates(geo.state, "county", shape.id)) cityOrCounty.add(path);
  }
  const localities = [
    ...found.localities,
    ...previous.localities.filter((p) => !cityOrCounty.has(p) && !found.localities.includes(p)),
  ];
  return { localities, districts: { ...previous.districts, ...found.districts } };
}
