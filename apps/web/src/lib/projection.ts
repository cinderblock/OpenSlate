/**
 * Web Mercator, the projection of every web map's tiles, so the district map
 * can lie on top of one. Output is in tile units: the whole world is the unit
 * square, x growing east from 180° W and y growing south from 85.05° N (SVG's
 * y axis points down), so tile (z, x, y) covers [x, x + 1] × [y, y + 1] / 2^z.
 * Pure; tested in test/projection.test.ts.
 */

export interface Projection {
  /** Longitude/latitude (degrees) → [x, y]. */
  project(lon: number, lat: number): [number, number];
  /** [x, y] → longitude/latitude (degrees). */
  invert(x: number, y: number): [number, number];
}

const RAD = Math.PI / 180;

export const webMercator: Projection = {
  project(lon, lat) {
    const y = Math.log(Math.tan(Math.PI / 4 + (lat * RAD) / 2));
    return [(lon + 180) / 360, (1 - y / Math.PI) / 2];
  },
  invert(x, y) {
    const lat = 2 * Math.atan(Math.exp(Math.PI * (1 - 2 * y))) - Math.PI / 2;
    return [x * 360 - 180, lat / RAD];
  },
};
