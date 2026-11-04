import { useState } from "react";
import { useOutOfDate } from "../lib/freshness";
import type { RaceChange } from "../lib/raceChanges";
import { useRaceHistory } from "../lib/raceHistory";
import {
  type CandidateResult,
  type ContestResult,
  LIVE_REFRESH_MS,
  type MeasureResult,
  measurePasses,
} from "../lib/sosCa";
import { parseSosTime } from "../lib/sosResults";
import { RaceHistoryChart } from "./RaceHistoryChart";

/**
 * A race's count, as the Results page shows it: the reporting line (precincts,
 * Last checked, Source updated, This race changed), candidates' bars or a
 * measure's Yes/No against its threshold, and the race's history. Shared by
 * the Results page, My ballot and race pages, so a count reads the same everywhere.
 */

const PARTY_COLORS: Record<string, string> = {
  Dem: "var(--pole-left)",
  Rep: "var(--pole-right)",
  Grn: "#3f9a4a",
  Lib: "#d9a326",
  PF: "#9b4fb5",
  AI: "#8a6d3b",
};

function partyColor(party: string | undefined): string {
  return (party && PARTY_COLORS[party]) || "var(--pole-mid)";
}

const fmt = new Intl.NumberFormat("en-US");

const clockFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});
const dayFmt = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/** A moment as local time (with the day when it isn't today), UTC beside it, smaller. */
export function Clock({ at }: { at: number }) {
  const d = new Date(at);
  const today = new Date().toDateString() === d.toDateString();
  const utc = `${d.toISOString().slice(11, 16)}Z`;
  return (
    <time dateTime={d.toISOString()}>
      {today ? "" : `${dayFmt.format(d)}, `}
      {clockFmt.format(d)} <small className="live-utc">({utc})</small>
    </time>
  );
}

/** A race's count over time, logged in this browser, behind a button (charts are tall). */
export function RaceHistoryToggle({ id }: { id: string }) {
  const history = useRaceHistory(id);
  const [open, setOpen] = useState(false);
  if (!history || history.points.length === 0) return null;
  const n = history.points.length;
  return (
    <div className="race-history-toggle">
      <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "Hide history" : `History (${n} report${n === 1 ? "" : "s"} seen here)`}
      </button>
      {open && <RaceHistoryChart history={history} />}
    </div>
  );
}

/** The source's time for the report a result came in: a county's file time, the state's reporting time. */
export function sourceTimeOf(result: ContestResult): number | undefined {
  if (result.reporting.changedAt !== undefined) return result.reporting.changedAt;
  const sos = parseSosTime(result.reporting.time);
  return sos ? Date.parse(sos) : undefined;
}

/**
 * Precincts, then three times: when this page last checked, when the source
 * last published (its whole report: every race in it), and when this race's
 * own numbers last changed (`useRaceChange`).
 */
export function ReportingLine({
  result,
  checkedAt,
  change,
  fetching,
}: {
  result: ContestResult;
  checkedAt: number;
  change: RaceChange | undefined;
  /** A check is under way (the query is fetching). */
  fetching?: boolean;
}) {
  const { percent } = result.reporting;
  const lead = percent !== undefined ? `${percent}% of precincts` : result.reporting.text;
  const sourceAt = sourceTimeOf(result);
  const guessed = result.reporting.changedSeen;
  // Overdue for a check (the tab sat in the background, the phone slept, the
  // network dropped): say so, and the card dims its numbers (styles.css).
  const outOfDate = useOutOfDate(checkedAt, LIVE_REFRESH_MS);
  return (
    <span className="hint live-reporting">
      {outOfDate && (
        <span className="live-stale-note">
          {fetching ? "Getting the latest count…" : "May be out of date"}
        </span>
      )}
      {lead && <span className="live-precincts">{lead}</span>}
      {checkedAt > 0 && (
        <span className="live-time">
          Last checked: <Clock at={checkedAt} />
        </span>
      )}
      {sourceAt !== undefined && (
        <span className="live-time">
          Source updated: {guessed && "by "}
          <Clock at={sourceAt} />
          {guessed && " (the county gives no time)"}
        </span>
      )}
      {change && (
        <span className="live-time">
          This race changed: {guessed && "by "}
          <Clock at={change.at} />
          {!change.exact && " or earlier"}
        </span>
      )}
    </span>
  );
}

export function ResultBody({ result }: { result: ContestResult }) {
  if (result.kind === "candidates") {
    if (result.candidates.length === 0) return <p className="hint">No candidates listed.</p>;
    const total = result.candidates.reduce((s, c) => s + c.votes, 0);
    return (
      <ul className="live-candidates">
        {result.candidates.map((c) => (
          <CandidateRow key={c.name} c={c} counted={total > 0} />
        ))}
      </ul>
    );
  }
  if (result.kind === "measure") return <MeasureRow m={result.measure} />;
  return (
    <ul className="live-candidates">
      {result.measures.map((m) => (
        <li key={m.number}>
          <MeasureRow m={m} />
        </li>
      ))}
    </ul>
  );
}

function CandidateRow({ c, counted }: { c: CandidateResult; counted: boolean }) {
  return (
    <li className="live-candidate">
      <span className="live-name">
        {c.name}
        {c.party && <span className="tag-inline"> {c.party}</span>}
        {c.incumbent && <span className="hint"> · incumbent</span>}
      </span>
      <span className="live-bar" aria-hidden="true">
        <span
          className="live-bar-fill"
          style={{ width: `${counted ? c.percent : 0}%`, background: partyColor(c.party) }}
        />
      </span>
      <span className="live-num">
        {counted ? `${c.percent.toFixed(1)}%` : "–"}
        <span className="hint"> {fmt.format(c.votes)}</span>
      </span>
    </li>
  );
}

export function MeasureRow({ m }: { m: MeasureResult }) {
  const counted = m.yes + m.no > 0;
  const passing = counted && measurePasses(m);
  const needs = m.threshold === "2/3" ? "two-thirds" : m.threshold;
  return (
    <div className="live-measure">
      {m.name && <div className="hint live-measure-name">{m.name}</div>}
      <div className="live-yesno">
        <span className={counted ? (passing ? "ok" : "bad") : "hint"}>
          {counted ? (passing ? "Passing" : "Failing") : "No votes counted yet"}
          {needs && <span className="hint"> (needs {needs})</span>}
        </span>
        <span className="live-bar" aria-hidden="true">
          <span
            className="live-bar-fill"
            style={{ width: `${m.yesPercent}%`, background: "var(--ok)" }}
          />
          <span
            className="live-bar-fill"
            style={{ width: `${m.noPercent}%`, background: "var(--bad)" }}
          />
        </span>
        <span className="live-num">
          Yes {m.yesPercent.toFixed(1)}% · No {m.noPercent.toFixed(1)}%
          <span className="hint">
            {" "}
            {fmt.format(m.yes)} / {fmt.format(m.no)}
          </span>
        </span>
      </div>
    </div>
  );
}
