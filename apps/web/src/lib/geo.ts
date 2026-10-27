import type { Feature, MultiPolygon, Polygon, Position } from "geojson";
import { feature, neighbors } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import type { AreaOptions } from "./collate";
import { type Area, NO_DISTRICT, districtId, localityPathFor } from "./jurisdictions";

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
/**
 * Layers looked up, not drawn: they place the races only part of a county or
 * the state votes on (`subject.district`; plans/sub-county-districts.md).
 * School districts (Census TIGER: unified, elementary, secondary) by 5-digit
 * LEA code, Board of Equalization districts, community college districts by
 * Chancellor's Office code, and supervisorial districts as `<County>|<n>`.
 */
export const LOOKUP_LAYERS = ["unsd", "elsd", "scsd", "boe", "ccd", "sup"] as const;
export type LookupLayer = (typeof LOOKUP_LAYERS)[number];
/**
 * Lookup layers that map every inch of the state, so a point in none of their
 * districts is in none (`NO_DISTRICT`: most of California has no unified
 * school district). In the others a point in none is a gap in the data, or a
 * county we have no supervisorial map for, and stays unknown.
 */
const COMPLETE_LAYERS: readonly LookupLayer[] = ["unsd", "elsd", "scsd"];

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
  /** What it's called, when the id doesn't say (school districts). */
  name?: string;
  /**
   * Map colour, 0–3, different from every neighbour's in the same layer (see
   * `fourColor`). Cities aren't coloured (always 0).
   */
  color: number;
}

export interface StateGeo {
  state: string;
  layers: Record<GeoLayer, GeoShape[]>;
  /** Lookup layers; empty in boundary data built without them. */
  lookups: Record<LookupLayer, GeoShape[]>;
  /** [minX, minY, maxX, maxY] of the whole state. */
  bbox: [number, number, number, number];
  /** Where the data came from, for the map's footnote. */
  vintage: string;
}

function shapeOf(f: Feature<Polygon | MultiPolygon, { name?: unknown } | null>): GeoShape {
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
  const name = f.properties?.name;
  return {
    id: String(f.id),
    polygons,
    bbox: [x0, y0, x1, y1],
    ...(typeof name === "string" ? { name } : {}),
    color: 0,
  };
}

/**
 * Colour a map with four colours so no two neighbours match (any flat map can
 * be; greedy colouring alone needs five for California's congressional and
 * Assembly districts). `adjacency[i]` lists the neighbours of region i.
 * Backtracking search, always colouring the most constrained region next
 * (DSatur), ties broken by index so the result is the same on every device.
 * Undefined if four colours can't be found (as when five regions all meet at
 * one point and corners count as touching).
 */
export function fourColor(adjacency: number[][]): number[] | undefined {
  const n = adjacency.length;
  const color = new Array<number>(n).fill(-1);
  const next = (): number => {
    let best = -1;
    let bestSat = -1;
    let bestDegree = -1;
    for (let i = 0; i < n; i++) {
      if (color[i] !== -1) continue;
      const sat = new Set(adjacency[i]?.map((j) => color[j]).filter((c) => c !== -1)).size;
      const degree = adjacency[i]?.length ?? 0;
      if (sat > bestSat || (sat === bestSat && degree > bestDegree)) {
        best = i;
        bestSat = sat;
        bestDegree = degree;
      }
    }
    return best;
  };
  let steps = 0;
  const solve = (colored: number): boolean => {
    if (colored === n) return true;
    if (++steps > 100_000) return false;
    const i = next();
    const used = new Set(adjacency[i]?.map((j) => color[j]));
    for (let c = 0; c < 4; c++) {
      if (used.has(c)) continue;
      color[i] = c;
      if (solve(colored + 1)) return true;
    }
    color[i] = -1;
    return false;
  };
  return solve(0) ? color : undefined;
}

/**
 * Which shapes of a layer touch, even at a single point: two shapes the same
 * colour meeting at a corner read as one. Wherever two shapes meet, the
 * topology starts or ends an arc, so comparing arc endpoints finds every
 * contact without walking every vertex.
 */
