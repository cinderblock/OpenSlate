import { compareDistrictIds, districtId } from "@openslate/core";
import { memoByString } from "./memoByString";
import {
  allRegions,
  districtFamily,
  districtFamilyAt,
  districtFamilyOrder,
  regionFor,
  regionProfile,
} from "./regions";

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
 * - A regional race's `voted_in` (SPEC §3.3) says which jurisdictions vote on
 *   it, where its own path (`us/ca/bay-area`) doesn't say what it contains:
 *   it is on the ballot of anyone in one of them.
 *
 * Pure helpers, unit-tested in test/jurisdictions.test.ts.
 */

export type JurisdictionPart =
  | { kind: "none" }
  | { kind: "state"; path: string }
  /** `number`: the district's id, which some states letter (`35a`) or name (`third-middlesex`). */
  | { kind: "district"; path: string; state: string; family: string; number: string }
  | { kind: "local"; path: string; state: string; slug: string };

const NONE: JurisdictionPart = Object.freeze({ kind: "none" });

/**
 * A jurisdiction path's parts. Remembered per path: collating a whole catalog
 * asks this tens of thousands of times over a few hundred paths. The answer is
 * shared, so it's frozen.
 */
export function parseJurisdiction(path: string | undefined): JurisdictionPart {
  return path === undefined ? NONE : parsePath(path);
}

const parsePath = memoByString((path: string): JurisdictionPart => {
  if (!path.trim()) return NONE;
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
  // A legislative district that isn't numbered: Minnesota's `hd-35a`, Alaska's
  // `sd-i`, Massachusetts' `sd-third-middlesex`. Only for the families the
  // state's own legislature and Congress use, so a town can still be called
  // anything.
  const named = leaf.match(/^([a-z]+)-([a-z0-9][a-z0-9-]*)$/);
  if (named?.[1] && named[2] && isLegislativeFamily(state, named[1])) {
    return {
      kind: "district",
      path: `${state}/${leaf}`,
      state,
      family: named[1],
      number: districtId(named[2]),
    };
  }
  return { kind: "local", path: `${state}/${leaf}`, state, slug: leaf };
});

/** Whether a family is Congress or a chamber of the region's legislature, by its profile. */
function isLegislativeFamily(region: string, family: string): boolean {
  const layers = regionProfile(region)?.layers;
  return (
    layers !== undefined &&
    (family === layers.congress || family === layers.upper || family === layers.lower)
  );
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
  /**
   * The user's own word on races the area couldn't place, by `district` path:
   * on their ballot or not (`answerPlacement`). Yes to
   * `us/ca/sunnyvale/council-3` also says which council district they're in.
   */
  answers?: Record<string, boolean>;
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
 * Paths the catalog once filed differently, from every region's profile
 * (`RegionProfile.refiled`): counties that sat under their city's path, and
 * cities filed as `city-of-<name>` while their county had the bare name.
 */
const REFILED_COUNTIES: Record<string, string> = Object.assign(
  {},
  ...allRegions().map((region) => region.refiled?.counties ?? {}),
);
const CITY_PATHS: Record<string, string> = Object.assign(
  {},
  ...allRegions().map((region) => region.refiled?.cities ?? {}),
);

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
  if (area.answers) out.answers = area.answers;
  return out;
}

/**
 * The area with only what's in one state (`us/tx`): someone votes in one, so
 * setting a place or district in another by hand leaves the first behind.
 * The same area when everything is already there, or no state is given.
 */
