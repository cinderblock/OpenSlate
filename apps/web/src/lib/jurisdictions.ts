/**
 * Jurisdiction paths as slates use them: `us/ca` (statewide), `us/ca/sf` (a
 * locality), `us/ca/cd-11` (a numbered district). Helpers here turn those into
 * the "where do you vote" model:
 *
 * - **Area**: the user's state (implied by their localities and districts),
 *   the localities they vote in, and their district number per district family.
 * - A race is on the user's ballot when its jurisdiction is the state, one of
 *   their localities, or one of their districts. With no area set, every race
 *   counts.
 * - A race's `district` (SPEC §3.3) narrows that to the part of its
 *   jurisdiction that votes on it, e.g. a trustee area of a school district
 *   in the county (`placeRace`). Where the area can't tell, the race is
 *   *unknown*: it may be on the user's ballot.
 *
 * Pure helpers, unit-tested in test/jurisdictions.test.ts.
 */

export type JurisdictionPart =
  | { kind: "none" }
  | { kind: "state"; path: string }
  | { kind: "district"; path: string; state: string; family: string; number: string }
  | { kind: "local"; path: string; state: string; slug: string };

export function parseJurisdiction(path: string | undefined): JurisdictionPart {
  if (!path?.trim()) return { kind: "none" };
  const parts = path.trim().toLowerCase().split("/");
  if (parts.length <= 2) return { kind: "state", path: parts.join("/") };
  const state = parts.slice(0, 2).join("/");
  const leaf = parts.slice(2).join("/");
  const district = leaf.match(/^([a-z]+)-(\d+)$/);
  if (district?.[1] && district[2]) {
    return {
      kind: "district",
      path: `${state}/${leaf}`,
      state,
      family: district[1],
      number: String(Number(district[2])),
    };
  }
  return { kind: "local", path: `${state}/${leaf}`, state, slug: leaf };
}

export interface Area {
  /** Locality paths, e.g. `us/ca/sf`. */
  localities: string[];
  /**
   * District id per family, keyed by the path the family is drawn within plus
   * the family: `{ "us/ca/cd": "11", "us/ca/orange-county/sup": "2" }`.
   * `NO_DISTRICT` means the user is in none of that family's districts.
   */
  districts: Record<string, string>;
  /** What to call the user's district of a family, when its id says nothing (`"us/ca/elsd"` → a school district's name). */
  labels?: Record<string, string>;
  /**
   * Every path the city and county a lookup found may be filed under, used by
   * imported races or not (`localityCandidates`). A path imported races start
   * using later joins `localities` (`withFoundLocalities`), so the area keeps
   * up with the catalog instead of staying as it was on the day of the lookup.
   */
  found?: string[];
  /**
   * Localities the app can't tell are the user's after the catalog re-filed
   * them (`upgradeArea`): My ballot asks.
   */
  recheck?: string[];
}

/** A family's id for "in none of its districts" (most of the state has no unified school district). */
export const NO_DISTRICT = "none";

export const EMPTY_AREA: Area = { localities: [], districts: {} };

export function isAreaSet(area: Area): boolean {
  return area.localities.length > 0 || Object.keys(area.districts).length > 0;
}

/**
 * The area with each path its lookup found (`found`) that imported races now
 * use (`known`) among its localities. The same area when there's none to add.
 */
export function withFoundLocalities(area: Area, known: readonly string[]): Area {
  const add = (area.found ?? []).filter((p) => known.includes(p) && !area.localities.includes(p));
  return add.length > 0 ? { ...area, localities: [...area.localities, ...add] } : area;
}

/**
 * Counties the catalog filed under their city's path until 2026-10-25, then
 * under their own. An area saved before then had the city's path as its
 * county, its city, or both.
 */
const REFILED_COUNTIES: Record<string, string> = {
  "us/ca/san-diego": "us/ca/san-diego-county",
  "us/ca/imperial": "us/ca/imperial-county",
};

/** Cities filed as `city-of-<name>` while their county's races sat under the bare name. */
const CITY_PATHS: Record<string, string> = {
  "us/ca/alameda": "us/ca/city-of-alameda",
};

/**
 * An area saved before the catalog re-filed counties under their own paths,
 * brought up to date. Areas from a lookup since (`found`) are already.
 *
 * - A re-filed county's old path gains the county's own (anyone in the city is
 *   in the county too), and its supervisorial district moves with it. Whether
 *   the city's path is the user's too can't be told: it goes in `recheck`.
 * - The City of Alameda's own races are under `city-of-alameda`, and the
 *   county's sat under its bare name, so a lookup in the city picked the bare
 *   one. Beside the county's own path the bare one was the city's, so the
 *   city's real one is added.
 */
