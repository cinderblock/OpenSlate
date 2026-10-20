/**
 * Albers equal-area conic projection, for drawing a state's districts the way
 * its own maps do (California's "Teale Albers": standard parallels 34° and
 * 40.5°, centred on 120° W). Output is in units of the sphere's radius, with y
 * growing downwards (SVG). Pure; tested in test/projection.test.ts.
 */

export interface Projection {
  /** Longitude/latitude (degrees) → [x, y]. */
  project(lon: number, lat: number): [number, number];
  /** [x, y] → longitude/latitude (degrees). */
  invert(x: number, y: number): [number, number];
}

const RAD = Math.PI / 180;

export function albers({
  parallels = [34, 40.5],
  origin = [-120, 0],
}: { parallels?: [number, number]; origin?: [number, number] } = {}): Projection {
  const [phi1, phi2] = parallels.map((d) => d * RAD) as [number, number];
  const lambda0 = origin[0] * RAD;
  const phi0 = origin[1] * RAD;
  const n = (Math.sin(phi1) + Math.sin(phi2)) / 2;
  const c = Math.cos(phi1) ** 2 + 2 * n * Math.sin(phi1);
  const rho0 = Math.sqrt(c - 2 * n * Math.sin(phi0)) / n;

  return {
    project(lon, lat) {
      const rho = Math.sqrt(c - 2 * n * Math.sin(lat * RAD)) / n;
      const theta = n * (lon * RAD - lambda0);
      // Negate y: SVG's y axis points down.
      return [rho * Math.sin(theta), -(rho0 - rho * Math.cos(theta))];
    },
    invert(x, y) {
      const dy = rho0 + y;
      const rho = Math.sign(n) * Math.hypot(x, dy);
      const theta = Math.atan2(x, dy);
      const lat = Math.asin((c - (rho * n) ** 2) / (2 * n)) / RAD;
      const lon = (lambda0 + theta / n) / RAD;
      return [lon, lat];
    },
  };
}
