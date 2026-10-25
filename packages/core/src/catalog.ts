import { subjectIdentity } from "./adopts";
import type { SlatePayload } from "./schema";

/**
 * How many races (distinct subjects) a slate takes positions on, per
 * jurisdiction: a position's own `subject.jurisdiction`, else the slate's
 * `context.jurisdiction`, else `""` (none). A catalog lists this per entry, so
 * an app can match organizations to a voter's area, and count the races each
 * weighs in on there, without downloading every slate first.
 */
export function racesByJurisdiction(payload: SlatePayload): Record<string, number> {
  const subjects = new Map<string, Set<string>>();
  for (const position of payload.positions) {
    const jurisdiction = position.subject.jurisdiction ?? payload.context?.jurisdiction ?? "";
    const set = subjects.get(jurisdiction) ?? new Set();
    set.add(subjectIdentity(position.subject));
    subjects.set(jurisdiction, set);
  }
  return Object.fromEntries(
    [...subjects.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([jurisdiction, set]) => [jurisdiction, set.size]),
  );
}
