import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { feedContestResult } from "../lib/feedContest";
import { areaStates, stateLabel } from "../lib/jurisdictions";
import { useArea } from "../lib/myVote";
import {
  feedOfRegion,
  type StateContest,
  type StateResults,
  stateFeedQueryOptions,
  stateSections,
} from "../lib/stateFeeds";
import { ReportingLine, ResultBody } from "./LiveResult";
import { TextField } from "./ui/TextField";

/**
 * A state's own count, as its election office publishes it (`stateFeeds.ts`):
 * what the whole state votes on, the voter's districts, and the rest behind a
 * search. Checked every minute while the page is open. California has a page
 * of its own (`LivePanel`): its Secretary of State's API works by contest,
 * and its counties' counts come beside it.
 */

/** "Department of Elections'", "Secretary of State's". */
function possessive(name: string): string {
  return name.endsWith("s") ? `${name}'` : `${name}'s`;
}

/** How many of a long list show before a search narrows it. */
const SHOWN = 12;

const whenFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
const utcFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "UTC",
  hourCycle: "h23",
});

export function StateLivePanel({ region }: { region: string }) {
  const found = feedOfRegion(region);
  if (!found) return null;
  return <Panel region={region} code={found.code} />;
}

function Panel({ region, code }: { region: string; code: string }) {
  const feed = feedOfRegion(region)?.feed;
  const query = useQuery(stateFeedQueryOptions(code));
  const [area] = useArea();
  const mine = areaStates(area).has(region);
  const sections = useMemo(
    () =>
      feed && query.data
        ? stateSections(region, feed, query.data.contests, mine ? area : undefined)
        : undefined,
    [region, feed, query.data, mine, area],
  );
  if (!feed) return null;
  const name = stateLabel(region);
  const results = query.data;

  return (
    <section className="panel live-panel">
      <h2>Live count: {name}</h2>
      <p className="hint">
        The {possessive(feed.office)} own count, checked every minute while this page is open. New
        counts appear here on their own, so there's no need to reload.
        {results?.updated !== undefined && (
          <>
            {" "}
            It last published at {whenFmt.format(results.updated)}{" "}
            <span className="hint">({utcFmt.format(results.updated)}Z)</span>.
          </>
        )}
        {results?.official === true
          ? " It calls these results official."
          : " Unofficial until they are certified."}
      </p>

      {query.isError && !results ? (
        <p className="error">
          Couldn't get {name}'s count: {query.error.message}. Trying again.{" "}
          <a href={feed.page} target="_blank" rel="noreferrer">
            Its own page ↗
          </a>
        </p>
      ) : !results || !sections ? (
        <p className="hint">Loading {name}'s count…</p>
      ) : (
        <>
          {mine ? (
            <Group
              title="Your districts"
              items={sections.mine}
              results={results}
              units={feed.units}
              query={query}
              empty="None of your districts has a race in this count."
            />
          ) : (
            <p className="hint">
              <Link to="/">Say where you vote</Link> in {name} to see your own districts' races
              first.
            </p>
          )}
          <Group
            title="Statewide"
            items={sections.statewide}
            results={results}
            units={feed.units}
            query={query}
            empty="No statewide contest in this count."
          />
          <Searchable
            title={mine ? "Other districts" : "Congress and the legislature"}
            items={sections.districts}
            results={results}
            units={feed.units}
            query={query}
          />
          <Searchable
            title="Courts, counties, towns and local measures"
            items={sections.other}
            results={results}
            units={feed.units}
            query={query}
          />
        </>
      )}

      <p className="hint live-source">
        Source:{" "}
        <a href={feed.page} target="_blank" rel="noreferrer">
          {feed.office} ↗
        </a>
        . Where a contest says how much has reported, it counts {feed.units}.
      </p>
    </section>
  );
}

interface GroupProps {
  title: string;
  items: StateContest[];
  results: StateResults;
  units: string;
  query: { dataUpdatedAt: number; isFetching: boolean };
}

function Group({ title, items, results, units, query, empty }: GroupProps & { empty: string }) {
  return (
    <section className="live-group">
      <h3>{title}</h3>
      {items.length === 0 ? (
        <p className="hint">{empty}</p>
      ) : (
        <Cards items={items} results={results} units={units} query={query} />
      )}
    </section>
  );
}

/** A long list: the first few, the rest by searching for a district, a place or a name. */
function Searchable({ title, items, results, units, query }: GroupProps) {
  const [search, setSearch] = useState("");
  const [all, setAll] = useState(false);
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matching = useMemo(
    () =>
      words.length === 0
        ? items
        : items.filter(({ contest }) => {
            const text =
              `${contest.title} ${contest.choices.map((c) => c.name).join(" ")}`.toLowerCase();
            return words.every((word) => text.includes(word));
          }),
    [items, words],
  );
  if (items.length === 0) return null;
  const shown = all ? matching : matching.slice(0, SHOWN);
  return (
    <section className="live-group">
      <h3>
        {title} <span className="hint">({items.length})</span>
      </h3>
      {items.length > SHOWN && (
        <TextField
          aria-label={`Search ${title.toLowerCase()}`}
          placeholder="Search by district, place or name"
          value={search}
          onChange={setSearch}
        />
      )}
      {matching.length === 0 ? (
        <p className="hint">Nothing in this count matches "{search.trim()}".</p>
      ) : (
        <Cards items={shown} results={results} units={units} query={query} />
      )}
      {matching.length > shown.length && (
        <p>
          <button type="button" className="link" onClick={() => setAll(true)}>
            Show all {matching.length}
          </button>
        </p>
      )}
    </section>
  );
}

function Cards({ items, results, units, query }: Omit<GroupProps, "title">) {
  return (
    <ul className="live-contests">
      {items.map(({ contest }) => {
        const result = feedContestResult(contest, results.updated, results.seenAt, units);
        return (
          <li key={contest.key} className="live-contest card">
            <div className="live-contest-head">
              <strong>{contest.title}</strong>
              <ReportingLine
                result={result}
                checkedAt={query.dataUpdatedAt}
                change={undefined}
                fetching={query.isFetching}
              />
            </div>
            <ResultBody result={result} />
          </li>
        );
      })}
    </ul>
  );
}
