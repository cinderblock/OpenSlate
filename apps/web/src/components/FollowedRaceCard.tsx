import { confidenceBucket, type Race as ResultRace, type Subject } from "@openslate/core";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { raceHeading } from "../lib/ballotView";
import type { Race } from "../lib/collate";
import { formatElectionDate, formatLocalDate } from "../lib/dates";
import { electionPhase, upcomingChipLabel } from "../lib/election-phase";
import {
  changesSince,
  type FollowedRace,
  followedRacesStore,
  resultLine,
  withSeen,
} from "../lib/followedRaces";
import { jurisdictionLabel } from "../lib/jurisdictions";
import { useRacePolls } from "../lib/polls";
import { fieldStanding, headlineChoices, namedChoices, tallyRace } from "../lib/raceTally";
import { raceQueryOptions, raceSearchQueryOptions, resolveSubjectRace } from "../lib/results";
import { plural } from "./AllSlates";
import { FollowButton } from "./FollowButton";

/** How many new sources a card names before "and N more". */
const NEW_NAMES = 5;

/**
 * A race's results once polls have closed: the race a results page settled on,
 * else civicAPI's match if it's a confident one. Another race's numbers would
 * read as this one's, so a doubtful match shows nothing here (the race page
 * lets you pick).
 */
function useFollowedResult(subject: Subject): ResultRace | undefined {
  const [pinned, setPinned] = useState<string>();
  const search = useQuery(raceSearchQueryOptions(subject));
  const top = search.data?.ranked[0];
  useEffect(() => {
    let cancelled = false;
    void resolveSubjectRace(subject).then((mapping) => {
      if (!cancelled && mapping) setPinned(mapping.raceId);
    });
    return () => {
      cancelled = true;
    };
  }, [subject]);
  const confident = top && confidenceBucket(top.score) === "high" ? String(top.race.id) : undefined;
  return useQuery(raceQueryOptions(pinned ?? confident)).data;
}

/** The newest poll of a race, on one line. Most local races have none. */
function LatestPoll({ subject }: { subject: Subject }) {
  const { polls } = useRacePolls(subject);
  const poll = polls[0];
  if (!poll) return null;
  const answers = [...poll.answers].sort((a, b) => b.pct - a.pct).slice(0, 3);
  return (
    <p className="followed-line">
      <span className="hint">
        Latest poll: {poll.pollster}
        {poll.end_date && `, ${poll.end_date}`}:
      </span>{" "}
      {answers.map((a) => `${a.choice} ${a.pct.toFixed(0)}%`).join(" · ")}
    </p>
  );
}

function FollowedResult({ subject, choice }: { subject: Subject; choice?: string }) {
  const result = useFollowedResult(subject);
  const line = result && resultLine(result, choice);
  if (!line) return null;
  return (
    <p className="followed-line">
      <span className="hint">Results:</span> <strong>{line}</strong>
    </p>
  );
}

/** Who's new since the last look, and how to clear that. */
function WhatsNew({ item, race }: { item: FollowedRace; race: Race }) {
  const tally = useMemo(() => tallyRace(race), [race]);
  const { added, gone } = changesSince(tally, item);
  if (added.length === 0 && gone === 0) return null;
  const names = added
    .slice(0, NEW_NAMES)
    .map(({ position, choice }) =>
      item.choice === undefined && choice
        ? `${position.source.name} (${choice})`
        : position.source.name,
    );
  const more = added.length - names.length;
  const since = item.seenAt ?? item.since;
  return (
    <p className="followed-new" role="status">
      {added.length > 0 && (
        <>
          <strong>{added.length} new</strong> since {formatLocalDate(since)}: {names.join(", ")}
          {more > 0 && ` and ${more} more`}.{" "}
        </>
      )}
      {gone > 0 && `${plural(gone, "position")} no longer listed. `}
      <button
        type="button"
        className="link"
        onClick={() =>
          followedRacesStore.set((current) =>
            withSeen(
              current,
              () => tally,
              new Date().toISOString(),
              item,
            ),
          )
        }
      >
        Got it
      </button>
    </p>
  );
}

/** The counts on the race, or on the one candidate followed. */
function Standing({ item, race }: { item: FollowedRace; race: Race }) {
  const tally = useMemo(() => tallyRace(race), [race]);
  if (item.choice === undefined) {
    const lead = headlineChoices(tally);
    if (lead.length === 0) return <p className="hint">No slate has taken a position yet.</p>;
    const others = namedChoices(tally).length - lead.length;
    return (
      <p className="followed-line">
        {lead.map((c, i) => (
          <span key={c.group.choice}>
            {i > 0 && " · "}
            {c.group.choice} <strong>{c.for}</strong>
            {c.against > 0 && ` (${c.against} against)`}
          </span>
        ))}
        {others > 0 && <span className="hint"> · and {others} more</span>}
      </p>
    );
  }
  const own = tally.choices.find((c) => c.group.choice === item.choice);
  if (!own) {
    return <p className="hint">The race no longer lists {item.choice}.</p>;
  }
  const standing = fieldStanding(tally, item.choice);
  return (
    <p className="followed-line">
      <strong>{own.for} for</strong> · <strong>{own.against} against</strong>
      {standing && standing.of > 1 && (
        <span className="hint">
          {" "}
          ·{" "}
          {standing.leader
            ? `${standing.leader.group.choice} leads with ${standing.leader.for}`
            : standing.tied
              ? `tied for the most backed of ${standing.of}`
              : `the most backed of ${standing.of}`}
        </span>
      )}
    </p>
  );
}

/**
 * How a race or candidate you're following is doing: slates for and against,
 * what's changed since you last looked, the latest poll where there is one,
 * and results once polls close. `race` is undefined until the catalog is in,
 * and when it no longer has the race.
 */
export function FollowedRaceCard({
  item,
  race,
  loaded,
}: {
  item: FollowedRace;
  race: Race | undefined;
  /** The catalog is in, so a missing `race` really is missing. */
  loaded: boolean;
}) {
  const { subject, choice } = item;
  const title = race ? raceHeading(race).heading : subject.title;
  const label = upcomingChipLabel(electionPhase(subject));
  return (
    <li className="card followed-race">
      <div className="card-title">
        <strong>{choice ?? title}</strong>
        {label && <span className="tag">{label}</span>}
        <span className="grow" />
        <FollowButton raceKey={item.key} subject={subject} {...(choice ? { choice } : {})} />
      </div>
      <p className="hint">
        {[
          choice ? title : undefined,
          subject.jurisdiction && jurisdictionLabel(subject.jurisdiction),
          subject.election && formatElectionDate(subject.election),
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {race && <Standing item={item} race={race} />}
      {race && <WhatsNew item={item} race={race} />}
      {!race && loaded && <p className="hint">The public catalog no longer lists this race.</p>}
      <LatestPoll subject={subject} />
      <FollowedResult subject={subject} {...(choice ? { choice } : {})} />
      <p className="followed-line">
        <Link to="/race/$key" params={{ key: item.key }} search={{ all: true }}>
          All slates, polls and results
        </Link>
      </p>
    </li>
  );
}
