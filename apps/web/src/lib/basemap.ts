import { createLocalStore, useLocalStore } from "./localStore";

/**
 * Optional backgrounds for the district map: map tiles from the US Geological
 * Survey's The National Map (public domain, no key). Streets unless the user
 * picks otherwise; loading tiles tells USGS roughly which area is on screen,
 * so the map says so and Off stops it. Where they click is still worked out
 * on the device. Pure apart from the store; tested in test/basemap.test.ts.
 */

export type Basemap = "off" | "streets" | "satellite";

export interface BasemapInfo {
  name: string;
  /** Tile service on basemap.nationalmap.gov. */
  service: string;
  /** Deepest zoom with tiles; beyond it the map scales these up. */
  maxZoom: number;
}

export const BASEMAPS: Record<Exclude<Basemap, "off">, BasemapInfo> = {
  streets: { name: "Streets", service: "USGSTopo", maxZoom: 16 },
  // Aerial imagery with roads and place names on top.
  satellite: { name: "Satellite", service: "USGSImageryTopo", maxZoom: 16 },
};

/** Who serves the tiles, for the disclosure and the credit on the map. */
export const BASEMAP_SOURCE = {
  recipient: "the US Geological Survey (The National Map)",
  credit: "USGS The National Map",
  creditUrl: "https://www.usgs.gov/programs/national-geospatial-program/national-map",
  policyUrl: "https://www.usgs.gov/privacy-policies",
};

export function tileUrl(info: BasemapInfo, z: number, x: number, y: number): string {
  // ArcGIS tile services take the row before the column.
  return `https://basemap.nationalmap.gov/arcgis/rest/services/${info.service}/MapServer/tile/${z}/${y}/${x}`;
}

/** A rectangle in tile units: the world is the unit square (see projection.ts). */
export interface TileView {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The zoom whose 256 px tiles come nearest their natural size on screen. */
export function tileZoom(view: TileView, pixelsAcross: number, maxZoom: number): number {
  const z = Math.round(Math.log2(pixelsAcross / (view.w * 256)));
  return Math.min(maxZoom, Math.max(0, z));
}

/** Most tiles one zoom level will draw; more means something is off. */
const MAX_TILES = 400;

export interface MapTile {
  z: number;
  x: number;
  y: number;
}

/** The tiles at zoom `z` that `view` overlaps. */
export function tilesFor(view: TileView, z: number): MapTile[] {
  const n = 2 ** z;
  const x0 = Math.max(0, Math.floor(view.x * n));
  const x1 = Math.min(n - 1, Math.floor((view.x + view.w) * n));
  const y0 = Math.max(0, Math.floor(view.y * n));
  const y1 = Math.min(n - 1, Math.floor((view.y + view.h) * n));
  if ((x1 - x0 + 1) * (y1 - y0 + 1) > MAX_TILES) return [];
  const tiles: MapTile[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ z, x, y });
  return tiles;
}

/**
 * The tiles to draw for `view` at zoom `z`, bottom first: under each tile not
 * loaded yet, the one a zoom out that covers it (zooming in, that one is
 * already loaded; zooming out, it was on screen a moment ago), so the map
 * doesn't flash empty. Once a tile is in, what's under it goes: imagery is
 * transparent over open water, and a backdrop showing through reads as a
 * second map.
 */
export function tilesToDraw(
  view: TileView,
  z: number,
  loaded: (tile: MapTile) => boolean,
): MapTile[] {
  const own = tilesFor(view, z);
  if (z === 0) return own;
  const waiting = new Set(own.filter((t) => !loaded(t)).map((t) => `${t.x >> 1}/${t.y >> 1}`));
  return [...tilesFor(view, z - 1).filter((t) => waiting.has(`${t.x}/${t.y}`)), ...own];
}

const basemapStore = createLocalStore<Basemap>("openslate.basemap.v1", "streets", (raw) =>
  raw === "off" || raw === "streets" || raw === "satellite" ? raw : undefined,
);

/** The district map's background: Streets until the user picks (remembered here only). */
export function useBasemap(): [Basemap, (next: Basemap) => void] {
  return useLocalStore(basemapStore);
}
