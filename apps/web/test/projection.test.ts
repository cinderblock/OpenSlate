import { expect, test } from "bun:test";
import { albers } from "../src/lib/projection";

const p = albers();

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
