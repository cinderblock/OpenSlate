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
  /** District number per `<state>/<family>`, e.g. `{ "us/ca/cd": "11" }`. */
  districts: Record<string, string>;
}

export const EMPTY_AREA: Area = { localities: [], districts: {} };

export function isAreaSet(area: Area): boolean {
  return area.localities.length > 0 || Object.keys(area.districts).length > 0;
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

const STATE_NAMES: Record<string, string> = {
  "us/ca": "California",
};

const DISTRICT_FAMILIES: Record<string, string> = {
  cd: "Congressional district",
  sd: "State Senate district",
  ad: "Assembly district",
  coa: "Court of Appeal district",
  bart: "BART district",
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

/** Where a state looks up its voters' districts, when we know one. */
export const DISTRICT_LOOKUP: Record<string, string> = {
  "us/ca": "https://findyourrep.legislature.ca.gov/",
};

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
