import { verifySlate } from "@openslate/core";
import { Link, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { shortKey } from "../lib/identities";
import { ResultsPanel } from "./ResultsPanel";

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
  const issuerName = payload.issuer.name?.trim() || shortKey(payload.issuer.key);

  return (
    <section className="panel">
      <p>
        <Link to="/results">← back to Results</Link>
      </p>
      <h2>Results for {issuerName}'s slate</h2>
      <p className="hint">
        Issued {payload.issued_at.slice(0, 10)}
        {payload.context?.election && <> · election {payload.context.election}</>}
        {payload.context?.jurisdiction && <> · {payload.context.jurisdiction}</>}
        {!valid && <span className="warning"> · unverified</span>}
      </p>

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
            />
          </div>
        ))
      )}
    </section>
  );
}
