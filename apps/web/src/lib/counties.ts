import { type Area, localityPathFor } from "./jurisdictions";
import { type RegionProfile, regionFor } from "./regions";

/**
 * Which county a locality path is, where a region's profile lists its
 * counties. Pure; unit-tested in test/ballotOrder.test.ts.
 */

/**
 * Every county's paths in a region, built once: sorting a ballot asks for
 * thousands, and slugifying every name each time froze the race page for over
 * a second. A county is `<name>-county`, and its bare name too unless a city
 * has that (`RegionProfile.namesakeCities`, as `localityCandidates` files them).
 */
const tables = new WeakMap<RegionProfile, Map<string, string>>();
function countyPaths(region: RegionProfile): Map<string, string> {
  let table = tables.get(region);
  if (table) return table;
  table = new Map<string, string>();
  const namesakes = new Set(region.namesakeCities ?? []);
  for (const county of region.counties ?? []) {
    const base = localityPathFor(region.path, county);
    if (!table.has(`${base}-county`)) table.set(`${base}-county`, county);
    if (!namesakes.has(county) && !table.has(base)) table.set(base, county);
  }
  tables.set(region, table);
  return table;
}

/** The county a locality path is, if it is one: `us/ca/marin-county`, `us/ca/marin`, `us/ca/sf`. */
export function countyOfPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const region = regionFor(path);
  return region?.counties ? countyPaths(region).get(path) : undefined;
}

/** The counties the voter's area puts them in (normally one). */
export function voterCounties(area: Area | undefined): string[] {
  if (!area) return [];
  const paths = new Set([...area.localities, ...(area.found ?? [])]);
  return [...new Set([...paths].map(countyOfPath).filter((c): c is string => !!c))];
}
