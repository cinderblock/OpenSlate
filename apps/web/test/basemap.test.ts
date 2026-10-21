import { expect, test } from "bun:test";
import { BASEMAPS, tileUrl, tileZoom, tilesFor, tilesToDraw } from "../src/lib/basemap";
import { webMercator } from "../src/lib/projection";

test("tile URLs put the row before the column", () => {
  expect(tileUrl(BASEMAPS.streets, 13, 1310, 3166)).toBe(
    "https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/13/3166/1310",
  );
});

test("tileZoom picks tiles near 256 px on screen, within the service's range", () => {
  // The whole world 256 px wide is zoom 0; 512 px is zoom 1.
  expect(tileZoom({ x: 0, y: 0, w: 1, h: 1 }, 256, 16)).toBe(0);
  expect(tileZoom({ x: 0, y: 0, w: 1, h: 1 }, 512, 16)).toBe(1);
  // California (about 10.4° of longitude) across 600 px: zoom 6 tiles show at about 320 px.
  const [x0] = webMercator.project(-124.5, 38);
  const [x1] = webMercator.project(-114.1, 38);
  expect(tileZoom({ x: x0, y: 0, w: x1 - x0, h: 0.03 }, 600, 16)).toBe(6);
  // A city block: capped at the deepest zoom.
  expect(tileZoom({ x: 0.16, y: 0.38, w: 1e-6, h: 1e-6 }, 600, 16)).toBe(16);
});

test("tilesFor lists the tiles a view overlaps, clipped to the world", () => {
  expect(tilesFor({ x: 0.3, y: 0.3, w: 0.3, h: 0.1 }, 2)).toEqual([
    { z: 2, x: 1, y: 1 },
    { z: 2, x: 2, y: 1 },
  ]);
  expect(tilesFor({ x: -1, y: -1, w: 3, h: 3 }, 1)).toHaveLength(4);
  // Absurdly many tiles: none, rather than hang the page.
  expect(tilesFor({ x: 0, y: 0, w: 1, h: 1 }, 10)).toEqual([]);
});

test("tilesToDraw backs each tile still loading with the one a zoom out, and only those", () => {
  // Zoom 2 tiles (1,1) and (2,1); the zoom 1 tiles over them are (0,0) and (1,0).
  const view = { x: 0.3, y: 0.3, w: 0.3, h: 0.1 };
  const own = [
    { z: 2, x: 1, y: 1 },
    { z: 2, x: 2, y: 1 },
  ];
  expect(tilesToDraw(view, 2, () => false)).toEqual([
    { z: 1, x: 0, y: 0 },
    { z: 1, x: 1, y: 0 },
    ...own,
  ]);
  // (1,1) is in, so (0,0) under it goes: no second map showing through.
  expect(tilesToDraw(view, 2, (t) => t.x === 1)).toEqual([{ z: 1, x: 1, y: 0 }, ...own]);
  expect(tilesToDraw(view, 2, () => true)).toEqual(own);
  expect(tilesToDraw({ x: 0, y: 0, w: 1, h: 1 }, 0, () => false)).toEqual([{ z: 0, x: 0, y: 0 }]);
});
