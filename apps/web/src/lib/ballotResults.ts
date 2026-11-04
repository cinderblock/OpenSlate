import { type Race as CivicRace, type CountyContest, confidenceBucket } from "@openslate/core";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Standing } from "./ballotOutcome";
import { isYesNo } from "./ballotView";
import type { Race } from "./collate";
import {
  type CountyResults,
  countyContestFor,
  countyContestResult,
  countyFeed,
  countyQueryOptions,
  localRaceCounty,
} from "./countyCa";
import type { Area } from "./jurisdictions";
import { raceQueryOptions, raceSearchQueryOptions, resolveSubjectRace } from "./results";
import { type ContestResult, contestQueryOptions, NotOnBallot } from "./sosCa";
import { parseSosTime, SOS_ELECTION, sosContestForSubject } from "./sosResults";
import { subjectKey } from "./subjects";

/**
 * Each race's count, from whichever source reports it:
 *
 * - the Secretary of State for the races it counts (statewide offices and
 *   measures, Congress, the Legislature, Board of Equalization);
 * - the voter's county's own file for local races and measures, one request
 *   for every one of them, matched to the ballot's races by who's running (or
 *   a measure's letter and place, `countyContestFor`);
 * - civicAPI, only for races neither of those covers (another state, another
 *   election, a county whose count OpenSlate doesn't read).
 *
 * Queries share the Live page's keys (`sos-ca`, `county-ca`) and the results
 * pages' (`results`), so a page already open costs nothing more, and every
 * proposition comes from one shared `ballot-measures` request (`sosCa.ts`).
 */

export type RaceCount =
  | { status: "loading" }
  | { status: "found"; standing: Standing }
  /** No source reports this race; `why` says which were asked. */
  | { status: "none"; why: string }
  | { status: "error"; why: string };

const STATE = "California Secretary of State";

