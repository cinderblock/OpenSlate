import { verifySlate } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { slatesCollection } from "../lib/collections";
import { shortKey } from "../lib/identities";
import { firsthandSubjectKeys, payloadsFromTokens, supersessionFor } from "../lib/supersession";

// Listing page for /results. The user picks an imported slate (or pastes a
// token) and we route to /results/$token, where each Position is rendered
// next to its civicAPI outcome. Read-only — viewing results never edits the
// slate.

export function ResultsView() {
  const { data: slates } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  const navigate = useNavigate();
  const [pasted, setPasted] = useState("");

  const rows = useMemo(() => {
    // SPEC §3.9: surface when a secondhand report has firsthand coverage
    // available in the user's local set, so they can prefer the authoritative
    // slate without us auto-hiding the secondhand one (we don't yet have the
    // trust layer to know which firsthand slate actually belongs to the
    // reported entity).
    const tokens = slates.map((s) => s.token);
    const payloads = payloadsFromTokens(tokens);
    const firstKeys = firsthandSubjectKeys(payloads);

    return slates
      .map(({ token, importedAt }) => {
        const result = verifySlate(token);
        const payload = result.payload;
        return {
          token,
          importedAt,
          issuer: payload?.issuer,
          attribution: payload?.attribution,
          positions: payload?.positions ?? [],
          valid: result.valid,
          supersession: payload ? supersessionFor(payload, firstKeys) : null,
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
            {rows.map((row) => {
              const signerName =
                row.issuer?.name?.trim() || shortKey(row.issuer?.key ?? "(unknown)");
              return (
                <li key={row.token}>
                  <span className="position-subject">
                    {row.attribution ? (
                      <>
                        <strong>{row.attribution.of.name}</strong>
                        <span className="tag" title="Secondhand report (SPEC §3.9)">
                          secondhand
                        </span>
                        {row.supersession && row.supersession.coveredFirsthand > 0 && (
                          <span
                            className="tag warning"
                            title="SPEC §3.9: a firsthand slate covers some of these subjects — prefer it for those positions."
                          >
                            {row.supersession.coveredFirsthand}/{row.supersession.total} also
                            firsthand
                          </span>
                        )}
                        <div className="hint">
                          reported by {signerName} · {row.attribution.mode} · retrieved{" "}
                          {row.attribution.retrieved_at.slice(0, 10)}
                        </div>
                      </>
                    ) : (
                      <strong>{signerName}</strong>
                    )}
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
              );
            })}
          </ul>
        </div>
      )}
    </section>
  );
}
