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
import { useRaceChange } from "../lib/raceChanges";
import type { ContestResult } from "../lib/sosCa";
import { SOS_ELECTION } from "../lib/sosResults";
import { RaceHistoryToggle, ReportingLine, ResultBody, sourceTimeOf } from "./LiveResult";

/** Any votes in yet? Before then the count says nothing worth a voter's attention. */
function hasVotes(result: ContestResult): boolean {
  if (result.kind === "candidates") return result.candidates.some((c) => c.votes > 0);
  if (result.kind === "measure") return result.measure.yes + result.measure.no > 0;
  return result.measures.some((m) => m.yes + m.no > 0);
}

/**
 * A local race's count from its county's own feed (`countyContestFor`, the
 * other way from the Results page's `catalogRaceFor`), where the voter already
 * looks at the race: My ballot's card, the race page. The same query as the
 * Results page (one request per county per minute, through the relay, shared
 * by every race), and the same contest id there, so "This race changed" and
 * the history are one record. Renders nothing for the Secretary of State's
 * races (their count is elsewhere), without a match, or before any votes.
 */
export function RaceCountyCount({ race, card = false }: { race: CatalogRace; card?: boolean }) {
  const [area] = useArea();
  const found = countyFeed(localRaceCounty(race, area, SOS_ELECTION));
  const query = useQuery({ ...countyQueryOptions(found?.slug ?? ""), enabled: Boolean(found) });
  const data = query.data;
  const contest = useMemo(
    () =>
      found && data
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
  const labelId = useId();
  if (!found || !contest || !result) return null;
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
        <ReportingLine result={result} checkedAt={query.dataUpdatedAt} change={change} />
      </div>
      <ResultBody result={result} />
      <RaceHistoryToggle id={id} />
      <p className="hint live-county-source">
        {found.feed.name} County's own count, as "{contest.title}". Semi-official: counting goes on
        for weeks ·{" "}
        <a href={found.feed.page} target="_blank" rel="noreferrer">
          county results ↗
        </a>{" "}
        · <Link to="/results">Results</Link>
      </p>
    </section>
  );
}