export function inOneState(area: Area, state: string | undefined): Area {
  if (!state) return area;
  const here = (path: string) => path === state || path.startsWith(`${state}/`);
  const pick = <T>(record: Record<string, T> | undefined) =>
    record && Object.fromEntries(Object.entries(record).filter(([path]) => here(path)));
  const all = [
    ...area.localities,
    ...Object.keys(area.districts),
    ...(area.found ?? []),
    ...(area.recheck ?? []),
    ...Object.keys(area.labels ?? {}),
    ...Object.keys(area.answers ?? {}),
  ];
  if (all.every(here)) return area;
  const next: Area = {
    localities: area.localities.filter(here),
    districts: pick(area.districts) ?? {},
  };
  const labels = pick(area.labels);
  if (labels && Object.keys(labels).length > 0) next.labels = labels;
  const found = area.found?.filter(here);
  if (found?.length) next.found = found;
  const recheck = area.recheck?.filter(here);
  if (recheck?.length) next.recheck = recheck;
  const answers = pick(area.answers);
  if (answers && Object.keys(answers).length > 0) next.answers = answers;
  return next;
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

/**
 * A district's id as areas and paths spell it, from what it's called
 * (core's districts.ts): `07` → `7`, `35A` → `35a`, `Third Middlesex` →
 * `third-middlesex`.
 */
export { districtId };

/**
 * Whether a race filed under `jurisdiction`, decided by the voters of
 * `district` (SPEC §3.3), is on the ballot of someone in `area`. Out when its
 * jurisdiction isn't the user's (`inArea`), or, for a regional race, none of
 * the jurisdictions it's `votedIn` is: those say where it's on the ballot, in
 * place of the region's own path. Then each segment of `district` narrows it:
 * a family segment (`sup-4`) against the user's district of that family, a
 * place segment against their localities. A family the area doesn't know, or
 * a place it doesn't list (a water district: no boundaries to find it by),
 * makes it unknown, unless a later segment already rules it out.
 */
export function placeRace(
  jurisdiction: string | undefined,
  district: string | undefined,
  area: Area,
  votedIn?: readonly string[],
): Placement {
  if (!isAreaSet(area)) return "in";
  const here = votedIn?.length
    ? votedIn.some((path) => inArea(path, area))
    : inArea(jurisdiction, area);
  if (!district?.trim()) return here ? "in" : "out";
  const path = districtPath(district);
  const placement = placeDistrict(path, here, withAnswers(area));
  if (placement !== "unknown" || !area.answers) return placement;
  // What the user said settles what the area can't: "no" to the district or
  // any part of it, "yes" to the district itself.
  const parts = path.split("/");
  for (let end = 3; end <= parts.length; end++) {
    if (area.answers[parts.slice(0, end).join("/")] === false) return "out";
  }
  return area.answers[path] === true ? "in" : "unknown";
}

/** A `district` as answers key it. */
function districtPath(district: string): string {
  return district.trim().toLowerCase();
}

/** What the user said about a race's `district`, if anything (`answerPlacement`). */
export function answerFor(area: Area, district: string | undefined): boolean | undefined {
  return district?.trim() ? area.answers?.[districtPath(district)] : undefined;
}

/**
 * The area with what its "yes" answers imply where it doesn't already know:
 * each family segment's district (`council-3` → council district 3) and each
 * place segment as a locality. A lookup's own district always wins.
 */
function withAnswers(area: Area): Area {
  const yes = Object.entries(area.answers ?? {}).filter(([, onBallot]) => onBallot);
  if (yes.length === 0) return area;
  const districts = { ...area.districts };
  const localities = [...area.localities];
  for (const [path] of yes) {
    const parts = path.split("/");
    let prefix = parts.slice(0, 2).join("/");
    for (const segment of parts.slice(2)) {
      const family = DISTRICT_SEGMENT.exec(segment);
      if (family?.[1] && family[2]) {
        districts[`${prefix}/${family[1]}`] ??= districtId(family[2]);
      } else if (!localities.includes(`${prefix}/${segment}`)) {
        localities.push(`${prefix}/${segment}`);
      }
      prefix = `${prefix}/${segment}`;
    }
  }
  return { ...area, districts, localities };
}

/**
 * The area with the user's answer for a race's `district`: on their ballot
 * (`true`), not (`false`), or no answer (`undefined`, back to what the area
 * alone can tell).
 */
export function answerPlacement(area: Area, district: string, onBallot: boolean | undefined): Area {
  const { answers: { [districtPath(district)]: _, ...rest } = {}, ...base } = area;
  const answers = onBallot === undefined ? rest : { ...rest, [districtPath(district)]: onBallot };
  return Object.keys(answers).length > 0 ? { ...base, answers } : base;
}

/** The area without its "not on my ballot" answers. */
export function clearNoAnswers(area: Area): Area {
  const yes = Object.entries(area.answers ?? {}).filter(([, onBallot]) => onBallot);
  const { answers: _, ...base } = area;
  return yes.length > 0 ? { ...base, answers: Object.fromEntries(yes) } : base;
}

/** How many districts the user said aren't on their ballot. */
export function noAnswerCount(area: Area): number {
  return Object.values(area.answers ?? {}).filter((onBallot) => !onBallot).length;
}

function placeDistrict(path: string, here: boolean, area: Area): Placement {
  const parts = path.split("/");
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

/**
 * The locality path a place name maps to: `localityPathFor("us/ca", "San
 * Francisco")` → `us/ca/sf`. Named localities map back through their label;
 * anything else is slugified.
 */
export function localityPathFor(state: string, name: string): string {
  const wanted = name.trim().toLowerCase();
  const named = Object.entries(regionProfile(state)?.localityNames ?? {}).find(
    ([, label]) => label.toLowerCase() === wanted,
  );
  return `${state}/${named?.[0] ?? slugOf(wanted)}`;
}

/** A name as a path segment (SPEC §3.3): lower case, accents dropped, anything else a hyphen. */
export function slugOf(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleCase(slug: string): string {
  return slug
    .split("-")
    .map((word) => (word ? word[0]?.toUpperCase() + word.slice(1) : word))
    .join(" ");
}

/**
 * What a family's districts are called: "Assembly district". `region` (`us/ca`)
 * picks whose family it is, where the same key means something else next door.
 */
export function districtFamilyLabel(family: string, region?: string): string {
  return districtFamily(family, region)?.label ?? `${family.toUpperCase()} district`;
}

/** A region's name: "California". One the app has no profile for goes by its code. */
export function stateLabel(path: string): string {
  return regionProfile(path)?.name ?? path.split("/").pop()?.toUpperCase() ?? path;
}

/** Human label for a jurisdiction path. */
export function jurisdictionLabel(path: string | undefined): string {
  return path === undefined ? "Other" : labelOf(path);
}

/** Remembered per path: sorting a catalog into ballot order asks for thousands. */
const labelOf = memoByString((path: string): string => {
  const part = parseJurisdiction(path);
  switch (part.kind) {
    case "none":
      return "Other";
    case "state":
      return part.path === "us" ? "National" : stateLabel(part.path);
    case "district":
      return `${districtFamilyLabel(part.family, part.state)} ${districtName(`${part.state}/${part.family}`, part.number)}`;
    case "local": {
      const named = regionFor(part.path)?.localityNames?.[part.slug];
      if (named) return named;
      // A place filed under another (a town under its county): "Washington
      // Township, Greene County".
      const [last, ...outer] = part.slug.split("/").reverse();
      return [last ?? "", ...outer].map(titleCase).join(", ");
    }
  }
});

/** Sort rank for ballot sections: national, statewide, districts, local, unknown. */
export function jurisdictionRank(path: string | undefined): number {
  const part = parseJurisdiction(path);
  switch (part.kind) {
    case "state":
      return part.path === "us" ? 0 : 1;
    case "district":
      return 2 + districtFamilyOrder(part.family, part.state) / 100;
    case "local":
      return 3;
    case "none":
      return 4;
  }
}

/**
 * How many districts a family (`us/ca/sd`) has, when they're numbered from 1;
 * 0 when the app doesn't know. Someone's district is theirs whether or not it
 * has a race this election, so the picker offers all of them.
 */
export function districtCount(family: string): number {
  return districtFamilyAt(family)?.count ?? 0;
}

/**
 * Whether races are filed under a family's districts (`us/ca/sd-11`), so that
 * one with no race this election is worth saying. Not for the families that
 * only narrow a race filed elsewhere: school districts, supervisorial
 * districts, the Board of Equalization's.
 */
export function familyHasRaces(family: string): boolean {
  const info = districtFamilyAt(family);
  return info !== undefined && !info.narrows;
}

/**
 * What a district is called: its number, or for one that's lettered or named
 * what its state calls it (`35a` "35A", `third-middlesex` "Third Middlesex").
 * `family` as areas key it (`us/ma/sd`).
 */
export function districtName(family: string, id: string): string {
  return districtFamilyAt(family)?.ids?.find(([known]) => known === id)?.[1] ?? id;
}

/** Every district of a family (`us/ca/sd`), plus any the data uses beyond the ones known. */
export function allDistricts(family: string, present: readonly string[]): string[] {
  const count = districtCount(family);
  const numbers = new Set(present);
  for (let n = 1; n <= count; n++) numbers.add(String(n));
  // Lettered and named ones, which no count can stand for.
  for (const [id] of districtFamilyAt(family)?.ids ?? []) numbers.add(id);
  return [...numbers].sort(compareDistrictIds);
}

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
  const info = districtFamilyAt(family);
  const office = info?.office ?? kind.toUpperCase();
  const year = election ? Number(election.slice(0, 4)) : Number.NaN;
  // Staggered terms, where the region's law says whose turn it is.
  let up: "even" | "odd" | undefined =
    info?.seatsUp && Number.isFinite(year) ? info.seatsUp(year) : undefined;
  if (!up) {
    // Only where districts are numbered: Alaska's lettered Senate has no odd and even.
    const numbered = present.every((n) => /^\d+$/.test(n));
    const parities = new Set(numbered ? present.map((n) => Number(n) % 2) : [0, 1]);
    const count = districtCount(family);
    if (present.length >= 3 && parities.size === 1 && present.length * 2 >= count - 1) {
      up = parities.has(0) ? "even" : "odd";
    }
  }
  if (up && Number(number) % 2 !== (up === "even" ? 0 : 1)) {
    return `No ${office} race in district ${number} this election; only ${up}-numbered seats are up.`;
  }
  return `Nothing you've imported has a ${office} race in district ${districtName(family, number)} this election.`;
}
