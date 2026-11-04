import type { Area } from "./jurisdictions";
import { createLocalStore, useLocalStore } from "./localStore";
import { DISTRICT_FAMILIES, type DistrictFamily, districtContest } from "./sosCa";

/**
 * What the Live results page watches: groups of contests (`lib/sosCa.ts` ids),
 * each a place ("Where I vote", "Mom's") or the races added one at a time.
 * Kept in this browser only. Pure helpers apart from the store; unit-tested in
 * test/watch.test.ts.
 */
export interface WatchGroup {
  id: string;
  label: string;
  /** Contest ids, in the order shown. */
  contests: string[];
  /** County name, for that county's own count beside each race. */
  county?: string;
  /** The place's districts with no race this election (odd State Senate seats in 2026). */
  skipped?: string[];
}

/** The group single races land in. */
export const SINGLES_ID = "singles";
/** The statewide offices and measures, shared by every place. */
export const STATEWIDE_ID = "statewide";

function isGroup(raw: unknown): raw is WatchGroup {
  if (typeof raw !== "object" || raw === null) return false;
  const g = raw as Partial<WatchGroup>;
  return (
    typeof g.id === "string" &&
    typeof g.label === "string" &&
    Array.isArray(g.contests) &&
    g.contests.every((c) => typeof c === "string") &&
    (g.county === undefined || typeof g.county === "string") &&
    (g.skipped === undefined ||
      (Array.isArray(g.skipped) && g.skipped.every((c) => typeof c === "string")))
  );
}

export const watchStore = createLocalStore<WatchGroup[]>("openslate.watch.v1", [], (raw) =>
  Array.isArray(raw) && raw.every(isGroup) ? raw : undefined,
);

export const useWatch = () => useLocalStore(watchStore);

/** District numbers by family, as a place is described. */
export type PlaceDistricts = Partial<Record<DistrictFamily, string>>;

/** The area's districts the Secretary of State reports on (California only). */
export function districtsOfArea(area: Area): PlaceDistricts {
  const out: PlaceDistricts = {};
  for (const { family } of DISTRICT_FAMILIES) {
    const n = area.districts[`us/ca/${family}`];
    if (n && /^\d+$/.test(n)) out[family] = String(Number(n));
  }
  return out;
}

/** A place's own contests (its districts'), in ballot order. */
export function placeContests(districts: PlaceDistricts): string[] {
  return DISTRICT_FAMILIES.flatMap(({ family }) => {
    const n = districts[family];
    return n ? [districtContest(family, n)] : [];
  });
}

function newId(): string {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Add a place: a group of its district contests, and the statewide group if
 * it isn't there yet (`statewide`, the contests every Californian votes on).
 */
export function addPlace(
  groups: readonly WatchGroup[],
  place: { label: string; districts: PlaceDistricts; county?: string },
  statewide: readonly string[],
  id: string = newId(),
): WatchGroup[] {
  const next = [...groups];
  const group: WatchGroup = {
    id,
    label: place.label.trim() || "A place",
    contests: placeContests(place.districts),
    ...(place.county ? { county: place.county } : {}),
  };
  next.push(group);
  if (!next.some((g) => g.id === STATEWIDE_ID) && statewide.length > 0) {
    next.unshift({ id: STATEWIDE_ID, label: "Statewide", contests: [...statewide] });
  }
  return next;
}

/** Add one contest to the singles group (made when missing). Nothing changes when it's there already. */
export function addSingle(groups: readonly WatchGroup[], contest: string): WatchGroup[] {
  const singles = groups.find((g) => g.id === SINGLES_ID);
  if (singles?.contests.includes(contest)) return [...groups];
  if (!singles) return [...groups, { id: SINGLES_ID, label: "Races I added", contests: [contest] }];
  return groups.map((g) =>
    g.id === SINGLES_ID ? { ...g, contests: [...g.contests, contest] } : g,
  );
}

/** Drop a contest from a group; a group left empty goes too. */
export function removeContest(
  groups: readonly WatchGroup[],
  groupId: string,
  contest: string,
): WatchGroup[] {
  return groups
    .map((g) =>
      g.id === groupId ? { ...g, contests: g.contests.filter((c) => c !== contest) } : g,
    )
    .filter((g) => g.contests.length > 0);
}

export function removeGroup(groups: readonly WatchGroup[], groupId: string): WatchGroup[] {
  return groups.filter((g) => g.id !== groupId);
}

export function setGroupCounty(
  groups: readonly WatchGroup[],
  groupId: string,
  county: string | undefined,
): WatchGroup[] {
  return groups.map((g) => {
    if (g.id !== groupId) return g;
    const { county: _, ...rest } = g;
    return county ? { ...rest, county } : rest;
  });
}

/**
 * A contest that isn't on this ballot leaves every group, and places note it
 * as skipped so they can say why it's missing. The same list when no group has it.
 */
export function skipContest(groups: readonly WatchGroup[], contest: string): WatchGroup[] {
  if (!groups.some((g) => g.contests.includes(contest))) return groups as WatchGroup[];
  return groups.map((g) => {
    if (!g.contests.includes(contest)) return g;
    const skipped = g.skipped?.includes(contest) ? g.skipped : [...(g.skipped ?? []), contest];
    return { ...g, contests: g.contests.filter((c) => c !== contest), skipped };
  });
}

/** Drop a contest from several groups at once (a section shared by places). */
export function removeFromGroups(
  groups: readonly WatchGroup[],
  groupIds: readonly string[],
  contest: string,
): WatchGroup[] {
  return groupIds.reduce<WatchGroup[]>((gs, id) => removeContest(gs, id, contest), [...groups]);
}

/** Contests shown together: the ones watched by exactly the same groups. */
export interface WatchSection {
  key: string;
  groups: WatchGroup[];
  contests: string[];
}

/**
 * Each contest once, under every group watching it: a race two places share
 * shows once, in a section named for both. Sections come in the order their
 * first contest appears.
 */
export function watchSections(groups: readonly WatchGroup[]): WatchSection[] {
  const sections = new Map<string, WatchSection>();
  const seen = new Set<string>();
  for (const group of groups) {
    for (const contest of group.contests) {
      if (seen.has(contest)) continue;
      seen.add(contest);
      const owners = groups.filter((g) => g.contests.includes(contest));
      const key = owners.map((g) => g.id).join("+");
      const section = sections.get(key);
      if (section) section.contests.push(contest);
      else sections.set(key, { key, groups: owners, contests: [contest] });
    }
  }
  return [...sections.values()];
}