export function touching(topology: Topology, object: GeometryCollection): number[][] {
  const delta = Boolean(topology.transform);
  const ends = topology.arcs.map((arc) => {
    const first = arc[0] ?? [0, 0];
    let last = arc[arc.length - 1] ?? first;
    if (delta) {
      // Quantized arcs store each point as an offset from the previous one.
      let x = 0;
      let y = 0;
      for (const [dx = 0, dy = 0] of arc) {
        x += dx;
        y += dy;
      }
      last = [x, y];
    }
    return [`${first[0]},${first[1]}`, `${last[0]},${last[1]}`];
  });
  const owners = new Map<string, Set<number>>();
  const visit = (arcs: unknown, shape: number) => {
    if (typeof arcs === "number") {
      for (const key of ends[arcs < 0 ? ~arcs : arcs] ?? []) {
        const set = owners.get(key) ?? new Set<number>();
        set.add(shape);
        owners.set(key, set);
      }
    } else if (Array.isArray(arcs)) {
      for (const a of arcs) visit(a, shape);
    }
  };
  object.geometries.forEach((g, i) => visit("arcs" in g ? g.arcs : undefined, i));
  const adjacency = object.geometries.map(() => new Set<number>());
  for (const shapes of owners.values()) {
    for (const a of shapes) for (const b of shapes) if (a !== b) adjacency[a]?.add(b);
  }
  return adjacency.map((s) => [...s].sort((a, b) => a - b));
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
    // Colour by every contact, corners included; if that can't be done in
    // four, by shared borders alone (always possible on a flat map).
    const colors =
      name === "place"
        ? []
        : (fourColor(touching(topology, object)) ?? fourColor(neighbors(object.geometries)) ?? []);
    layers[name] = collection.features.flatMap((f, i) =>
      f.geometry ? [{ ...shapeOf(f), color: colors[i] ?? 0 }] : [],
    );
  }
  const lookups = {} as Record<LookupLayer, GeoShape[]>;
  for (const name of LOOKUP_LAYERS) {
    const object = topology.objects[name] as GeometryCollection | undefined;
    const collection = object
      ? (feature(topology, object) as unknown as { features: Feature<Polygon | MultiPolygon>[] })
      : { features: [] };
    lookups[name] = collection.features.flatMap((f) => (f.geometry ? [shapeOf(f)] : []));
  }
  const bbox = (topology.bbox ?? [0, 0, 0, 0]) as [number, number, number, number];
  const metadata = (topology as { metadata?: { vintage?: string } }).metadata;
  return { state, layers, lookups, bbox, vintage: metadata?.vintage ?? "Census TIGERweb" };
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
  nearLine: (GeoLayer | LookupLayer)[];
  /**
   * The point's district per lookup layer (`NO_DISTRICT` id: in none), when
   * the boundary data has them. A layer is left out when the point is near one
   * of its lines, or (`COMPLETE_LAYERS` aside) in none of its districts: better
   * a race listed as "might be on your ballot" than hidden by a guess.
   */
  lookups?: Partial<Record<LookupLayer, { id: string; name?: string }>>;
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
  const extra = lookupsAt(geo, lon, lat, found.county, nearMeters);
  return {
    districts,
    county: found.county,
    place: found.place,
    nearLine: [...nearLine, ...(extra?.nearLine ?? [])],
    ...(extra ? { lookups: extra.lookups } : {}),
  };
}

/**
 * A point's districts in the lookup layers (`GeoHit.lookups`), and the layers
 * it's near a line of; undefined when the boundary data has none. `county`
 * (as TIGER names it) picks the supervisorial districts to look in. Also for
 * an address the Census geocoder placed: its relay returns legislative
 * districts, not these.
 */
