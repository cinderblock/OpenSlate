import { verifySlate } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useBallotDraft } from "../lib/ballotDraft";
import { slatesCollection } from "../lib/collections";
import { formatElectionDate } from "../lib/dates";
import { localToday, useMyElection } from "../lib/myVote";
import { electionsQueryOptions } from "../lib/query";
import { Switch } from "./ui/Switch";

interface ElectionEntry {
  id: string;
  name?: string;
  electionDay?: string;
  ocdDivisionId?: string;
  sources: { google: boolean; slates: number; drafts: number };
  /** undefined = unknown date (no electionDay). */
  past: boolean | undefined;
}

const TODAY = localToday();

/** Draft rows are keyed by election date; older ones carried a Google election id. */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function ElectionsPanel() {
  const electionsQuery = useQuery(electionsQueryOptions());
  const { data: slates } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  const draft = useBallotDraft();
  const [myElection, setMyElection] = useMyElection();
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
    for (const [key, count] of draftCounts) {
      const existing = map.get(key) ?? [...map.values()].find((e) => e.electionDay === key);
      if (existing) existing.sources.drafts += count;
      else {
        const dated = DATE.test(key);
        map.set(key, {
          id: key,
          ...(dated ? { electionDay: key } : {}),
          sources: { google: false, slates: 0, drafts: count },
          past: dated ? key < TODAY : undefined,
        });
      }
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
        from your local drafts. Picking one as <em>active</em> sets the election My ballot and
        Compose show.
      </p>

      <div className="card">
        <Switch isSelected={showPast} onChange={setShowPast}>
          Show past + Test elections <span className="hint">({pastCount} hidden)</span>
        </Switch>
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
            isActive={entry.electionDay !== undefined && entry.electionDay === myElection}
            setActive={entry.electionDay ? () => setMyElection(entry.electionDay ?? "") : undefined}
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
  /** Absent when the election has no date to key My ballot by. */
  setActive?: () => void;
}) {
  const isTest = entry.id === "2000";
  return (
    <div className={`card election-card${entry.past ? " election-past" : ""}`}>
      <div className="card-title">
        <strong>
          {entry.name ??
            (entry.electionDay === entry.id
              ? formatElectionDate(entry.id)
              : `Election ${entry.id}`)}
        </strong>
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
        {!isActive && setActive && (
          <button type="button" onClick={setActive}>
            Use as active
          </button>
        )}
        <Link to="/publish" className="link">
          Open in Compose →
        </Link>
      </div>
    </div>
  );
}