export function upgradeArea(area: Area): Area {
  if (area.found) return area;
  const localities = [...area.localities];
  const districts = { ...area.districts };
  const labels = { ...area.labels };
  const recheck = new Set(area.recheck);
  for (const path of area.localities) {
    const county = REFILED_COUNTIES[path];
    if (county && !localities.includes(county)) {
      localities.push(county);
      recheck.add(path);
      for (const record of [districts, labels] as Record<string, string>[]) {
        const old = record[`${path}/sup`];
        if (old === undefined) continue;
        delete record[`${path}/sup`];
        record[`${county}/sup`] = old;
      }
    }
    const city = CITY_PATHS[path];
    if (city && localities.includes(`${path}-county`) && !localities.includes(city)) {
      localities.push(city);
    }
  }
  if (localities.length === area.localities.length) return area;
  // No `found` here: an area from a lookup since is returned as it is.
  const out: Area = { localities, districts };
  if (Object.keys(labels).length > 0) out.labels = labels;
  if (recheck.size > 0) out.recheck = [...recheck];
  return out;
}

/** States the area implies (from its localities and districts). */
export function areaStates(area: Area): Set<string> {
  const states = new Set<string>();
  for (const path of area.localities) {
    const part = parseJurisdiction(path);
    if (part.kind === "local") states.add(part.state);
  }
  for (const key of Object.keys(area.districts)) {
    states.add(key.split("/").slice(0, 2).join("/"));
  }
  return states;
}

/**
 * Whether a race with this jurisdiction is on the ballot of someone in `area`.
 * Races without a jurisdiction always are (we can't tell). With no area set,
 * everything is.
 */
export function inArea(jurisdiction: string | undefined, area: Area): boolean {
  if (!isAreaSet(area)) return true;
  const part = parseJurisdiction(jurisdiction);
  switch (part.kind) {
    case "none":
      return true;
    case "state": {
      const states = areaStates(area);
      // A national race ("us") is everyone's; a state race only its state's.
      return part.path.split("/").length === 1
        ? [...states].some((s) => s.startsWith(`${part.path}/`))
        : states.has(part.path);
    }
    case "district":
      return area.districts[`${part.state}/${part.family}`] === part.number;
    case "local":
      return area.localities.includes(part.path);
  }
}

/**
 * Whether a race is on the user's ballot: yes, no, or can't tell from their
 * area. A race's district outranks the jurisdiction it was filed under: a
 * school district that crosses a county line is listed by one county, and a
 * voter the area puts in that school district is on it from either side.
 */
export type Placement = "in" | "out" | "unknown";

/** A `district` path segment naming a district of a family: `sup-4`, `unsd-17760`, `ta-b`. */
const DISTRICT_SEGMENT = /^([a-z]+)-(\d+|[a-z])$/;

/** A district id as areas store it: numbers without leading zeros. */
export function districtId(id: string): string {
  return /^\d+$/.test(id) ? String(Number(id)) : id.toLowerCase();
}

/**
 * Whether a race filed under `jurisdiction`, decided by the voters of
 * `district` (SPEC §3.3), is on the ballot of someone in `area`. Out when its
 * jurisdiction isn't the user's (`inArea`); then each segment of `district`
 * narrows it: a family segment (`sup-4`) against the user's district of that
 * family, a place segment against their localities. A family the area doesn't
 * know, or a place it doesn't list (a water district: no boundaries to find it
 * by), makes it unknown, unless a later segment already rules it out.
 */
export function placeRace(
  jurisdiction: string | undefined,
  district: string | undefined,
  area: Area,
): Placement {
  if (!isAreaSet(area)) return "in";
  const here = inArea(jurisdiction, area);
  if (!district?.trim()) return here ? "in" : "out";
  const parts = district.trim().toLowerCase().split("/");
  let prefix = parts.slice(0, 2).join("/");
  if (!areaStates(area).has(prefix)) return "out";
  let placement: Placement = "in";
  // Whether some district segment put the user inside it (their school
  // district), which is more than the filing jurisdiction knows.
  let inside = false;
  for (const segment of parts.slice(2)) {
    const family = DISTRICT_SEGMENT.exec(segment);
    if (family?.[1] && family[2]) {
      const mine = area.districts[`${prefix}/${family[1]}`];
      if (mine === undefined) placement = "unknown";
      else if (mine !== districtId(family[2])) return "out";
      else inside = true;
    } else if (!area.localities.includes(`${prefix}/${segment}`)) {
      placement = "unknown";
    }
    prefix = `${prefix}/${segment}`;
  }
  return here || inside ? placement : "out";
}

const STATE_NAMES: Record<string, string> = {
  "us/ca": "California",
};

const DISTRICT_FAMILIES: Record<string, string> = {
  cd: "Congressional district",
  sd: "State Senate district",
  ad: "Assembly district",
  coa: "Court of Appeal district",
  bart: "BART district",
  boe: "Board of Equalization district",
  unsd: "Unified school district",
  elsd: "Elementary school district",
  scsd: "High school district",
  sup: "Supervisorial district",
  ta: "Trustee area",
};

