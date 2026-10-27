import { LEAN_MIN_EVIDENCE } from "@openslate/core";
import { type EndorserLean, leanScore, leanWord, useEndorser } from "../lib/endorsers";
import { cx } from "./ui/cx";
import { InfoPopover } from "./ui/InfoPopover";

/** What a lean is counted from, and the counts, for the tap-to-expand detail. */
export function LeanDetail({ name, lean }: { name: string; lean: EndorserLean | undefined }) {
  const score = leanScore(lean);
  const total = (lean?.left ?? 0) + (lean?.right ?? 0);
  return (
    <div className="lean-detail">
      <strong>{score === undefined ? "Not enough to place" : leanWord(score)}</strong>
      {score !== undefined && <LeanTrack score={score} />}
      {lean && total > 0 ? (
        <p>
          {name} took the <span className="lean-word-left">Democratic</span> side {lean.left}{" "}
          {lean.left === 1 ? "time" : "times"} and the{" "}
          <span className="lean-word-right">Republican</span> side {lean.right}{" "}
          {lean.right === 1 ? "time" : "times"}
          {score === undefined && ` — fewer than ${LEAN_MIN_EVIDENCE}, too few to place them`}.
        </p>
      ) : (
        <p>{name} hasn't taken a side anywhere the two parties split.</p>
      )}
      <p className="hint">
        Counted only where the parties split: races between a Democrat and a Republican, and races
        and measures where the two parties' endorsements disagree.{" "}
        {lean?.via === "local"
          ? "Worked out from the ballot data you imported."
          : "Worked out by the public catalog from every party slate it has."}{" "}
        It's arithmetic on their picks, not a rating by OpenSlate.
      </p>
    </div>
  );
}

/**
 * The meter and its word, not interactive: for a popover about something else,
 * or inside a control that's already a button or a checkbox.
 */
export function LeanSummary({
  sourceId,
  lean: given,
}: {
  sourceId: string;
  /** Counts to show instead of the directory's. */
  lean?: EndorserLean;
}) {
  const known = useEndorser(sourceId).lean;
  const score = leanScore(given ?? known);
  if (score === undefined) return null;
  return (
    <span className="lean-summary">
      <LeanTrack score={score} /> {leanWord(score)}
    </span>
  );
}

/** The bare axis: Democratic side left, Republican side right, a marker at `score`. */
export function LeanTrack({ score, className }: { score: number; className?: string }) {
  // -1 … 1 → 0% … 100%.
  const at = ((score + 1) / 2) * 100;
  return (
    <span className={cx("lean-track", className)} aria-hidden="true">
      <span className="lean-marker" style={{ left: `${at}%` }} />
    </span>
  );
}

/**
 * A small left-right meter for one endorser that opens its detail on tap.
 * Renders nothing when there's no evidence at all, and an empty dashed track
 * below the minimum.
 */
export function LeanMeter({
  sourceId,
  name,
  withWord = false,
  lean: given,
}: {
  sourceId: string;
  name: string;
  /** Say it in words beside the meter too. */
  withWord?: boolean;
  /** Counts to show instead of the directory's (a catalog row from another catalog). */
  lean?: EndorserLean;
}) {
  const known = useEndorser(sourceId).lean;
  const lean = given ?? known;
  if (!lean) return null;
  const score = leanScore(lean);
  const word = score === undefined ? "Too few partisan picks" : leanWord(score);
  return (
    <InfoPopover
      label={`Left-right placement for ${name}: ${word}`}
      className="lean-meter"
      trigger={
        <>
          {score === undefined ? (
            <span className="lean-track lean-unknown" aria-hidden="true" />
          ) : (
            <LeanTrack score={score} />
          )}
          {withWord && <span className="lean-meter-word">{word}</span>}
        </>
      }
    >
      <LeanDetail name={name} lean={lean} />
    </InfoPopover>
  );
}
