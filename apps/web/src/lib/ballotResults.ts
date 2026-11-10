import { type CountyContest, confidenceBucket } from "@openslate/core";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { civicStanding, type Standing } from "./ballotOutcome";
import { isYesNo } from "./ballotView";
import type { Race } from "./collate";
import {
  type CountyCount,
  type CountyCounts,
  countyCountsFor,
  type StateContest,
  stateContestFor,
} from "./counts";
import type { Area } from "./jurisdictions";
import { type ContestResult, NotOnBallot } from "./liveCount";
import { raceQueryOptions, raceSearchQueryOptions, resolveSubjectRace } from "./results";
import { subjectKey } from "./subjects";

/**
 * Each race's count, from whichever source reports it:
 *
 * - the state's election office for the races it counts, where OpenSlate
 *   reads its count (`counts.ts`; California's Secretary of State: statewide
 *   offices and measures, Congress, the Legislature, Board of Equalization);
 * - the voter's county's own file for local races and measures, one request
 *   for every one of them, matched to the ballot's races by who's running (or
 *   a measure's letter and place);
 * - civicAPI, only for races neither of those covers (another state, another
 *   election, a county whose count OpenSlate doesn't read).
 *
 * Queries share the Live page's keys (`sos-ca`, `county-ca`) and the results
 * pages' (`results`), so a page already open costs nothing more, and every
 * California proposition comes from one shared `ballot-measures` request
 * (`regions/us-ca/sos.ts`).
 */

export type RaceCount =
  | { status: "loading" }
  | { status: "found"; standing: Standing }
  /** No source reports this race; `why` says which were asked. */
  | { status: "none"; why: string }
  | { status: "error"; why: string };

/**
 * A state's or a county's contest, as a `Standing`. `parseTime` reads the
 * time a source words its own way, for a count that gives no instant.
 */
export function contestStanding(
  result: ContestResult,
  source: "state" | "county",
  sourceName: string,
  seats = 1,
  parseTime?: (text: string | undefined) => string | undefined,
): Standing | undefined {
  const r = result.reporting;
  const changedAt = r.changedAt ?? Date.parse(parseTime?.(r.time) ?? "");
  const base = {
    source,
    sourceName,
    ...(r.text ? { reporting: r.text } : {}),
    ...(r.percent !== undefined ? { percent: r.percent } : {}),
    ...(Number.isFinite(changedAt) ? { changedAt } : {}),
  };
  if (result.kind === "measure") {
    const m = result.measure;
    return {
      ...base,
      kind: "measure",
      yes: m.yes,
      no: m.no,
      ...(m.threshold ? { threshold: m.threshold } : {}),
    };
  }
  if (result.kind === "candidates") {
    return {
      ...base,
      kind: "candidates",
      seats,
      choices: result.candidates.map((c) => ({ name: c.name, votes: c.votes })),
    };
  }
  return undefined;
}

/** A county's count a race may be in: whose it is, and the county as its source keys it. */
export interface CountyOf {
  source: CountyCounts;
  county: string;
  /** One id per county across every region: `us/ca|santa-clara`. */
  id: string;
}

/**
 * Which county contest each local race is, by race key (`CountyCounts.contestFor`,
 * the Results page's matching the other way round). `data` is each county's
 * count, in `ids`' order.
 */
export function matchCountyContests(
  races: readonly Race[],
  countyOf: ReadonlyMap<string, CountyOf>,
  ids: readonly string[],
  data: readonly (CountyCount | undefined)[],
): Map<string, { of: CountyOf; contest: CountyContest }> {
  const out = new Map<string, { of: CountyOf; contest: CountyContest }>();
  for (const race of races) {
    const of = countyOf.get(race.key);
    const count = of ? data[ids.indexOf(of.id)] : undefined;
    if (!of || !count) continue;
    const contest = of.source.contestFor(race, of.county, count.contests);
    if (contest) out.set(race.key, { of, contest });
  }
  return out;
}

