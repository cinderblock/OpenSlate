import type { Race } from "@openslate/core";
import { useMemo, useState } from "react";
import {
  type RegionSort,
  aggregateRegions,
  normalizeRegions,
  sortRegions,
} from "../lib/region-summary";

interface RegionBreakdownProps {
  race: Race;
}

const SORT_LABEL: Record<RegionSort, string> = {
  votes_desc: "Total votes",
  margin_asc: "Closest margin",
  margin_desc: "Widest margin",
  reporting_asc: "Least reporting",
  name_asc: "Name (A–Z)",
};

const DEFAULT_VISIBLE = 8;

export function RegionBreakdown({ race }: RegionBreakdownProps) {
  const regions = useMemo(() => normalizeRegions(race.region_results), [race.region_results]);
  const [sortBy, setSortBy] = useState<RegionSort>("votes_desc");
  const [expanded, setExpanded] = useState(false);

  const sorted = useMemo(() => sortRegions(regions, sortBy), [regions, sortBy]);
  const aggregate = useMemo(() => aggregateRegions(regions), [regions]);

  if (regions.length === 0) return null;

  const visible = expanded ? sorted : sorted.slice(0, DEFAULT_VISIBLE);
  const regionLabel = regions[0]?.type ?? "Region";

  return (
    <div className="region-breakdown">
      <div className="card-title">
        <strong>Per-{regionLabel.toLowerCase()} breakdown</strong>
        <span className="tag">
          {aggregate.totalRegions} {regionLabel.toLowerCase()}
          {aggregate.totalRegions === 1 ? "" : "s"}
        </span>
        {aggregate.fullyReporting < aggregate.totalRegions && (
          <span className="tag" title="Regions with percent_reporting === 100">
            {aggregate.fullyReporting} fully in
          </span>
        )}
        <label className="hint no-print" style={{ flexDirection: "row", gap: "0.25rem" }}>
          Sort
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as RegionSort)}>
            {(Object.keys(SORT_LABEL) as RegionSort[]).map((key) => (
              <option key={key} value={key}>
                {SORT_LABEL[key]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <LeaderTally aggregate={aggregate} />

      <table className="region-table">
        <thead>
          <tr>
            <th>{regionLabel}</th>
            <th className="num">Leader</th>
            <th className="num">Margin</th>
            <th className="num">Votes</th>
            <th className="num">Reporting</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((r) => (
            <tr key={r.slug}>
              <td>
                <span
                  className="result-swatch"
                  style={r.fill ? { background: r.fill } : undefined}
                  aria-hidden="true"
                />{" "}
                {r.name}
              </td>
              <td className="num">
                {r.leader?.name ?? "—"}
                {r.leader?.percent !== undefined && (
                  <span className="hint"> {r.leader.percent.toFixed(1)}%</span>
                )}
              </td>
              <td className="num">{Number.isNaN(r.margin) ? "—" : `${r.margin.toFixed(1)} pp`}</td>
              <td className="num">{r.totalVotes.toLocaleString()}</td>
              <td className="num">
                {r.percentReporting !== undefined ? `${r.percentReporting.toFixed(0)}%` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {sorted.length > DEFAULT_VISIBLE && (
        <button type="button" className="link no-print" onClick={() => setExpanded((v) => !v)}>
          {expanded
            ? `Show top ${DEFAULT_VISIBLE}`
            : `Show all ${sorted.length} ${regionLabel.toLowerCase()}s`}
        </button>
      )}
    </div>
  );
}

function LeaderTally({ aggregate }: { aggregate: ReturnType<typeof aggregateRegions> }) {
  const entries = [...aggregate.leaderTally.entries()].sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return null;
  return (
    <p className="hint">
      Leading in:{" "}
      {entries.map(([name, count], i) => (
        <span key={name}>
          {i > 0 && " · "}
          <strong>{name}</strong> {count}
        </span>
      ))}
    </p>
  );
}