const LOCALITY_NAMES: Record<string, string> = {
  sf: "San Francisco",
  ebmud: "EBMUD",
  ebrpd: "East Bay Regional Parks",
  laccd: "LA Community College District",
  "san-dieguito-uhsd": "San Dieguito Union High School District",
};

/**
 * The locality path a place name maps to: `localityPathFor("us/ca", "San
 * Francisco")` → `us/ca/sf`. Named localities map back through their label;
 * anything else is slugified.
 */
export function localityPathFor(state: string, name: string): string {
  const wanted = name.trim().toLowerCase();
  const named = Object.entries(LOCALITY_NAMES).find(([, label]) => label.toLowerCase() === wanted);
  const slug =
    named?.[0] ??
    wanted
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  return `${state}/${slug}`;
}

function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((word) => (word ? word[0]?.toUpperCase() + word.slice(1) : word))
    .join(" ");
}

export function districtFamilyLabel(family: string): string {
  return DISTRICT_FAMILIES[family] ?? `${family.toUpperCase()} district`;
}

export function stateLabel(path: string): string {
  return STATE_NAMES[path] ?? path.split("/").pop()?.toUpperCase() ?? path;
}

/** Human label for a jurisdiction path. */
export function jurisdictionLabel(path: string | undefined): string {
  const part = parseJurisdiction(path);
  switch (part.kind) {
    case "none":
      return "Other";
    case "state":
      return part.path === "us" ? "National" : stateLabel(part.path);
    case "district":
      return `${districtFamilyLabel(part.family)} ${part.number}`;
    case "local":
      return LOCALITY_NAMES[part.slug] ?? titleCase(part.slug);
  }
}

/** Sort rank for ballot sections: national, statewide, districts, local, unknown. */
export function jurisdictionRank(path: string | undefined): number {
  const part = parseJurisdiction(path);
  switch (part.kind) {
    case "state":
      return part.path === "us" ? 0 : 1;
    case "district":
      return 2 + Object.keys(DISTRICT_FAMILIES).indexOf(part.family) / 100;
    case "local":
      return 3;
    case "none":
      return 4;
  }
}

/**
 * How many districts each family has. Someone's district is theirs whether or
 * not it has a race this election, so the picker offers all of them.
 */
export const DISTRICT_COUNTS: Record<string, number> = {
  "us/ca/cd": 52,
  "us/ca/sd": 40,
  "us/ca/ad": 80,
  "us/ca/coa": 6,
  "us/ca/bart": 9,
};

const DISTRICT_OFFICES: Record<string, string> = {
  cd: "Congressional",
  sd: "State Senate",
  ad: "Assembly",
  coa: "Court of Appeal",
  bart: "BART board",
};

/** Every district number of a family (`us/ca/sd`), plus any the data uses beyond the known count. */
export function allDistricts(family: string, present: readonly string[]): string[] {
  const count = DISTRICT_COUNTS[family] ?? 0;
  const numbers = new Set(present);
  for (let n = 1; n <= count; n++) numbers.add(String(n));
  return [...numbers].sort((a, b) => Number(a) - Number(b));
}

/**
 * Staggered terms: which half of a family's seats a regular election in a
 * given year fills. California's Senate (Const. art. IV §2): even-numbered
 * districts in gubernatorial years (2026), odd ones in presidential years.
 */
const SEATS_UP: Record<string, (year: number) => "even" | "odd"> = {
  "us/ca/sd": (year) => (year % 4 === 2 ? "even" : "odd"),
};

/**
 * Why a district has no race on this ballot. Where terms are staggered, say
 * whose turn it is: from the known rule for the election's year, or else from
 * the data, when every district that has a race is even (or odd) and they
 * cover about half the family.
 */
export function noRaceReason(
  family: string,
  number: string,
  present: readonly string[],
  election?: string,
): string {
  const kind = family.split("/").pop() ?? family;
  const office = DISTRICT_OFFICES[kind] ?? kind.toUpperCase();
  const year = election ? Number(election.slice(0, 4)) : Number.NaN;
  const rule = SEATS_UP[family];
  let up: "even" | "odd" | undefined = rule && Number.isFinite(year) ? rule(year) : undefined;
  if (!up) {
    const parities = new Set(present.map((n) => Number(n) % 2));
    const count = DISTRICT_COUNTS[family] ?? 0;
    if (present.length >= 3 && parities.size === 1 && present.length * 2 >= count - 1) {
      up = parities.has(0) ? "even" : "odd";
    }
  }
  if (up && Number(number) % 2 !== (up === "even" ? 0 : 1)) {
    return `No ${office} race in district ${number} this election; only ${up}-numbered seats are up.`;
  }
  return `Nothing you've imported has a ${office} race in district ${number} this election.`;
}
