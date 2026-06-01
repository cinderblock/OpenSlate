import { verifySlate } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { Link, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { slatesCollection } from "../lib/collections";
import { shortKey } from "../lib/identities";
import { subjectKey } from "../lib/subjects";
import { firsthandSubjectKeys, payloadsFromTokens } from "../lib/supersession";
import { ResultsPanel } from "./ResultsPanel";
import { SecondhandBanner } from "./SecondhandBanner";
import { SlateSummaryHeadline } from "./SlateSummaryHeadline";

export function ResultsForSlate() {
  const { token } = useParams({ from: "/results/$token" });
  const { data: allSlates } = useLiveQuery((q) => q.from({ slate: slatesCollection }));

  const verified = useMemo(() => verifySlate(token), [token]);

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
  // For secondhand reports the headline names the *reported* entity; the signer
  // is shown below in the SecondhandBanner. Firsthand slates use the signer name.
  const headlineSubject = attribution ? attribution.of.name : signerDisplay;
  // Per-position UserCheck framing in ResultsPanel — pass through so the
  // copy says "Sierra Club's pick won" not "Your pick won" on a researcher's
  // scrape of the Sierra Club.
  const attributedTo = attribution?.of.name;

  return (
    <section className="panel">
      <p>
        <Link to="/results">← back to Results</Link>
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

      <SlateSummaryHeadline positions={payload.positions} attributedTo={attributedTo} />

      {payload.positions.length === 0 ? (
        <div className="card">
          <p className="hint">This slate has no positions.</p>
        </div>
      ) : (
        payload.positions.map((position, i) => {
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
