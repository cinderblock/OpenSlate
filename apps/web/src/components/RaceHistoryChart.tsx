import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RaceHistory } from "../lib/raceHistory";

/**
 * A race's count over time, as this browser logged it (lib/raceHistory.ts):
 * votes per choice, and separately the share of precincts reporting (two
 * scales, so two charts, never two axes on one). Every value is also in the
 * readout (the selected report; the latest by default) and the table, so the
 * pointer and keyboard only choose which report the readout shows.
 */

const VOTES_H = 150;
const PCT_H = 64;
const PAD = { top: 10, bottom: 22, left: 44 };
/** Room at the right for a line's name, when it fits. */
const LABEL_W = 96;

const count = new Intl.NumberFormat("en-US");
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });
const timeFmt = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });
const dayTimeFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});
const zoneFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

/** A series' color: Yes / No keep blue / orange; candidates take the palette in the order first seen. */
export function seriesColor(names: readonly string[], i: number): string {
  const yesNo = names.length === 2 && names[0] === "Yes" && names[1] === "No";
  if (yesNo) return i === 0 ? "var(--series-1)" : "var(--series-2)";
  // Past eight, one recessive gray: the legend and table still name each one.
  return i < 8 ? `var(--series-${i + 1})` : "var(--muted)";
}

/** Round ticks from 0 to past `max`: 0 / 1,000 / 2,000, or 0 / 10K / 20K. */
export function niceTicks(max: number, count = 3): number[] {
  if (max <= 0) return [0];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(v);
  return out;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function sameDay(a: number, b: number): boolean {
  return new Date(a).toDateString() === new Date(b).toDateString();
}

export function RaceHistoryChart({ history }: { history: RaceHistory }) {
  const { names, points } = history;
  const [ref, width] = useWidth<HTMLDivElement>();
  const [picked, setPicked] = useState<number | null>(null);
  const index = picked ?? points.length - 1;
  // A new report moves the readout to it, unless the reader picked one.
  const lastCount = useRef(points.length);
  useEffect(() => {
    if (points.length !== lastCount.current) setPicked(null);
    lastCount.current = points.length;
  }, [points.length]);

  const first = points[0];
  const last = points.at(-1);
  if (!first || !last) return null;
  const point = points[index] ?? last;
  const oneDay = sameDay(first.at, last.at);
  const tick = (at: number) => (oneDay ? timeFmt : dayTimeFmt).format(at);

  const showLabels = names.length <= 4 && width >= 300;
  const right = showLabels ? LABEL_W : 12;
  const plotW = Math.max(0, width - PAD.left - right);
  const span = last.at - first.at;
  const x = (at: number) => PAD.left + (span > 0 ? ((at - first.at) / span) * plotW : plotW / 2);

  const maxVotes = Math.max(0, ...points.flatMap((p) => p.v));
  const vTicks = niceTicks(maxVotes);
  const vTop = vTicks.at(-1) || 1;
  const vInner = VOTES_H - PAD.top - PAD.bottom;
  const yVotes = (v: number) => PAD.top + vInner - (v / vTop) * vInner;
  const fmtTick = (v: number) => (vTop >= 10_000 ? compact.format(v) : count.format(v));

  const hasPct = points.some((p) => p.p !== undefined);
  const pInner = PCT_H - PAD.top - PAD.bottom;
  const yPct = (p: number) => PAD.top + pInner - (p / 100) * pInner;

  const nearest = (clientX: number, svg: SVGSVGElement) => {
    const box = svg.getBoundingClientRect();
    const px = clientX - box.left;
    let best = 0;
    for (let i = 1; i < points.length; i++) {
      const pt = points[i];
      const bestPt = points[best];
      if (pt && bestPt && Math.abs(x(pt.at) - px) < Math.abs(x(bestPt.at) - px)) best = i;
    }
    setPicked(best);
  };
  const latest = index === points.length - 1;

  // End labels, nudged apart so close lines don't print over each other.
  const ends = names
    .map((name, i) => ({ name, i, y: yVotes(last.v[i] ?? 0) }))
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) {
    const prev = ends[k - 1];
    const cur = ends[k];
    if (prev && cur && cur.y - prev.y < 13) cur.y = prev.y + 13;
  }
  const crossX = x(point.at);
  const total = point.v.reduce((s, n) => s + n, 0);
  const fewPoints = points.length < 2;

  return (
    <div className="race-history" ref={ref}>
      <ul className="race-history-legend" aria-label="Lines">
        {names.map((name, i) => (
          <li key={name}>
            <span className="race-history-key" style={{ background: seriesColor(names, i) }} />
            {name}
          </li>
        ))}
      </ul>

      {!fewPoints && (
        <p className="race-history-step">
          <button
            type="button"
            className="link"
            disabled={index === 0}
            onClick={() => setPicked(Math.max(0, index - 1))}
          >
            ‹ Earlier report
          </button>
          <span className="hint">
            {latest ? "Latest report" : `Report ${index + 1} of ${points.length}`}
          </span>
          <button
            type="button"
            className="link"
            disabled={latest}
            onClick={() =>
              index + 1 >= points.length - 1 ? setPicked(null) : setPicked(index + 1)
            }
          >
            Later report ›
          </button>
        </p>
      )}
      <p className="race-history-readout" aria-live="polite">
        <time dateTime={new Date(point.at).toISOString()}>
          {zoneFmt.format(point.at)}{" "}
          <small className="live-utc">({new Date(point.at).toISOString().slice(11, 16)}Z)</small>
        </time>
        {names.map((name, i) => {
          const v = point.v[i] ?? 0;
          return (
            <span key={name} className="race-history-value">
              <span className="race-history-key" style={{ background: seriesColor(names, i) }} />
              <strong>{count.format(v)}</strong>
              {total > 0 && ` (${((v / total) * 100).toFixed(1)}%)`} {name}
            </span>
          );
        })}
        {point.p !== undefined && (
          <span className="race-history-value">
            <strong>{point.p}%</strong> of precincts
          </span>
        )}
      </p>

      {fewPoints && (
        <p className="hint">
          One report so far. The lines start once this race's count moves again.
        </p>
      )}

      {width > 0 && !fewPoints && (
        <>
          <svg
            className="race-history-chart"
            width={width}
            height={VOTES_H}
            role="img"
            aria-label={`Votes over time, ${points.length} reports.`}
            onPointerMove={(e) => nearest(e.clientX, e.currentTarget)}
            onPointerDown={(e) => nearest(e.clientX, e.currentTarget)}
          >
            {vTicks.map((t) => (
              <g key={t}>
                <line
                  className="race-history-grid"
                  x1={PAD.left}
                  x2={PAD.left + plotW}
                  y1={yVotes(t)}
                  y2={yVotes(t)}
                />
                <text
                  className="race-history-tick"
                  x={PAD.left - 6}
                  y={yVotes(t) + 4}
                  textAnchor="end"
                >
                  {fmtTick(t)}
                </text>
              </g>
            ))}
            <text className="race-history-tick" x={PAD.left} y={VOTES_H - 6}>
              {tick(first.at)}
            </text>
            <text
              className="race-history-tick"
              x={PAD.left + plotW}
              y={VOTES_H - 6}
              textAnchor="end"
            >
              {tick(last.at)}
            </text>
            <line
              className="race-history-cross"
              x1={crossX}
              x2={crossX}
              y1={PAD.top}
              y2={VOTES_H - PAD.bottom}
            />
            {names.map((name, i) => (
              <polyline
                key={name}
                className="race-history-line"
                stroke={seriesColor(names, i)}
                points={points.map((p) => `${x(p.at)},${yVotes(p.v[i] ?? 0)}`).join(" ")}
              />
            ))}
            {names.map((name, i) => (
              <circle
                key={name}
                className="race-history-dot"
                cx={crossX}
                cy={yVotes(point.v[i] ?? 0)}
                r={4}
                fill={seriesColor(names, i)}
              />
            ))}
            {showLabels &&
              ends.map((e) => (
                <text
                  key={e.name}
                  className="race-history-label"
                  x={PAD.left + plotW + 6}
                  y={e.y + 4}
                >
                  {e.name.length > 13 ? `${e.name.slice(0, 12)}…` : e.name}
                </text>
              ))}
          </svg>

          {hasPct && (
            <svg
              className="race-history-chart"
              width={width}
              height={PCT_H}
              role="img"
              aria-label="Share of precincts reporting over time"
              onPointerMove={(e) => nearest(e.clientX, e.currentTarget)}
              onPointerDown={(e) => nearest(e.clientX, e.currentTarget)}
            >
              {[0, 100].map((t) => (
                <g key={t}>
                  <line
                    className="race-history-grid"
                    x1={PAD.left}
                    x2={PAD.left + plotW}
                    y1={yPct(t)}
                    y2={yPct(t)}
                  />
                  <text
                    className="race-history-tick"
                    x={PAD.left - 6}
                    y={yPct(t) + 4}
                    textAnchor="end"
                  >
                    {t}%
                  </text>
                </g>
              ))}
              <text className="race-history-tick" x={PAD.left} y={PCT_H - 6}>
                Precincts reporting
              </text>
              <line
                className="race-history-cross"
                x1={crossX}
                x2={crossX}
                y1={PAD.top}
                y2={PCT_H - PAD.bottom}
              />
              <polyline
                className="race-history-line"
                stroke="var(--series-1)"
                points={points
                  .filter((p) => p.p !== undefined)
                  .map((p) => `${x(p.at)},${yPct(p.p ?? 0)}`)
                  .join(" ")}
              />
              {point.p !== undefined && (
                <circle
                  className="race-history-dot"
                  cx={crossX}
                  cy={yPct(point.p)}
                  r={4}
                  fill="var(--series-1)"
                />
              )}
            </svg>
          )}
        </>
      )}

      <details className="race-history-table">
        <summary>Table of all {points.length} reports</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th scope="col">Report</th>
                {names.map((n) => (
                  <th key={n} scope="col">
                    {n}
                  </th>
                ))}
                {hasPct && <th scope="col">Precincts</th>}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.at}>
                  <th scope="row">{(oneDay ? zoneFmt : dayTimeFmt).format(p.at)}</th>
                  {names.map((n, i) => (
                    <td key={n}>{count.format(p.v[i] ?? 0)}</td>
                  ))}
                  {hasPct && <td>{p.p !== undefined ? `${p.p}%` : "–"}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
