import type { CivicBallot } from "@openslate/core";
import type { AreaOptions } from "./collate";
import { type Area, localityPathFor } from "./jurisdictions";

/**
 * "Where you vote" from a Civic Info ballot lookup. Each contest names its
 * district by scope and number, which maps straight onto the area model;
 * citywide and countywide contests name the locality. Pure; unit-tested in
 * test/civicArea.test.ts.
 */

/** Civic Info district scope → the catalog's district family. */
const FAMILY_BY_SCOPE: Record<string, string> = {
  congressional: "cd",
  stateUpper: "sd",
  stateLower: "ad",
};

const LOCAL_SCOPES = new Set(["citywide", "cityCouncil", "countywide", "countyCouncil"]);

export interface AreaFromLookup {
  area: Area;
  /** Localities the lookup named that no imported race uses, so they were left out. */
  unknownLocalities: string[];
}

/**
 * Build an area from a lookup. Only localities that imported races actually
 * use are kept (`known`), so a lookup can't fill the area with places nothing
 * is filed under. Returns null when the state is unknown: paths need it.
 */
export function areaFromLookup(lookup: CivicBallot, known: AreaOptions): AreaFromLookup | null {
  if (!lookup.state) return null;
  const state = `us/${lookup.state}`;
  const area: Area = { localities: [], districts: {} };
  const unknownLocalities: string[] = [];
  for (const contest of lookup.contests) {
    const district = contest.district;
    if (!district?.scope) continue;
    const family = FAMILY_BY_SCOPE[district.scope];
    if (family && district.id && /^\d+$/.test(district.id)) {
      area.districts[`${state}/${family}`] = String(Number(district.id));
      continue;
    }
    if (LOCAL_SCOPES.has(district.scope) && district.name) {
      const path = localityPathFor(state, district.name);
      if (known.localities.includes(path)) {
        if (!area.localities.includes(path)) area.localities.push(path);
      } else if (!unknownLocalities.includes(district.name)) {
        unknownLocalities.push(district.name);
      }
    }
  }
  return { area, unknownLocalities };
}
