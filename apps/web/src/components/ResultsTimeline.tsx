import type { Race } from "@openslate/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { raceHistoryListQueryOptions, raceHistorySnapshotQueryOptions } from "../lib/results";

interface ResultsTimelineProps {
  raceId: string | number;
  hasMap: boolean;
}

// Build a direct URL to civicAPI's rendered SVG map for the race. Mirrors the
// upstream resolution in lib/results.ts so the env-var override flows through.
function mapUrl(raceId: string | number): string {
  const base = (
    (import.meta.env.VITE_RESULTS_BASE as string | undefined) ?? "https://civicapi.org/api/v2"
  ).replace(/\/+$/, "");
  return `${base}/race/${encodeURIComponent(String(raceId))}?generateMap`;
}

export function ResultsTimeline({ raceId, hasMap }: ResultsTimelineProps) {
  const list = useQuery(raceHistoryListQueryOptions(raceId));
  const timestamps = list.data ?? [];

  const [index, setIndex] = useState<number | null>(null);
  const [liveFollow, setLiveFollow] = useState(true);
  const [showMap, setShowMap] = useState(false);

  // When timestamps load (or grow during live polling), follow the head until
  // the user scrubs manually.
  useEffect(() => {
    if (timestamps.length === 0) {
      setIndex(null);
      return;
    }
    if (liveFollow) setIndex(timestamps.length - 1);
  }, [timestamps, liveFollow]);

  const currentTs = index !== null ? timestamps[index] : undefined;
  const snapshot = useQuery(raceHistorySnapshotQueryOptions(raceId, currentTs));

  const headline = useMemo(() => snapshotHeadline(snapshot.data ?? null), [snapshot.data]);

  if (list.isLoading) {
    return <p className="hint">Loading history…</p>;
  }
  if (list.error) {
    return (
      <p className="hint">
        History unavailable: {list.error instanceof Error ? list.error.message : "unknown error"}
      </p>
    );
  }
  if (timestamps.length === 0) {
    return (
      <p className="hint">
        No tracked history for this race. civicAPI only retains history for races first seen after
        2025-10-09.
      </p>
    );
  }

  return (
    <div className="timeline">
      <div className="timeline-controls">
        <strong>Timeline</strong>
        <span className="tag">{timestamps.length} snapshots</span>
        <label className="hint" style={{ flexDirection: "row", gap: "0.25rem" }}>
          <input
            type="checkbox"
            checked={liveFollow}
            onChange={(e) => setLiveFollow(e.target.checked)}
          />
          Live
        </label>
        {hasMap && (
          <button type="button" className="link" onClick={() => setShowMap((v) => !v)}>
            {showMap ? "Hide map" : "Show map"}
          </button>
        )}
      </div>

      <input
        className="timeline-scrubber"
        type="range"
        min={0}
        max={timestamps.length - 1}
        step={1}
        value={index ?? 0}
        onChange={(e) => {
          setLiveFollow(false);
          setIndex(Number(e.target.value));
        }}
        aria-label="History scrubber"
      />

      <p className="hint">
        {currentTs && <>Snapshot: {formatTimestamp(currentTs)}</>}
        {headline && <> · {headline}</>}
      </p>

      {showMap && hasMap && (
        <div className="timeline-map">
          {/* civicAPI returns a rendered SVG/PNG directly when generateMap is set.
              Using an <img> here avoids needing to inline arbitrary upstream
              SVG markup. The current map endpoint reflects the live result, not
              the scrubbed timestamp — civicAPI doesn't expose per-timestamp
              maps on the history endpoint. */}
          <img src={mapUrl(raceId)} alt={`Map of race ${raceId}`} loading="lazy" />
        </div>
      )}
    </div>
  );
}

function snapshotHeadline(race: Race | null): string | null {
  if (!race) return null;
  const reporting =
    race.percent_reporting !== undefined ? `${race.percent_reporting.toFixed(1)}% reporting` : null;
  const leader = race.candidates.slice().sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0))[0];
  const leaderLabel = leader ? `${leader.name} ${(leader.percent ?? 0).toFixed(1)}%` : null;
  return [reporting, leaderLabel].filter(Boolean).join(" · ");
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}
