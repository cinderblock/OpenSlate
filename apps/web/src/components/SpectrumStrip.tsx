import { useEffect, useMemo, useRef, useState } from "react";
import {
  type EndorserLean,
  leanScore,
  leanWord,
  stackMarkers,
  useEndorserLookup,
} from "../lib/endorsers";
import type { Source } from "../lib/sources";
import { EndorserAvatar } from "./EndorserAvatar";
import { LeanDetail } from "./LeanMeter";
import { InfoPopover } from "./ui/InfoPopover";

/** Marker diameter plus the 2px ring, in px; markers closer than this stack. */
const MARKER = 34;

interface Placed {
  source: Source;
  lean: EndorserLean;
  score: number;
  /** 0 … 1 across the axis. */
  x: number;
  row: number;
}

/**
 * Your sources laid out between the Democratic and Republican sides, each at
 * the share of its partisan picks that went each way. Tap a logo for the counts.
 */
export function SpectrumStrip({ sources }: { sources: Source[] }) {
  const endorserOf = useEndorserLookup();
  const plotRef = useRef<HTMLFieldSetElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const plot = plotRef.current;
    if (!plot) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? 0));
    observer.observe(plot);
    return () => observer.disconnect();
  }, []);

  const { placed, unplaced } = useMemo(() => {
    const scored: Array<Omit<Placed, "row">> = [];
    const unplaced: Source[] = [];
    for (const source of sources) {
      const lean = endorserOf(source.id).lean;
      const score = leanScore(lean);
      if (lean && score !== undefined) scored.push({ source, lean, score, x: (score + 1) / 2 });
      else unplaced.push(source);
    }
    // Keep markers inside the track: the outermost ones sit flush with its ends.
    const inset = width > 0 ? MARKER / 2 / width : 0;
    const clamped = scored.map((s) => ({ ...s, x: inset + s.x * (1 - 2 * inset) }));
    return { placed: stackMarkers(clamped, MARKER, width), unplaced };
  }, [sources, endorserOf, width]);

  const rows = placed.reduce((max, p) => Math.max(max, p.row + 1), 1);

  return (
    <div className="spectrum">
      <fieldset
        ref={plotRef}
        className="spectrum-plot"
        style={{ height: `${rows * MARKER + 18}px` }}
        aria-label="Your sources from the Democratic side to the Republican side"
      >
        <span className="spectrum-axis" aria-hidden="true" />
        <span className="spectrum-mid" aria-hidden="true" />
        {placed.map((p) => (
          <span
            key={p.source.id}
            className="spectrum-marker"
            style={{ left: `${p.x * 100}%`, bottom: `${18 + p.row * MARKER}px` }}
          >
            <InfoPopover
              label={`${p.source.name}: ${leanWord(p.score)}`}
              trigger={<EndorserAvatar sourceId={p.source.id} name={p.source.name} size="md" />}
            >
              <div className="spectrum-detail-name">
                <EndorserAvatar sourceId={p.source.id} name={p.source.name} size="md" />
                <strong>{p.source.name}</strong>
              </div>
              <LeanDetail name={p.source.name} lean={p.lean} />
            </InfoPopover>
          </span>
        ))}
      </fieldset>
      <div className="spectrum-labels" aria-hidden="true">
        <span className="lean-word-left">Democratic side</span>
        <span>Mixed</span>
        <span className="lean-word-right">Republican side</span>
      </div>
      {placed.length === 0 && (
        <p className="hint">
          None of these sources has taken enough sides between the parties to place yet.
        </p>
      )}
      {unplaced.length > 0 && placed.length > 0 && (
        <p className="hint">
          Too few partisan picks to place: {unplaced.map((s) => s.name).join(", ")}.
        </p>
      )}
    </div>
  );
}
