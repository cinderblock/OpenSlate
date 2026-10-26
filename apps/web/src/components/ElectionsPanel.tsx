import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useBallotDraft } from "../lib/ballotDraft";
import { civicElectionsQueryOptions, useCivicRoutes } from "../lib/civic";
import { formatElectionDate } from "../lib/dates";
import { type ElectionEntry, electionEntries } from "../lib/electionList";
import { localToday, useDecodedSlates, useMyElection } from "../lib/myVote";
import { usePageSearch } from "../lib/pageSearch";
import { matchesSearch, searchTextOf } from "../lib/search";
import { PageSearch, matchCount } from "./PageSearch";
import { ReportCivicProblem } from "./ReportCivicProblem";
import { Switch } from "./ui/Switch";

const TODAY = localToday();

/** Hidden until "Show past + Test elections": past ones, and Google's test election. */
function isHidden(entry: ElectionEntry): boolean {
  return entry.past === true || entry.id === "2000";
}

export function ElectionsPanel() {
  // Google's list, with the user's own key when they've saved one, else through
  // OpenSlate's relay when it can ask Google; neither, and the page doesn't ask.
  const civic = useCivicRoutes();
  const route = civic.routes[0];
  const hasGoogle = route !== undefined;
  const electionsQuery = useQuery(civicElectionsQueryOptions(route, civic.key));
  const { slates } = useDecodedSlates();
  const draft = useBallotDraft();
  const [myElection, setMyElection] = useMyElection();
  const [showPast, setShowPast] = useState(false);

  const entries = useMemo(
    () =>
      electionEntries(
        electionsQuery.data ?? [],
        slates.map((slate) => slate.payload),
        Object.values(draft.rows)
          .map((row) => row.electionId)
          .filter((id) => id !== ""),
        TODAY,
      ),
    [electionsQuery.data, slates, draft.rows],
  );

  const search = usePageSearch("/publish/elections");
  const found = useMemo(
    () =>
      search.searching
        ? entries.filter((e) => matchesSearch(electionSearchText(e), search.terms))
        : entries,
    [entries, search.searching, search.terms],
  );
  const visible = useMemo(() => {
    const filtered = showPast ? found : found.filter((e) => !isHidden(e));
    return [...filtered].sort((a, b) => {
      // Upcoming (date in future) first, ascending by date.
      // Unknown-date next.
      // Past last, descending by date (most recent first).
      const aBucket = a.past === false ? 0 : a.past === undefined ? 1 : 2;
      const bBucket = b.past === false ? 0 : b.past === undefined ? 1 : 2;
      if (aBucket !== bBucket) return aBucket - bBucket;
      if (aBucket === 2) return (b.electionDay ?? "").localeCompare(a.electionDay ?? "");
      return (a.electionDay ?? "").localeCompare(b.electionDay ?? "");
    });
  }, [found, showPast]);

  const pastCount = entries.filter(isHidden).length;
  // Matches the "Show past" switch is hiding.
  const foundPast = showPast ? 0 : found.length - visible.length;

  return (
    <section className="panel">
      <h2>Elections</h2>
      <p className="hint">
        Every election we know about: {hasGoogle && "from Google's list, "}from your imported
        slates, and from your local drafts. Picking one as <em>active</em> sets the election My
        ballot and Compose show.
      </p>

      <div className="card">
        <Switch isSelected={showPast} onChange={setShowPast}>
          Show past + Test elections <span className="hint">({pastCount} hidden)</span>
        </Switch>
      </div>

      {entries.length > 0 && (
        <PageSearch
          search={search}
          label="Search elections"
          placeholder="Search elections by name, date, place or id…"
        >
          {matchCount(
            visible.length,
            showPast ? entries.length : entries.length - pastCount,
            "elections",
            search.query,
          )}
          {foundPast > 0 && (
            <>
              {" "}
              <button type="button" className="link" onClick={() => setShowPast(true)}>
                Show {foundPast} past or test
              </button>
            </>
          )}
        </PageSearch>
      )}

      {(civic.isLoading || electionsQuery.isLoading) && <p className="hint">Loading elections…</p>}
      {electionsQuery.error && (
        <p className="hint" title={electionsQuery.error.message}>
          Couldn't get Google's elections list: {electionsQuery.error.message}
          {route === "key" && (
            <>
              {" "}
              Check your key in <Link to="/settings">Settings</Link>.
            </>
          )}
          {route && (
            <>
              {" "}
              <ReportCivicProblem
                lookup="elections"
                route={route}
                message={electionsQuery.error.message}
              />
            </>
          )}
        </p>
      )}

      {visible.length === 0 ? (
        <div className="card">
          <p className="hint">
            {search.searching
              ? "No elections match."
              : `No elections ${showPast ? "found" : "upcoming"}.`}
          </p>
        </div>
      ) : (
        visible.map((entry) => (
          <ElectionCard
            key={entry.id}
            entry={entry}
            isActive={entry.electionDay !== undefined && entry.electionDay === myElection}
            setActive={entry.electionDay ? () => setMyElection(entry.electionDay ?? "") : undefined}
          />
        ))
      )}
    </section>
  );
}

/** What an election is found by: its name, date (as dated and as shown), division and id. */
function electionSearchText(entry: ElectionEntry): string {
  return searchTextOf([
    entry.name,
    entry.electionDay,
    entry.electionDay && formatElectionDate(entry.electionDay),
    entry.ocdDivisionId,
    entry.id,
  ]);
}

function ElectionCard({
  entry,
  isActive,
  setActive,
}: {
  entry: ElectionEntry;
  isActive: boolean;
  /** Absent when the election has no date to key My ballot by. */
  setActive?: () => void;
}) {
  const isTest = entry.id === "2000";
  return (
    <div className={`card election-card${entry.past ? " election-past" : ""}`}>
      <div className="card-title">
        <strong>
          {entry.name ??
            (entry.electionDay === entry.id
              ? formatElectionDate(entry.id)
              : `Election ${entry.id}`)}
        </strong>
        {entry.past === true && <span className="tag">past</span>}
        {entry.past === undefined && <span className="tag">unknown date</span>}
        {isTest && <span className="tag">test</span>}
        {isActive && <span className="tag stance-endorse">active</span>}
      </div>
      <p className="hint">
        {entry.electionDay ?? "—"}
        {entry.ocdDivisionId && ` · ${entry.ocdDivisionId}`}
        {" · "}
        <code className="key">id {entry.id}</code>
      </p>
      <p className="hint">
        {[
          entry.sources.google && "on Google's list, with ballot data",
          entry.sources.slates > 0 && `${entry.sources.slates} imported slate(s)`,
          entry.sources.drafts > 0 && `${entry.sources.drafts} draft row(s)`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <div className="row">
        {!isActive && setActive && (
          <button type="button" onClick={setActive}>
            Use as active
          </button>
        )}
        <Link to="/publish" className="link">
          Open in Compose →
        </Link>
      </div>
    </div>
  );
}
