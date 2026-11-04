import { verifySlate } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { Link, useNavigate } from "@tanstack/react-router";
import { startTransition, useEffect, useMemo, useState } from "react";
import { slatesCollection } from "../lib/collections";
import { formatElectionDate } from "../lib/dates";
import { useDecodedSlates } from "../lib/decodedSlates";
import { shortKey } from "../lib/identities";
import { usePageSearch } from "../lib/pageSearch";
import { matchesSearch, searchTextOf } from "../lib/search";
import { firsthandSubjectKeys, supersessionFor } from "../lib/supersession";
import { Leaderboard } from "./Leaderboard";
import { LivePanel } from "./LivePanel";
import { matchCount, PageSearch } from "./PageSearch";
import { ProgressBar } from "./ui/ProgressBar";
import { TokenField } from "./ui/Token";

// Listing page for /results. The user picks an imported slate (or pastes a
// token) and we route to /results/$token, where each Position is rendered
// next to its civicAPI outcome. Read-only — viewing results never edits the
// slate.

export function ResultsView() {
  const { data: stored, isReady } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  // Checking a few hundred signatures takes seconds on a phone. Done a slice at
  // a time, it leaves the page (and its tabs) responsive, with a bar to watch.
  const decoded = useDecodedSlates(stored);

  const navigate = useNavigate();
  const [pasted, setPasted] = useState("");

  const rows = useMemo(() => {
    // SPEC §3.9: surface when a secondhand report has firsthand coverage
    // available in the user's local set, so they can prefer the authoritative
    // slate without us auto-hiding the secondhand one (we don't yet have the
    // trust layer to know which firsthand slate actually belongs to the
    // reported entity).
    const slates = decoded.slates ?? [];
    const firstKeys = firsthandSubjectKeys(slates.map((s) => s.payload));

    return slates
      .map(({ token, importedAt, payload, valid }) => {
        const election = payload.context?.election;
        return {
          token,
          importedAt,
          payload,
          issuer: payload.issuer,
          attribution: payload.attribution,
          positions: payload.positions,
          valid,
          supersession: supersessionFor(payload, firstKeys),
          // Found by who signed it, who it reports on, and its election.
          searchText: searchTextOf([
            payload.issuer.name,
            payload.issuer.key,
            payload.attribution?.of.name,
            payload.attribution?.of.uri,
            election,
            election && formatElectionDate(election),
          ]),
        };
      })
      .sort((a, b) => (a.importedAt < b.importedAt ? 1 : -1));
  }, [decoded.slates]);

  // A few hundred rows (each a link carrying its whole slate) take a while to
  // render. Rendering them in a transition lets React do it in slices, so the
  // tab switches at once and stays clickable while the list fills in.
  const [listed, setListed] = useState<typeof rows>();
  useEffect(() => {
    if (decoded.slates) startTransition(() => setListed(rows));
  }, [decoded.slates, rows]);
  const loading = !isReady || !decoded.slates || listed !== rows;

  const search = usePageSearch("/results");
  const all = listed ?? [];
  const shown = search.searching
    ? all.filter((row) => matchesSearch(row.searchText, search.terms))
    : all;

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
    <>
      <LivePanel />
      <section className="panel">
        <h2>How your slates did</h2>
        <p className="hint">
          Pick a slate to see each of its picks next to the outcome: the California Secretary of
          State's count for the races it counts, civicAPI's for the rest. Read-only: it never edits
          the slate.
        </p>

        <div className="card">
          <h3>Paste a slate</h3>
          <TokenField
            label="Block"
            rows={4}
            placeholder="paste any OpenSlate block to view its results…"
            value={pasted}
            onChange={setPasted}
          />
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

        {loading ? (
          <div className="card">
            {isReady && !decoded.slates ? (
              <ProgressBar
                label="Checking the signatures on your slates"
                value={decoded.done}
                maxValue={decoded.total}
              />
            ) : (
              <ProgressBar label="Listing your slates" value={0} />
            )}
          </div>
        ) : rows.length === 0 ? (
          <div className="card">
            <p className="hint">Nothing imported yet. Add some on the Sources page.</p>
          </div>
        ) : (
          <div className="card">
            <h3>Your imported slates</h3>
            <PageSearch
              search={search}
              label="Search your imported slates"
              placeholder="Search by who signed it, who it reports on, or election…"
            >
              {matchCount(shown.length, rows.length, "slates", search.query)}
            </PageSearch>
            <ul className="position-list slate-grid">
              {shown.map((row) => {
                const signerName = row.issuer.name?.trim() || shortKey(row.issuer.key);
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

        {!loading && rows.length >= 2 && <Leaderboard slates={rows} />}
      </section>
    </>
  );
}
