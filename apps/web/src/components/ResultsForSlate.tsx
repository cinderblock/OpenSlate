import { verifySlate } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { Link, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { slatesCollection } from "../lib/collections";
import { shortKey } from "../lib/identities";
import { useResolvedRaces } from "../lib/results";
import { positionOutcome, summarizeSlate } from "../lib/slate-summary";
import { subjectKey } from "../lib/subjects";
import { firsthandSubjectKeys, payloadsFromTokens } from "../lib/supersession";
import { ResultsPanel } from "./ResultsPanel";
import { SecondhandBanner } from "./SecondhandBanner";
import { type OutcomeFilter, SlateSummaryHeadline } from "./SlateSummaryHeadline";

export function ResultsForSlate() {
  const { token } = useParams({ from: "/results/$token" });
  const { data: allSlates } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  const [filter, setFilter] = useState<OutcomeFilter>("all");

  const verified = useMemo(() => verifySlate(token), [token]);
  const positions = useMemo(() => verified.payload?.positions ?? [], [verified.payload]);
  const subjects = useMemo(() => positions.map((p) => p.subject), [positions]);

  // Single source of truth for race detail — both the headline summary and
  // the per-position filter read from this. Each ResultsPanel keeps its own
  // queries too, but they share cache so there's no extra fetch.
  const races = useResolvedRaces(subjects);

  const summary = useMemo(() => summarizeSlate(positions, races), [positions, races]);

  // SPEC §3.9: compute firsthand coverage across the user's local set so we
  // can flag individual positions of a secondhand slate that *could* be cross-
  // referenced firsthand. Excludes the slate we're viewing itself so it
  // doesn't self-cover.
  const firstKeys = useMemo(() => {
    const tokens = allSlates.map((s) => s.token).filter((t) => t !== token);
    return firsthandSubjectKeys(payloadsFromTokens(tokens));
  }, [allSlates, token]);

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
  const visiblePositions = positions
    .map((position, i) => ({ position, race: races[i], index: i }))
    .filter(({ position, race }) => {
      if (filter === "all") return true;
      const outcome = positionOutcome(position, race);
      return outcome === filter;
    });

  return (
    <section className="panel">
      <p className="no-print">
        <Link to="/results">← back to Results</Link>
        {" · "}
        <button type="button" className="link" onClick={() => window.print()}>
          Print
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

      {positions.length === 0 ? (
        <div className="card">
          <p className="hint">This slate has no positions.</p>
        </div>
      ) : visiblePositions.length === 0 ? (
        <div className="card">
          <p className="hint">No positions match the current filter.</p>
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
              <ResultsPanel
                subject={position.subject}
                stance={position.stance}
                choice={position.choice}
                attributedTo={attributedTo}
              />
            </div>
          );
        })
      )}
    </section>
  );
}
