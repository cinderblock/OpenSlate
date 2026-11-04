import { verifySlate } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { Link, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useBallotCounts } from "../lib/ballotResults";
import { collateRaces, decodeSlates } from "../lib/collate";
import { slatesCollection } from "../lib/collections";
import { useDecodedSlates } from "../lib/decodedSlates";
import { shortKey } from "../lib/identities";
import { useArea, useFollows } from "../lib/myVote";
import { usePageSearch } from "../lib/pageSearch";
import { useResolvedRaces } from "../lib/results";
import { slateToCsv, suggestCsvFilename } from "../lib/results-csv";
import { slateToMarkdown } from "../lib/results-markdown";
import { matchesSearch, positionSearchText } from "../lib/search";
import { positionOutcome, standingOutcome, summarizeOutcomes } from "../lib/slate-summary";
import { subjectKey } from "../lib/subjects";
import { firsthandSubjectKeys } from "../lib/supersession";
import { track } from "../lib/usage";
import { PageSearch } from "./PageSearch";
import { RaceCountyCount } from "./RaceCountyCount";
import { ResultsPanel } from "./ResultsPanel";
import { SecondhandBanner } from "./SecondhandBanner";
import { type OutcomeFilter, SlateSummaryHeadline } from "./SlateSummaryHeadline";

