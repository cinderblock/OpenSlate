import { verifySlate } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { Link, useNavigate } from "@tanstack/react-router";
import { startTransition, useEffect, useMemo, useState } from "react";
import { slatesCollection } from "../lib/collections";
import { stateCountRegions } from "../lib/counts";
import { formatElectionDate } from "../lib/dates";
import { useDecodedSlates } from "../lib/decodedSlates";
import { shortKey } from "../lib/identities";
import { areaStates, stateLabel } from "../lib/jurisdictions";
import { useArea } from "../lib/myVote";
import { usePageSearch } from "../lib/pageSearch";
import { pageRegion } from "../lib/regions";
import { matchesSearch, searchTextOf } from "../lib/search";
import { stateFeedRegions } from "../lib/stateFeeds";
import { firsthandSubjectKeys, supersessionFor } from "../lib/supersession";
import { useWatch } from "../lib/watch";
import { Leaderboard } from "./Leaderboard";
import { LivePanel } from "./LivePanel";
import { matchCount, PageSearch } from "./PageSearch";
import { StateLivePanel } from "./StateLivePanel";
import { ProgressBar } from "./ui/ProgressBar";
import { Select } from "./ui/Select";
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

  // The live count is the states' own. A voter sees their own state's: the
  // feed states' on one page each (`StateLivePanel`), California's on its own
  // (`LivePanel`, with its watch list). A voter in a state OpenSlate doesn't
  // read yet is told so, not handed another state's page; anyone can look at
  // another state's, and a link that names one (`/va`) opens with it.
  const [area] = useArea();
  const [watching] = useWatch();
  const [liveAnyway, setLiveAnyway] = useState(false);
  const counted = stateCountRegions();
  const feeds = stateFeedRegions();
  // States with a Live page of their own, not a feed's.
  const ownPages = counted.filter((state) => !feeds.includes(state));
  const mine = [...areaStates(area)];
  const uncounted = mine.filter((state) => !counted.includes(state));
  const myFeeds = mine.filter((state) => feeds.includes(state));
  const [other, setOther] = useState<string | undefined>(() => {
    const linked = pageRegion();
    return linked && feeds.includes(linked) && !mine.includes(linked) ? linked : undefined;
  });
  const otherShown = other && !myFeeds.includes(other) ? other : undefined;
  const showLive =
    liveAnyway ||
    watching.length > 0 ||
    mine.some((state) => ownPages.includes(state)) ||
    (mine.length === 0 && !otherShown);
  const others = feeds.filter((state) => !myFeeds.includes(state) && state !== otherShown);

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
      <section className="panel">
        <div className="card my-ballot-results-link">
          <h2>How my ballot is doing</h2>
          <p className="hint">
            Every race you marked on My ballot next to the count so far, grouped by whether it's
            going your way.
          </p>
          <Link to="/results/my-ballot" className="button-link">
            Compare my ballot with the results →
          </Link>
        </div>
      </section>
      {myFeeds.map((state) => (
        <StateLivePanel key={state} region={state} />
      ))}
      {otherShown && <StateLivePanel key={otherShown} region={otherShown} />}
      {showLive && <LivePanel />}
      {uncounted.length > 0 && (
        <section className="panel">
          <h2>Live count</h2>
          <p className="hint">
            OpenSlate doesn't read {uncounted.map(stateLabel).join(" or ")}'s own count yet: it
            reads {counted.length} states' so far. Your races' counts, where civicAPI has them, are
            on <Link to="/results/my-ballot">how my ballot is doing</Link> and on each race's own
            page.
          </p>
        </section>
      )}
      <section className="panel live-other-states">
        <Select
          label="See another state's count"
          placeholder="Choose a state"
          value={null}
          onChange={(state) => setOther(state ?? undefined)}
          options={others.map((state) => ({ id: state, label: stateLabel(state) }))}
        />
        {!showLive &&
          ownPages.map((state) => (
            <p key={state}>
              <button type="button" className="link" onClick={() => setLiveAnyway(true)}>
                Watch {stateLabel(state)}'s count
              </button>
            </p>
          ))}
      </section>
      <section className="panel">
        <h2>How your slates did</h2>
        <p className="hint">
          Pick a slate to see each of its picks next to the outcome: the state's own count where
          OpenSlate reads one (for the races the state counts), civicAPI's for the rest. Read-only:
          it never edits the slate.
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
