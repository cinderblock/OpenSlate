import { verifySlate } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { slatesCollection } from "../lib/collections";
import { shortKey } from "../lib/identities";

// Listing page for /results. The user picks an imported slate (or pastes a
// token) and we route to /results/$token, where each Position is rendered
// next to its civicAPI outcome. Read-only — viewing results never edits the
// slate.

export function ResultsView() {
  const { data: slates } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  const navigate = useNavigate();
  const [pasted, setPasted] = useState("");

  const rows = useMemo(() => {
    return slates
      .map(({ token, importedAt }) => {
        const result = verifySlate(token);
        return {
          token,
          importedAt,
          issuer: result.payload?.issuer,
          positions: result.payload?.positions ?? [],
          valid: result.valid,
        };
      })
      .sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1));
  }, [slates]);

  const trimmed = pasted.trim();
  const pastedValid = useMemo(() => {
    if (!trimmed) return null;
    try {
      const result = verifySlate(trimmed);
      return result.valid;
    } catch {
      return false;
    }
  }, [trimmed]);

  return (
    <section className="panel">
      <h2>Election results</h2>
      <p className="hint">
        Compare any slate's endorsements against the actual election outcomes pulled live from{" "}
        <a href="https://civicapi.org" target="_blank" rel="noreferrer">
          civicAPI
        </a>
        . This view is read-only — it never edits the slate.
      </p>

      <div className="card">
        <h3>Paste a slate</h3>
        <label>
          Block
          <textarea
            rows={4}
            className="token"
            placeholder="paste any OpenSlate block to view its results…"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
          />
        </label>
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={!trimmed || pastedValid === false}
            onClick={() => {
              navigate({ to: "/results/$token", params: { token: trimmed } });
            }}
          >
            View results
          </button>
          {pastedValid === false && <span className="error">Token didn't verify.</span>}
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="card">
          <p className="hint">
            Nothing imported yet. Use the Import &amp; verify tab to add slates.
          </p>
        </div>
      ) : (
        <div className="card">
          <h3>Your imported slates</h3>
          <ul className="position-list">
            {rows.map((row) => (
              <li key={row.token}>
                <span className="position-subject">
                  <strong>
                    {row.issuer?.name?.trim() || shortKey(row.issuer?.key ?? "(unknown)")}
                  </strong>
                  {!row.valid && <span className="warning"> (unverified)</span>}
                  <div className="hint">
                    {row.positions.length} position{row.positions.length === 1 ? "" : "s"} ·
                    imported {row.importedAt.slice(0, 10)}
                  </div>
                </span>
                <Link to="/results/$token" params={{ token: row.token }} className="link">
                  View results →
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
