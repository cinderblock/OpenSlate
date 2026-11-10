import type { DistrictFamily, RegionProfile } from "./types";
import { CALIFORNIA } from "./us-ca/data";
import { US_STATES } from "./usStates";

export type { DistrictFamily, LegislativeLayers, RegionProfile } from "./types";

/**
 * The regions the app has a profile for, by path. Every US state comes from
 * one table (`usStates.ts`); a state with more to say replaces its row.
 * Lookups only: nothing here fetches, and a path with no profile still works
 * everywhere, with its own text as its name.
 */
const REGIONS: ReadonlyMap<string, RegionProfile> = new Map<string, RegionProfile>([
  ...US_STATES,
  [CALIFORNIA.path, CALIFORNIA],
]);

/**
 * Families a city, county or school district draws, the same in every state:
 * found under the place they're drawn in (`us/ca/orange-county/sup`) or the
 * state (`us/ca/unsd`). Listed after the region's own on a ballot.
 */
const LOCAL_FAMILIES: readonly DistrictFamily[] = [
  { key: "unsd", label: "Unified school district", narrows: true },
  { key: "elsd", label: "Elementary school district", narrows: true },
  { key: "scsd", label: "High school district", narrows: true },
  { key: "sup", label: "Supervisorial district", narrows: true },
  { key: "ta", label: "Trustee area", narrows: true },
  { key: "council", label: "Council district", narrows: true },
];

/** The region a path is in or is: `us/ca/sf` → `us/ca`. Undefined for a country alone (`us`). */
export function regionPathOf(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const parts = path.trim().toLowerCase().split("/");
  return parts.length >= 2 && parts[0] && parts[1] ? `${parts[0]}/${parts[1]}` : undefined;
}

/** The profile of a region, by its own path (`us/ca`). */
export function regionProfile(region: string | undefined): RegionProfile | undefined {
  return region ? REGIONS.get(region) : undefined;
}

/** The profile of the region a jurisdiction is in: `us/ca/cd-11` → California's. */
export function regionFor(jurisdiction: string | undefined): RegionProfile | undefined {
  return regionProfile(regionPathOf(jurisdiction));
}

/** Every region with a profile, by name. */
export function allRegions(): RegionProfile[] {
  return [...REGIONS.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The region with this postal code in a country: `regionByCode("us", "CA")`. */
export function regionByCode(country: string, code: string): RegionProfile | undefined {
  return REGIONS.get(`${country.toLowerCase()}/${code.toLowerCase()}`);
}

/**
 * A family by key, in a region when one is given: the region's own, else the
 * local ones every state shares. Without a region, the first region that has
 * the key says what it is (California's `ad` is an Assembly district).
 */
export function districtFamily(key: string, region?: string): DistrictFamily | undefined {
  const local = () => LOCAL_FAMILIES.find((f) => f.key === key);
  if (region) return REGIONS.get(region)?.families.find((f) => f.key === key) ?? local();
  return local() ?? UNSCOPED.get(key);
}

/** Each key's family where no region is known: California's first (the app's first state), then the rest. */
const UNSCOPED: ReadonlyMap<string, DistrictFamily> = (() => {
  const out = new Map<string, DistrictFamily>();
  for (const region of [CALIFORNIA, ...US_STATES.values()]) {
    for (const family of region.families) if (!out.has(family.key)) out.set(family.key, family);
  }
  return out;
})();

/** A family given as areas key it: `us/ca/sd`, `us/ca/orange-county/sup`. */
export function districtFamilyAt(familyPath: string): DistrictFamily | undefined {
  const key = familyPath.split("/").pop() ?? familyPath;
  return districtFamily(key, regionPathOf(familyPath));
}

/**
 * Where a family comes among a region's on a ballot: its own in their order,
 * then the local ones. -1 for a key nobody knows.
 */
export function districtFamilyOrder(key: string, region?: string): number {
  const own = (region ? REGIONS.get(region) : undefined)?.families ?? CALIFORNIA.families;
  const order = [...own, ...LOCAL_FAMILIES];
  return order.findIndex((f) => f.key === key);
}

/**
 * The family a drawn boundary layer is in a region. The layers keep the
 * names California's data gave them: `cd` Congress, `sd` the upper chamber,
 * `ad` the lower one. A region the app has no profile for uses those as they
 * are.
 */
export function layerFamily(
  region: RegionProfile | undefined,
  layer: "cd" | "sd" | "ad",
): string | undefined {
  if (!region) return layer;
  if (layer === "cd") return region.layers.congress;
  return layer === "sd" ? region.layers.upper : region.layers.lower;
}

/** "Alameda County", "Orleans Parish", and "San Francisco" for a city and county in one. */
export function countyLabel(region: RegionProfile | undefined, name: string): string {
  if (!region) return `${name} County`;
  if (region.consolidated?.includes(name) || !region.countyWord) return name;
  return `${name} ${region.countyWord}`;
}
