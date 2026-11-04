import type { CountyContest, CountyFeed } from "@openslate/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useId, useMemo } from "react";
import {
  type CatalogRace,
  countyContestFor,
  countyContestId,
  countyContestResult,
  countyFeed,
  countyQueryOptions,
  localRaceCounty,
} from "../lib/countyCa";
import { useArea } from "../lib/myVote";
import { type RaceChange, useRaceChange } from "../lib/raceChanges";
import type { ContestResult } from "../lib/sosCa";
import { SOS_ELECTION } from "../lib/sosResults";
import { RaceHistoryToggle, ReportingLine, ResultBody, sourceTimeOf } from "./LiveResult";

/** Any votes in yet? Before then the count says nothing worth a voter's attention. */
function hasVotes(result: ContestResult): boolean {
  if (result.kind === "candidates") return result.candidates.some((c) => c.votes > 0);
  if (result.kind === "measure") return result.measure.yes + result.measure.no > 0;
  return result.measures.some((m) => m.yes + m.no > 0);
}

/** A local race's county count, once there's one to show. */
export interface RaceCount {
  /** The contest's id on the Results page (`county-ca/<slug>/<key>`). */
  id: string;
  feed: CountyFeed;
  contest: CountyContest;
  result: ContestResult;
  checkedAt: number;
  /** A check is under way. */
  fetching: boolean;
  change: RaceChange | undefined;
}

/**
 * A local race's count from its county's own feed (`countyContestFor`, the
 * other way from the Results page's `catalogRaceFor`). The same query as the
 * Results page (one request per county per minute, through the relay, shared
 * by every race), and the same contest id, so "This race changed" and the
 * history are one record. Undefined for the Secretary of State's races (their
 * count is elsewhere), without a match, and before any votes.
 */
export function useRaceCountyCount(race: CatalogRace | undefined): RaceCount | undefined {
  const [area] = useArea();
  const slug = race ? countyFeed(localRaceCounty(race, area, SOS_ELECTION))?.slug : undefined;
  const found = useMemo(() => countyFeed(slug), [slug]);
  const query = useQuery({ ...countyQueryOptions(slug ?? ""), enabled: Boolean(slug) });
  const data = query.data;
  const contest = useMemo(
    () =>
      race && found && data
        ? countyContestFor(race, data.contests, found.feed.name, SOS_ELECTION)
        : undefined,
    [race, found, data],
  );
  const result = useMemo(() => {
    if (!contest || !data) return undefined;
    const r = countyContestResult(contest, data.updated, data.seenAt);
    return hasVotes(r) ? r : undefined;
  }, [contest, data]);
  const id = found && contest ? countyContestId(found.slug, contest.key) : "";
  const change = useRaceChange(id, result, result ? sourceTimeOf(result) : undefined);
  if (!found || !contest || !result) return undefined;
  return {
    id,
    feed: found.feed,
    contest,
    result,
    checkedAt: query.dataUpdatedAt,
    fetching: query.isFetching,
    change,
  };
}

/**
 * A local race's county count where the voter already looks at the race: My
 * ballot's card (`race`), the race page (`count`, from `useRaceCountyCount`,
 * which it also needs). Nothing when there's no count to show.
 */
export function RaceCountyCount(
  props: { race: CatalogRace; card?: boolean } | { count: RaceCount | undefined; card?: boolean },
) {
  return "race" in props ? (
    <OwnCount race={props.race} card={props.card ?? false} />
  ) : props.count ? (
    <CountView count={props.count} card={props.card ?? false} />
  ) : null;
}

function OwnCount({ race, card }: { race: CatalogRace; card: boolean }) {
  const count = useRaceCountyCount(race);
  return count ? <CountView count={count} card={card} /> : null;
}

function CountView({ count, card }: { count: RaceCount; card: boolean }) {
  const labelId = useId();
  const { feed, contest, result } = count;
  const Heading = card ? "h3" : "h4";
  return (
    <section
      className={`race-county-count no-print${card ? " card" : ""}`}
      aria-labelledby={labelId}
    >
      <div className="live-contest-head">
        <Heading id={labelId} className="race-county-count-title">
          Count so far
        </Heading>
        <ReportingLine
          result={result}
          checkedAt={count.checkedAt}
          change={count.change}
          fetching={count.fetching}
        />
      </div>
      <ResultBody result={result} />
      <RaceHistoryToggle id={count.id} />
      <p className="hint live-county-source">
        {feed.name} County's own count, as "{contest.title}". Semi-official: counting goes on for
        weeks ·{" "}
        <a href={feed.page} target="_blank" rel="noreferrer">
          county results ↗
        </a>{" "}
        · <Link to="/results">Results</Link>
      </p>
    </section>
  );
}