/** Every race's count, by race key. */
export function useBallotCounts(races: readonly Race[], area: Area): Map<string, RaceCount> {
  // 1. The state's own count, for the races it reports.
  const stateOf = useMemo(() => {
    const out = new Map<string, StateContest>();
    for (const race of races) {
      const hit = stateContestFor(race.subject);
      if (hit) out.set(race.key, hit);
    }
    return out;
  }, [races]);
  const stateContests = useMemo(
    () =>
      [...new Map([...stateOf.values()].map((hit) => [hit.raceId, hit])).values()].sort((a, b) =>
        a.raceId.localeCompare(b.raceId),
      ),
    [stateOf],
  );
  const stateIds = useMemo(() => stateContests.map((hit) => hit.raceId), [stateContests]);
  const state = useQueries({
    queries: stateContests.map((hit) => hit.source.queryOptions(hit.contest)),
  });

  // 2. The counties' own files, for local races: one file per county covers them all.
  const countyOf = useMemo(() => {
    const out = new Map<string, CountyOf>();
    for (const race of races) {
      if (stateOf.has(race.key)) continue;
      const source = countyCountsFor(race.jurisdiction ?? race.subject.jurisdiction);
      const county = source?.countyFor(race, area);
      if (source && county) {
        out.set(race.key, { source, county, id: `${source.region}|${county}` });
      }
    }
    return out;
  }, [races, stateOf, area]);
  const countyList = useMemo(
    () =>
      [...new Map([...countyOf.values()].map((of) => [of.id, of])).values()].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
    [countyOf],
  );
  const countyIds = useMemo(() => countyList.map((of) => of.id), [countyList]);
  const counties = useQueries({
    queries: countyList.map((of) => of.source.queryOptions(of.county)),
  });
  const countyData = counties.map((q) => q.data);
  const countyVersions = countyData.map((d) => d?.version ?? "").join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-match only when a county's count changes version
  const countyMatch = useMemo(
    () => matchCountyContests(races, countyOf, countyIds, countyData),
    [races, countyOf, countyIds, countyVersions],
  );

  // 3. civicAPI, only where neither the state nor a county the voter's in reports.
  const civicRaces = useMemo(
    () => races.filter((r) => !stateOf.has(r.key) && !countyOf.has(r.key)),
    [races, stateOf, countyOf],
  );
  const pins = useQueries({
    queries: civicRaces.map((r) => ({
      queryKey: ["results", "pin", subjectKey(r.subject)] as const,
      queryFn: async () => (await resolveSubjectRace(r.subject)) ?? null,
      staleTime: Number.POSITIVE_INFINITY,
    })),
  });
  const searches = useQueries({
    queries: civicRaces.map((r, i) => ({
      ...raceSearchQueryOptions(r.subject),
      enabled: pins[i]?.isSuccess === true && pins[i]?.data === null,
    })),
  });
  const civicIds = civicRaces.map((_, i) => {
    const pinned = pins[i]?.data;
    if (pinned) return pinned.raceId;
    const top = searches[i]?.data?.ranked[0];
    // Only a match the results page would apply on its own.
    return top && confidenceBucket(top.score) === "high" ? top.race.id : undefined;
  });
  const civic = useQueries({ queries: civicIds.map((id) => raceQueryOptions(id)) });

  const stateVersion = state.map((q) => q.dataUpdatedAt).join();
  const countyVersion = `${countyVersions}:${counties.map((q) => q.status).join()}`;
  const civicVersion = [
    ...pins.map((q) => q.status),
    ...searches.map((q) => `${q.status}${q.fetchStatus}${q.dataUpdatedAt}`),
    ...civic.map((q) => `${q.status}${q.dataUpdatedAt}`),
  ].join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the versions stand for the query results
  return useMemo(() => {
    const out = new Map<string, RaceCount>();
    for (const race of races) {
      const hit = stateOf.get(race.key);
      if (hit) {
        const q = state[stateIds.indexOf(hit.raceId)];
        const missing = `Not in the ${hit.source.short}'s count`;
        if (!q || q.isPending) out.set(race.key, { status: "loading" });
        else if (q.error instanceof NotOnBallot)
          out.set(race.key, { status: "none", why: missing });
        else if (q.error) out.set(race.key, { status: "error", why: q.error.message });
        else {
          const standing = q.data
            ? contestStanding(q.data, "state", hit.source.name, 1, hit.source.parseTime)
            : undefined;
          out.set(
            race.key,
            standing ? { status: "found", standing } : { status: "none", why: missing },
          );
        }
        continue;
      }
      const match = countyMatch.get(race.key);
      if (match) {
        const data = countyData[countyIds.indexOf(match.of.id)];
        const name = match.of.source.countyName(match.of.county);
        const standing = contestStanding(
          match.of.source.toResult(match.contest, {
            ...(data?.updated !== undefined ? { updated: data.updated } : {}),
            seenAt: data?.seenAt ?? 0,
          }),
          "county",
          name,
          match.contest.voteFor || undefined,
        );
        out.set(
          race.key,
          standing
            ? { status: "found", standing }
            : { status: "none", why: `Not in ${name}'s count` },
        );
        continue;
      }
      const of = countyOf.get(race.key);
      if (of) {
        const q = counties[countyIds.indexOf(of.id)];
        const name = of.source.countyName(of.county);
        if (!q || q.isPending) out.set(race.key, { status: "loading" });
        else if (q.error && !q.data) out.set(race.key, { status: "error", why: q.error.message });
        else out.set(race.key, { status: "none", why: `Not found in ${name}'s count` });
        continue;
      }
      const i = civicRaces.indexOf(race);
      const pin = pins[i];
      const search = searches[i];
      const detail = civic[i];
      if (!pin || pin.isPending) {
        out.set(race.key, { status: "loading" });
      } else if (pin.data === null && search?.isPending) {
        // A search that isn't enabled (an upcoming election) never starts.
        out.set(
          race.key,
          search.fetchStatus === "idle"
            ? { status: "none", why: "No results yet" }
            : { status: "loading" },
        );
      } else if (civicIds[i] !== undefined && detail?.isPending) {
        out.set(race.key, { status: "loading" });
      } else if (detail?.data) {
        out.set(race.key, { status: "found", standing: civicStanding(detail.data, isYesNo(race)) });
      } else if (detail?.error || search?.error) {
        out.set(race.key, {
          status: "error",
          why: (detail?.error ?? search?.error)?.message ?? "",
        });
      } else {
        out.set(race.key, { status: "none", why: "civicAPI has no count for this race" });
      }
    }
    return out;
  }, [
    races,
    stateOf,
    stateIds,
    stateVersion,
    countyMatch,
    countyVersion,
    countyOf,
    countyIds,
    civicRaces,
    civicVersion,
  ]);
}