export function lookupsAt(
  geo: StateGeo,
  lon: number,
  lat: number,
  county: string | undefined,
  nearMeters = NEAR_LINE_METERS,
): { lookups: NonNullable<GeoHit["lookups"]>; nearLine: LookupLayer[] } | undefined {
  if (LOOKUP_LAYERS.every((layer) => geo.lookups[layer].length === 0)) return undefined;
  // Shapes whose box comes within `nearMeters` of the point: the only ones
  // whose line could be that close.
  const dx = nearMeters / (METERS_PER_DEGREE_LON_AT_EQUATOR * Math.cos((lat * Math.PI) / 180));
  const dy = nearMeters / METERS_PER_DEGREE_LAT;
  const lookups: NonNullable<GeoHit["lookups"]> = {};
  const nearLine: LookupLayer[] = [];
  for (const layer of LOOKUP_LAYERS) {
    const shapes =
      layer === "sup"
        ? geo.lookups.sup.filter((s) => county && s.id.startsWith(`${county}|`))
        : geo.lookups[layer];
    if (shapes.length === 0) continue;
    const nearby = shapes.filter(
      ({ bbox: [x0, y0, x1, y1] }) =>
        lon >= x0 - dx && lon <= x1 + dx && lat >= y0 - dy && lat <= y1 + dy,
    );
    if (nearby.some((shape) => distanceToEdge(shape, lon, lat) < nearMeters)) {
      nearLine.push(layer);
      continue;
    }
    const shape = nearby.find((s) => shapeContains(s, lon, lat));
    if (shape) lookups[layer] = { id: shape.id, ...(shape.name ? { name: shape.name } : {}) };
    else if (COMPLETE_LAYERS.includes(layer)) lookups[layer] = { id: NO_DISTRICT };
  }
  return { lookups, nearLine };
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
 * Locality paths a city or county may be filed under. A city is `<name>` (or
 * `city-of-<name>`), by its Census name and, for one like "San Buenaventura
 * (Ventura)", its everyday name too. A county is `<name>-county`, or its bare
 * name when no city has that (`cities`, every city's paths, `cityPaths`):
 * `us/ca/orange` is the City of Orange's, never the county's. San Francisco,
 * one city and county, is `sf`.
 */
export function localityCandidates(
  state: string,
  kind: "place" | "county",
  name: string,
  cities: ReadonlySet<string> = new Set(),
): string[] {
  if (kind === "county") {
    const base = localityPathFor(state, name);
    if (base === `${state}/sf`) return [base];
    return cities.has(base) ? [`${base}-county`] : [`${base}-county`, base];
  }
  const everyday = /^(.+?)\s*\(([^)]+)\)$/.exec(name.trim());
  const names = everyday?.[1] && everyday[2] ? [everyday[1], everyday[2]] : [name];
  return names.flatMap((n) => {
    const base = localityPathFor(state, n);
    return [base, `${state}/city-of-${base.slice(state.length + 1)}`];
  });
}

const cityPathsOf = new WeakMap<StateGeo, ReadonlySet<string>>();

/** Every path a city of the state may be filed under (`localityCandidates`). */
export function cityPaths(geo: StateGeo): ReadonlySet<string> {
  let paths = cityPathsOf.get(geo);
  if (!paths) {
    paths = new Set(geo.layers.place.flatMap((s) => localityCandidates(geo.state, "place", s.id)));
    cityPathsOf.set(geo, paths);
  }
  return paths;
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
 * nothing uses. Every path the city and county may be filed under is kept in
 * `found`, for when races start using one (`withFoundLocalities`). `cities`:
 * the state's cities' paths (`cityPaths`), so a county never takes a city's.
 */
export function areaFromHit(
  hit: GeoHit,
  state: string,
  known: AreaOptions,
  cities?: ReadonlySet<string>,
): AreaFromHit {
  const districts: Record<string, string> = {};
  for (const [layer, n] of Object.entries(hit.districts)) districts[`${state}/${layer}`] = n;
  const coa = hit.county ? COURT_OF_APPEAL_BY_COUNTY[hit.county] : undefined;
  if (state === "us/ca" && coa) districts[`${state}/coa`] = coa;

  const localities: string[] = [];
  const found: string[] = [];
  const add = (kind: "place" | "county", name: string | undefined) => {
    if (!name) return undefined;
    const candidates = localityCandidates(state, kind, name, cities);
    for (const path of candidates) {
      if (!found.includes(path)) found.push(path);
      if (known.localities.includes(path) && !localities.includes(path)) localities.push(path);
    }
    // The one its races use, else where they'd be filed (`<name>-county`).
    return candidates.find((p) => known.localities.includes(p)) ?? candidates[0];
  };
  add("place", hit.place);
  const countyPath = add("county", hit.county);

  const labels: Record<string, string> = {};
  for (const [layer, { id, name }] of Object.entries(hit.lookups ?? {})) {
    if (layer === "sup") {
      // Filed under the county, as its races are: `us/ca/orange-county/sup`.
      const n = id.split("|").pop() ?? "";
      if (!countyPath || !n) continue;
      districts[`${countyPath}/sup`] = districtId(n);
      const county = hit.county === "San Francisco" ? "San Francisco" : `${hit.county} County`;
      labels[`${countyPath}/sup`] = `${county} supervisorial district ${districtId(n)}`;
      continue;
    }
    const family = `${state}/${layer}`;
    districts[family] = id === NO_DISTRICT ? NO_DISTRICT : districtId(id);
    if (name) labels[family] = name;
  }

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
  const area: Area = { localities, districts };
  if (Object.keys(labels).length > 0) area.labels = labels;
  if (found.length > 0) area.found = found;
  return { area, places, notCovered };
}

/** An area's families from the lookup layers (`us/ca/elsd`, `us/ca/orange-county/sup`…). */
function isLookupFamily(family: string): boolean {
  return (LOOKUP_LAYERS as readonly string[]).includes(family.split("/").pop() ?? "");
}

/**
 * Apply a lookup to the area someone already has. The lookup replaces what it
 * can know (its districts, and every locality that is a city or county); what
 * it can't (a BART district, EBMUD) is kept as it was. Lookup layers' districts
 * (school, community college, supervisorial…) are always replaced: one the
 * lookup couldn't tell (near a line, or a lookup without them) is better
 * unknown than left over from somewhere else.
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
  const kept = (family: string) => !isLookupFamily(family);
  const districts = {
    ...Object.fromEntries(Object.entries(previous.districts).filter(([f]) => kept(f))),
    ...found.districts,
  };
  const labels = {
    ...Object.fromEntries(Object.entries(previous.labels ?? {}).filter(([f]) => kept(f))),
    ...found.labels,
  };
  // The lookup's own `found`; `recheck` is answered by the lookup.
  const area: Area = { localities, districts };
  if (Object.keys(labels).length > 0) area.labels = labels;
  if (found.found) area.found = found.found;
  // The user's own answers outlast a lookup; a district it finds outranks them (`placeRace`).
  if (previous.answers) area.answers = previous.answers;
  return area;
}
