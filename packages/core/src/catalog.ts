import { subjectIdentity } from "./adopts";
import type { SlatePayload } from "./schema";

/**
 * How many races (distinct subjects) a slate speaks to, per jurisdiction: by
 * a position or an attached article (SPEC §3.15), under the subject's own
 * `jurisdiction`, else the slate's `context.jurisdiction`, else `""` (none).
 * A catalog lists this per entry, so an app can match a source to a voter's
 * area, and count the races it covers there, without downloading every slate
 * first.
 */
export function racesByJurisdiction(payload: SlatePayload): Record<string, number> {
  const subjects = new Map<string, Set<string>>();
  for (const { subject } of [...payload.positions, ...(payload.articles ?? [])]) {
    const jurisdiction = subject.jurisdiction ?? payload.context?.jurisdiction ?? "";
    const set = subjects.get(jurisdiction) ?? new Set();
    set.add(subjectIdentity(subject));
    subjects.set(jurisdiction, set);
  }
  return Object.fromEntries(
    [...subjects.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([jurisdiction, set]) => [jurisdiction, set.size]),
  );
}
