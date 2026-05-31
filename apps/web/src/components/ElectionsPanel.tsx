import { verifySlate } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useElectionId } from "../lib/address";
import { useBallotDraft } from "../lib/ballotDraft";
import { slatesCollection } from "../lib/collections";
import { electionsQueryOptions } from "../lib/query";

interface ElectionEntry {
  id: string;
  name?: string;
  electionDay?: string;
  ocdDivisionId?: string;
  sources: { google: boolean; slates: number; drafts: number };
  /** undefined = unknown date (no electionDay). */
  past: boolean | undefined;
}

const TODAY = new Date().toISOString().slice(0, 10);

export function ElectionsPanel() {
  const electionsQuery = useQuery(electionsQueryOptions());
  const { data: slates } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  const draft = useBallotDraft();
  const [activeElectionId, setActiveElectionId] = useElectionId();
  const [showPast, setShowPast] = useState(false);

  const entries = useMemo<ElectionEntry[]>(() => {
    const map = new Map<string, ElectionEntry>();

    for (const election of electionsQuery.data ?? []) {
      map.set(election.id, {
        id: election.id,
        name: election.name,
        electionDay: election.electionDay,
        ocdDivisionId: election.ocdDivisionId,
        sources: { google: true, slates: 0, drafts: 0 },
        past: election.electionDay ? election.electionDay < TODAY : undefined,
      });
    }

    // Count distinct slates per electionId (extracted from vip:<id>:... in subject.id).
    const slateCounts = new Map<string, number>();
    for (const slate of slates) {
      const result = verifySlate(slate.token);
      if (!result.payload) continue;
      const ids = new Set<string>();
      for (const position of result.payload.positions) {
        if (position.subject.id?.startsWith("vip:")) {
          const electionId = position.subject.id.slice(4).split(":")[0];
          if (electionId) ids.add(electionId);
        }
      }
      for (const id of ids) slateCounts.set(id, (slateCounts.get(id) ?? 0) + 1);
    }
    for (const [id, count] of slateCounts) {
      const existing = map.get(id);
      if (existing) existing.sources.slates = count;
      else
        map.set(id, { id, sources: { google: false, slates: count, drafts: 0 }, past: undefined });
    }

    // Drafts.
    const draftCounts = new Map<string, number>();
    for (const row of Object.values(draft.rows)) {
      if (!row.electionId) continue;
      draftCounts.set(row.electionId, (draftCounts.get(row.electionId) ?? 0) + 1);
    }
    for (const [id, count] of draftCounts) {
      const existing = map.get(id);
      if (existing) existing.sources.drafts = count;
      else
        map.set(id, { id, sources: { google: false, slates: 0, drafts: count }, past: undefined });
    }

    return [...map.values()];
  }, [electionsQuery.data, slates, draft.rows]);

  const visible = useMemo(() => {
    const filtered = showPast ? entries : entries.filter((e) => e.past !== true && e.id !== "2000");
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
  }, [entries, showPast]);

  const pastCount = entries.filter((e) => e.past === true || e.id === "2000").length;

  return (
    <section className="panel">
      <h2>Elections</h2>
      <p className="hint">
        Every election we know about — from Google's list, from imported slates' subject IDs, and
        from your local drafts. Picking one as <em>active</em> drives the Compose tab.
      </p>

      <div className="card">
        <label className="row">
          <input
            type="checkbox"
            checked={showPast}
            onChange={(e) => setShowPast(e.target.checked)}
          />
          <span>
            Show past + Test elections <span className="hint">({pastCount} hidden)</span>
          </span>
        </label>
      </div>

      {electionsQuery.isLoading && <p className="hint">Loading elections…</p>}
      {electionsQuery.error && (
        <p className="hint" title={electionsQuery.error.message}>
          Google elections list unavailable — {electionsQuery.error.message}
        </p>
      )}

      {visible.length === 0 ? (
        <div className="card">
          <p className="hint">No elections {showPast ? "found" : "upcoming"}.</p>
        </div>
      ) : (
        visible.map((entry) => (
          <ElectionCard
            key={entry.id}
            entry={entry}
            isActive={entry.id === activeElectionId}
            setActive={() => setActiveElectionId(entry.id)}
          />
        ))
      )}
    </section>
  );
}

function ElectionCard({
  entry,
  isActive,
  setActive,
}: {
  entry: ElectionEntry;
  isActive: boolean;
  setActive: () => void;
}) {
  const isTest = entry.id === "2000";
  return (
    <div className={`card election-card${entry.past ? " election-past" : ""}`}>
      <div className="card-title">
        <strong>{entry.name ?? `Election ${entry.id}`}</strong>
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
        {entry.sources.google
          ? "ballot data available"
          : "no ballot data (id only from your local data)"}
        {entry.sources.slates > 0 && ` · ${entry.sources.slates} imported slate(s)`}
        {entry.sources.drafts > 0 && ` · ${entry.sources.drafts} draft row(s)`}
      </p>
      <div className="row">
        {!isActive && (
          <button type="button" onClick={setActive}>
            Use as active
          </button>
        )}
        <Link to="/compose" className="link">
          Open in Compose →
        </Link>
      </div>
    </div>
  );
}
