import type { Stance } from "@openslate/core";
import { ordinal } from "../lib/ballotView";
import type { RacePosition } from "../lib/collate";
import { EndorserAvatar } from "./EndorserAvatar";
import { LeanMeter } from "./LeanMeter";

export const STANCE_LABEL: Record<Stance, string> = {
  endorse: "Endorse",
  oppose: "Oppose",
  lean_for: "Lean for",
  lean_against: "Lean against",
  neutral: "Neutral",
  abstain: "Abstain",
};

/**
 * One source's position on a race page. With `everySlate`, most sources aren't
 * ones the voter has anything to do with, so what's marked is the ones they
 * follow, not the ones they don't.
 */
export function PositionRow({
  position,
  everySlate,
}: {
  position: RacePosition;
  everySlate?: boolean;
}) {
  return (
    <li>
      {/* The source's own words when it labels the position (SPEC §3.17). */}
      <span className={`stance stance-${position.stance}`}>
        {position.label ?? STANCE_LABEL[position.stance]}
        {position.rank !== undefined && `, ranked ${ordinal(position.rank)}`}
      </span>
      <EndorserAvatar sourceId={position.source.id} name={position.source.name} size="md" />
      <span className="position-subject">
        {position.source.uri ? (
          <a href={position.source.uri} target="_blank" rel="noreferrer">
            <strong>{position.source.name}</strong>
          </a>
        ) : (
          <strong>{position.source.name}</strong>
        )}
        {position.standing === "off" && !everySlate && (
          <span className="tag tag-inline">not followed, not on My ballot</span>
        )}
        {position.standing === "follow" && everySlate && (
          <span className="tag tag-inline">you follow</span>
        )}
        {position.times !== undefined && (
          <span className="tag tag-inline">you count this ×{position.times}</span>
        )}
        {position.standing === "disagree" && (
          <span className="tag tag-inline tag-disagree">
            you disagree: counts the other way on My ballot
          </span>
        )}
        {position.source.secondhand && (
          <span className="hint">
            {" "}
            · reported by {position.source.signerName ?? "a researcher"}, not signed by them
          </span>
        )}
        <LeanMeter sourceId={position.source.id} name={position.source.name} withWord />
        {!position.valid && <span className="warning"> (unverified)</span>}
        {position.written && <div className="hint">Named as “{position.written}”.</div>}
        {position.via && <div className="hint">Adopted from {position.via}.</div>}
        {position.labelDescription && (
          <div className="hint">
            {position.label}: {position.labelDescription}
          </div>
        )}
        {position.statement && (
          <blockquote className="statement hint">{position.statement}</blockquote>
        )}
      </span>
    </li>
  );
}
