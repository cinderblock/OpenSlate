import { verifySlate } from "@openslate/core";
import { Link, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { shortKey } from "../lib/identities";
import { ResultsPanel } from "./ResultsPanel";
import { SecondhandBanner } from "./SecondhandBanner";

export function ResultsForSlate() {
  const { token } = useParams({ from: "/results/$token" });

  const verified = useMemo(() => verifySlate(token), [token]);

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

      {payload.positions.length === 0 ? (
        <div className="card">
          <p className="hint">This slate has no positions.</p>
        </div>
      ) : (
        payload.positions.map((position, i) => (
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
            </p>
            <ResultsPanel
              subject={position.subject}
              stance={position.stance}
              choice={position.choice}
              attributedTo={attributedTo}
            />
          </div>
        ))
      )}
    </section>
  );
}
