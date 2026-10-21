import { expect, test } from "bun:test";
import { webMercator as p } from "../src/lib/projection";

test("round-trips points across California", () => {
  for (const [lon, lat] of [
    [-122.41831, 37.778536],
    [-124.4, 41.9],
    [-114.2, 32.6],
    [-120, 36],
  ] as const) {
    const [x, y] = p.project(lon, lat);
    const [lon2, lat2] = p.invert(x, y);
    expect(lon2).toBeCloseTo(lon, 9);
    expect(lat2).toBeCloseTo(lat, 9);
  }
});

test("north is up and east is right (SVG coordinates)", () => {
  const [, ySouth] = p.project(-120, 33);
  const [, yNorth] = p.project(-120, 41);
  const [xWest] = p.project(-124, 37);
  const [xEast] = p.project(-115, 37);
  expect(yNorth).toBeLessThan(ySouth);
  expect(xWest).toBeLessThan(xEast);
});

test("lands in the same map tile as the tile servers say", () => {
  // SF City Hall is in USGS tile z13 row 3166 column 1310 (fetched 2026-10-21).
  const [x, y] = p.project(-122.41831, 37.778536);
  expect(Math.floor(x * 2 ** 13)).toBe(1310);
  expect(Math.floor(y * 2 ** 13)).toBe(3166);
  // The world's corners.
  expect(p.project(-180, 0)).toEqual([0, 0.5]);
  expect(p.invert(1, 0)[0]).toBe(180);
});
