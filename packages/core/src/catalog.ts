import { subjectIdentity } from "./adopts";
import type { SlatePayload } from "./schema";

/**
 * How many races (distinct subjects) a slate speaks to, per jurisdiction: by
 * a position or an attached article (SPEC §3.15), under the subject's own
 * `jurisdiction`, else the slate's `context.jurisdiction`, else `""` (none).
 * A regional contest counts under each jurisdiction that votes on it
 * (`voted_in`, SPEC §3.3) instead of the region's own path, which says nothing
 * about whose ballot it is on.
 * A catalog lists this per entry, so an app can match a source to a voter's
 * area, and count the races it covers there, without downloading every slate
 * first.
 */
export function racesByJurisdiction(payload: SlatePayload): Record<string, number> {
  const subjects = new Map<string, Set<string>>();
  for (const { subject } of [...payload.positions, ...(payload.articles ?? [])]) {
    const jurisdiction = subject.jurisdiction ?? payload.context?.jurisdiction ?? "";
    for (const where of new Set(subject.voted_in ?? [jurisdiction])) {
      const set = subjects.get(where) ?? new Set();
      set.add(subjectIdentity(subject));
      subjects.set(where, set);
    }
  }
  return Object.fromEntries(
    [...subjects.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([jurisdiction, set]) => [jurisdiction, set.size]),
  );
}

/**
 * Where each region a slate's contests are filed under is voted: the region's
 * path (a subject's `jurisdiction`, SPEC §3.3) with every jurisdiction any of
 * its contests lists in `voted_in`. A region's path doesn't say what it
 * contains, so a catalog lists this per entry, and an app can tell whether an
 * outlet based in a region (`context.jurisdiction` `us/ca/bay-area`) is local
 * to a voter without downloading anything. Contests without `voted_in` add
 * nothing: they're voted where they're filed.
 */
export function regionsOf(payload: SlatePayload): Record<string, string[]> {
  const regions = new Map<string, Set<string>>();
  for (const { subject } of [...payload.positions, ...(payload.articles ?? [])]) {
    const region = subject.jurisdiction ?? payload.context?.jurisdiction;
    if (!region || !subject.voted_in?.length) continue;
    const members = regions.get(region) ?? new Set();
    for (const where of subject.voted_in) members.add(where);
    regions.set(region, members);
  }
  return Object.fromEntries(
    [...regions.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([region, members]) => [region, [...members].sort()]),
  );
}