/** A Secretary of State or county contest, as a `Standing`. */
export function contestStanding(
  result: ContestResult,
  source: "state" | "county",
  sourceName: string,
  seats = 1,
): Standing | undefined {
  const r = result.reporting;
  const changedAt = r.changedAt ?? Date.parse(parseSosTime(r.time) ?? "");
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

/** civicAPI's race as a `Standing`; its `winner` flags are real calls. */
export function civicStanding(race: CivicRace, yesNo: boolean): Standing {
  const changedAt = Date.parse(race.last_updated ?? "");
  const base = {
    source: "civicapi" as const,
    sourceName: "civicAPI",
    ...(race.percent_reporting !== undefined
      ? {
          percent: race.percent_reporting,
          reporting: `${race.percent_reporting}% reporting`,
        }
      : {}),
    ...(Number.isFinite(changedAt) ? { changedAt } : {}),
  };
  const yes = race.candidates.find((c) => /^\s*yes\b/i.test(c.name));
  const no = race.candidates.find((c) => /^\s*no\b/i.test(c.name));
  if (yesNo && yes && no) {
    const called = yes.winner ? "passed" : no.winner ? "failed" : undefined;
    return {
      ...base,
      kind: "measure",
      yes: yes.votes ?? 0,
      no: no.votes ?? 0,
      ...(called ? { called } : {}),
    };
  }
  const winners = race.candidates.filter((c) => c.winner).map((c) => c.name);
  return {
    ...base,
    kind: "candidates",
    seats: Math.max(1, winners.length),
    choices: race.candidates.map((c) => ({ name: c.name, votes: c.votes ?? 0 })),
    ...(winners.length > 0 ? { called: winners } : {}),
  };
}

/**
 * Which county contest each local race is, by race key (`countyContestFor`,
 * the Results page's matching the other way round).
 */
export function matchCountyContests(
  races: readonly Race[],
  countyOf: ReadonlyMap<string, string>,
  slugs: readonly string[],
  data: readonly (CountyResults | undefined)[],
): Map<string, { slug: string; contest: CountyContest }> {
  const out = new Map<string, { slug: string; contest: CountyContest }>();
  for (const race of races) {
    const slug = countyOf.get(race.key);
    const county = slug ? data[slugs.indexOf(slug)] : undefined;
    const feed = slug ? countyFeed(slug) : null;
    if (!slug || !county || !feed) continue;
    const contest = countyContestFor(race, county.contests, feed.feed.name, SOS_ELECTION);
    if (contest) out.set(race.key, { slug, contest });
  }
  return out;
}

/** Every race's count, by race key. */
export function useBallotCounts(
  races: readonly Race[],
  area: Area,
  election: string | undefined,
): Map<string, RaceCount> {
  // 1. The Secretary of State, for the races it counts.
  const sosOf = useMemo(() => {
    const out = new Map<string, string>();
    for (const race of races) {
      const contest = sosContestForSubject(race.subject);
      if (contest) out.set(race.key, contest);
    }
    return out;
  }, [races]);
  const sosIds = useMemo(() => [...new Set(sosOf.values())].sort(), [sosOf]);
  const sos = useQueries({ queries: sosIds.map((id) => contestQueryOptions(id)) });

  // 2. The counties' own files, for local races: one file per county covers them all.
  const countyOf = useMemo(() => {
    const out = new Map<string, string>();
    if (election !== SOS_ELECTION) return out;
    for (const race of races) {
      if (sosOf.has(race.key)) continue;
      const slug = countyFeed(localRaceCounty(race, area, SOS_ELECTION))?.slug;
      if (slug) out.set(race.key, slug);
    }
    return out;
  }, [races, sosOf, area, election]);
  const slugs = useMemo(() => [...new Set(countyOf.values())].sort(), [countyOf]);
  const counties = useQueries({ queries: slugs.map((slug) => countyQueryOptions(slug)) });
  const countyData = counties.map((q) => q.data);
  const countyVersions = countyData.map((d) => d?.version ?? "").join("|");
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-match only when a county's count changes version
  const countyMatch = useMemo(
    () => matchCountyContests(races, countyOf, slugs, countyData),
    [races, countyOf, slugs, countyVersions],
  );

  // 3. civicAPI, only where neither the state nor a county the voter's in reports.
  const civicRaces = useMemo(
    () => races.filter((r) => !sosOf.has(r.key) && !countyOf.has(r.key)),
    [races, sosOf, countyOf],
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

  const sosVersion = sos.map((q) => q.dataUpdatedAt).join();
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
      const contest = sosOf.get(race.key);
      if (contest) {
        const q = sos[sosIds.indexOf(contest)];
        if (!q || q.isPending) out.set(race.key, { status: "loading" });
        else if (q.error instanceof NotOnBallot)
          out.set(race.key, { status: "none", why: "Not in the Secretary of State's count" });
        else if (q.error) out.set(race.key, { status: "error", why: q.error.message });
        else {
          const standing = q.data ? contestStanding(q.data, "state", STATE) : undefined;
          out.set(
            race.key,
            standing
              ? { status: "found", standing }
              : { status: "none", why: "Not in the Secretary of State's count" },
          );
        }
        continue;
      }
      const hit = countyMatch.get(race.key);
      if (hit) {
        const data = countyData[slugs.indexOf(hit.slug)];
        const name = `${countyFeed(hit.slug)?.feed.name ?? hit.slug} County`;
        const standing = contestStanding(
          countyContestResult(hit.contest, data?.updated, data?.seenAt),
          "county",
          name,
          hit.contest.voteFor || undefined,
        );
        out.set(
          race.key,
          standing
            ? { status: "found", standing }
            : { status: "none", why: `Not in ${name}'s count` },
        );
        continue;
      }
      const slug = countyOf.get(race.key);
      if (slug) {
        const q = counties[slugs.indexOf(slug)];
        const name = `${countyFeed(slug)?.feed.name ?? slug} County`;
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
    sosOf,
    sosIds,
    sosVersion,
    countyMatch,
    countyVersion,
    countyOf,
    slugs,
    civicRaces,
    civicVersion,
  ]);
}
