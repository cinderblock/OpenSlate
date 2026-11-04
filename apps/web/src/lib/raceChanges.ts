import { useEffect, useRef } from "react";
import { createLocalStore, useLocalStore } from "./localStore";
import { logReport } from "./raceHistory";
import type { ContestResult } from "./sosCa";

/**
 * When a race's own numbers last changed. Sources publish one time for a whole
 * report (a county's file, the state's report): when it moves, every race in it
 * looks "updated", whether its numbers moved or not. So each watched race's
 * numbers are kept here with the source's time for the report they first
 * appeared in; a new report with the same numbers leaves the race's time alone.
 *
 * A race first seen with numbers already in place can only say "this time or
 * earlier": OpenSlate didn't see the report that changed them. Kept in this
 * browser, one small entry per watched race. Pure helpers unit-tested in
 * test/raceChanges.test.ts.
 */

export interface RaceChange {
  /** The race's numbers, as compared: votes per choice, and precincts. */
  fp: string;
  /** The source's time for the first report seen with these numbers (ms since epoch). */
  at: number;
  /** True when OpenSlate saw different numbers before: `at` is when they changed, not "or earlier". */
  exact: boolean;
}

/** A race's numbers as one string: what has to differ for the race to have changed. */
export function raceFingerprint(result: ContestResult): string {
  const precincts = result.reporting.percent ?? "";
  if (result.kind === "candidates")
    return `${precincts}|${result.candidates.map((c) => `${c.name}=${c.votes}`).join(",")}`;
  if (result.kind === "measure") return `${precincts}|${result.measure.yes}/${result.measure.no}`;
  return `${precincts}|${result.measures.map((m) => `${m.number}=${m.yes}/${m.no}`).join(",")}`;
}

/** The race's record after seeing it again, in a report the source timed `at`. */
export function nextRaceChange(
  previous: RaceChange | undefined,
  fp: string,
  at: number,
): RaceChange {
  if (!previous) return { fp, at, exact: false };
  if (previous.fp === fp) return previous;
  return { fp, at, exact: true };
}

function isRecord(raw: unknown): raw is Record<string, RaceChange> {
  if (typeof raw !== "object" || raw === null) return false;
  return Object.values(raw).every(
    (v) =>
      typeof v === "object" &&
      v !== null &&
      typeof (v as RaceChange).fp === "string" &&
      typeof (v as RaceChange).at === "number" &&
      typeof (v as RaceChange).exact === "boolean",
  );
}

export const raceChangesStore = createLocalStore<Record<string, RaceChange>>(
  "openslate.raceChanges.v1",
  {},
  (raw) => (isRecord(raw) ? raw : undefined),
);

/**
 * When this race's own numbers last changed, given its current result and the
 * source's time for the report it came in. Undefined until a result is in.
 */
export function useRaceChange(
  id: string,
  result: ContestResult | undefined,
  sourceAt: number | undefined,
): RaceChange | undefined {
  const [all] = useLocalStore(raceChangesStore);
  const fp = result ? raceFingerprint(result) : undefined;
  // The result as of the latest numbers, for the history log (fp stands for it in the deps).
  const latest = useRef(result);
  latest.current = result;
  useEffect(() => {
    if (fp === undefined || sourceAt === undefined) return;
    raceChangesStore.set((current) => {
      const next = nextRaceChange(current[id], fp, sourceAt);
      return next === current[id] ? current : { ...current, [id]: next };
    });
    if (latest.current) logReport(id, latest.current, sourceAt);
  }, [id, fp, sourceAt]);
  const known = all[id];
  return known && known.fp === fp ? known : undefined;
}