/** Trigger a client-side download of a string as a file. */
function downloadCsv(csv: string, filename: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function ResultsForSlate() {
  const { token } = useParams({ from: "/results/$token" });
  const { data: allSlates } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  const [filter, setFilter] = useState<OutcomeFilter>("all");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">("idle");

  const verified = useMemo(() => verifySlate(token), [token]);
  const positions = useMemo(() => verified.payload?.positions ?? [], [verified.payload]);
  const subjects = useMemo(() => positions.map((p) => p.subject), [positions]);

  // Single source of truth for race detail — both the headline summary and
  // the per-position filter read from this. Each ResultsPanel keeps its own
  // queries too, but they share cache so there's no extra fetch.
  const races = useResolvedRaces(subjects);

  // The search box narrows the positions shown, never the summary or exports.
  const search = usePageSearch("/results/$token");
  const positionText = useMemo(() => positions.map(positionSearchText), [positions]);

  // SPEC §3.9: compute firsthand coverage across the user's local set so we
  // can flag individual positions of a secondhand slate that *could* be cross-
  // referenced firsthand. Excludes the slate we're viewing itself so it
  // doesn't self-cover.
  // Verified a slice at a time, so a few hundred slates don't hold up the page;
  // the flags appear once they're in.
  const { slates: decoded } = useDecodedSlates(allSlates);
  const firstKeys = useMemo(
    () =>
      firsthandSubjectKeys((decoded ?? []).filter((s) => s.token !== token).map((s) => s.payload)),
    [decoded, token],
  );

  // The same counts as How my ballot is doing: the state's, the county's own
  // for local races, civicAPI for the rest. Each subject's race is collated
  // from every slate here that names it, so a county contest can be matched
  // by the whole field, not only the one name this slate picks.
  const [follows] = useFollows();
  const [area] = useArea();
  const ballotRaces = useMemo(() => {
    const keys = new Set(subjects.map(subjectKey));
    const touching = [...(decoded ?? []), ...decodeSlates([{ token, importedAt: "" }])].filter(
      (s) => s.payload.positions.some((p) => keys.has(subjectKey(p.subject))),
    );
    return collateRaces(touching, { follows, includeUnfollowed: true }).filter((r) =>
      keys.has(r.key),
    );
  }, [decoded, token, subjects, follows]);
  const raceByKey = useMemo(() => new Map(ballotRaces.map((r) => [r.key, r])), [ballotRaces]);
  const counts = useBallotCounts(ballotRaces, area);
  const outcomes = useMemo(
    () =>
      positions.map((position, i) => {
        const count = counts.get(subjectKey(position.subject));
        return count?.status === "found"
          ? standingOutcome(position, count.standing)
          : positionOutcome(position, races[i]);
      }),
    [positions, counts, races],
  );
  const summary = useMemo(() => summarizeOutcomes(outcomes), [outcomes]);

  if (!verified.payload) {
    return (
      <section className="panel">
        <p>
          <Link to="/results">← back to Results</Link>
        </p>
        <div className="card">
          <h3 className="error">Couldn't verify this slate</h3>
          {verified.errors.map((err) => (
            <p key={err} className="error">
              {err}
            </p>
          ))}
        </div>
      </section>
    );
  }

  const { payload, valid } = verified;
  const signerDisplay = payload.issuer.name?.trim() || shortKey(payload.issuer.key);
  const attribution = payload.attribution;
  const headlineSubject = attribution ? attribution.of.name : signerDisplay;
  const attributedTo = attribution?.of.name;

  // Apply the outcome filter using the per-position outcomes derived from `races`.
  const underFilter = positions
    .map((position, i) => ({ position, race: races[i], index: i }))
    .filter(({ index }) => filter === "all" || outcomes[index] === filter);
  // Then the search.
  const visiblePositions = underFilter.filter(({ index }) =>
    matchesSearch(positionText[index] ?? "", search.terms),
  );

  return (
    <section className="panel">
      <p className="no-print">
        <Link to="/results">← back to Results</Link>
        {" · "}
        <button
          type="button"
          className="link"
          onClick={() => {
            track({ name: "results.print" });
            window.print();
          }}
        >
          Print
        </button>
        {" · "}
        <button
          type="button"
          className="link"
          onClick={() => {
            downloadCsv(slateToCsv(payload, races), suggestCsvFilename(payload));
            track({ name: "results.export", dims: { format: "csv" } });
          }}
        >
          Download CSV
        </button>
        {" · "}
        <button
          type="button"
          className="link"
          onClick={async () => {
            const md = slateToMarkdown(payload, races);
            try {
              await navigator.clipboard.writeText(md);
              track({ name: "results.export", dims: { format: "markdown" } });
              setCopyState("copied");
              setTimeout(() => setCopyState("idle"), 2000);
            } catch {
              setCopyState("error");
              setTimeout(() => setCopyState("idle"), 3000);
            }
          }}
        >
          {copyState === "copied"
            ? "Copied!"
            : copyState === "error"
              ? "Copy failed"
              : "Copy as Markdown"}
        </button>
      </p>
      <h2>
        {attribution ? "Results reported for " : "Results for "}
        {headlineSubject}'s slate
      </h2>
      <p className="hint">
        Issued {payload.issued_at.slice(0, 10)}
        {payload.context?.election && <> · election {payload.context.election}</>}
        {payload.context?.jurisdiction && <> · {payload.context.jurisdiction}</>}
        {!valid && <span className="warning"> · unverified</span>}
      </p>

      {attribution && <SecondhandBanner attribution={attribution} signerDisplay={signerDisplay} />}

      <SlateSummaryHeadline
        summary={summary}
        attributedTo={attributedTo}
        filter={filter}
        onFilterChange={setFilter}
      />

      {positions.length > 0 && (
        <PageSearch
          search={search}
          label="Search this slate's positions"
          placeholder="Search races, measures, candidates, places…"
        >
          {visiblePositions.length === 0
            ? `Nothing ${filter === "all" ? "" : "under this filter "}matches “${search.query.trim()}”.`
            : `${visiblePositions.length} of ${underFilter.length} position${underFilter.length === 1 ? "" : "s"} match${visiblePositions.length === 1 ? "es" : ""}.`}
          {filter !== "all" && (
            <>
              {" "}
              <button type="button" className="link" onClick={() => setFilter("all")}>
                Search every outcome
              </button>
            </>
          )}
        </PageSearch>
      )}

      {positions.length === 0 ? (
        <div className="card">
          <p className="hint">This slate has no positions.</p>
        </div>
      ) : visiblePositions.length === 0 ? (
        <div className="card">
          <p className="hint">
            No positions match the current {search.searching ? "filter and search" : "filter"}.
          </p>
        </div>
      ) : (
        visiblePositions.map(({ position, index: i }) => {
          const supersedable =
            attribution !== undefined && firstKeys.has(subjectKey(position.subject));
          return (
            <div key={`${position.subject.title}-${i}`}>
              <h3>{position.subject.title}</h3>
              <p className="hint">
                <span className={`stance stance-${position.stance}`}>{position.stance}</span>
                {position.choice && (
                  <>
                    {" "}
                    · <strong>{position.choice}</strong>
                  </>
                )}
                {position.subject.jurisdiction && <> · {position.subject.jurisdiction}</>}
                {position.subject.election && <> · {position.subject.election}</>}
                {supersedable && (
                  <span
                    className="tag warning"
                    title="SPEC §3.9: a firsthand slate in your collection covers this subject."
                  >
                    firsthand available
                  </span>
                )}
              </p>
              {(() => {
                // A local race the county's own count carries: that count, not civicAPI's search.
                const key = subjectKey(position.subject);
                const count = counts.get(key);
                const race = raceByKey.get(key);
                return count?.status === "found" && count.standing.source === "county" && race ? (
                  <RaceCountyCount race={race} card />
                ) : (
                  <ResultsPanel
                    subject={position.subject}
                    stance={position.stance}
                    choice={position.choice}
                    attributedTo={attributedTo}
                  />
                );
              })()}
            </div>
          );
        })
      )}
    </section>
  );
}
