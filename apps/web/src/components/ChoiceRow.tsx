import type { Stance } from "@openslate/core";
import { CircleHelp, type LucideIcon, ThumbsDown, X } from "lucide-react";
import type { ReactNode } from "react";
import { choiceRowClass, designation, isYesNo, ordinal } from "../lib/ballotView";
import { type ChoiceGroup, positionTone, type Race } from "../lib/collate";
import { ChoiceBallotTags } from "./BallotTags";
import { EndorserAvatar } from "./EndorserAvatar";
import { LeanSummary } from "./LeanMeter";
import { InfoPopover } from "./ui/InfoPopover";

/**
 * The user's own marks besides a pick (the bubble). Private: kept in this
 * browser, only shared if they publish.
 */
const OTHER_MARKS: Array<{ stance: Stance; label: string; icon: LucideIcon }> = [
  { stance: "lean_for", label: "Maybe", icon: CircleHelp },
  { stance: "oppose", label: "Against", icon: X },
];

const STANCE_WORD: Record<Stance, string> = {
  endorse: "endorses",
  oppose: "opposes",
  lean_for: "leans for",
  lean_against: "leans against",
  neutral: "is neutral on",
  abstain: "abstains on",
};

/** How a mark other than a pick reads beside the name. */
const MARK_LABEL: Record<Stance, string> = {
  endorse: "my pick",
  lean_for: "maybe",
  lean_against: "leaning against",
  oppose: "against",
  neutral: "neutral",
  abstain: "abstain",
};

export interface ChoiceRowProps {
  group: ChoiceGroup;
  race: Race;
  /** The user's mark on this choice. */
  stance: Stance | undefined;
  /** The bubble: mark it as a pick, or unmark it. */
  onPick: () => void;
  /** Maybe or Against. */
  onMark: (stance: Stance) => void;
  /** The number key that picks this choice (focus mode). */
  shortcut?: number;
  /** Where the user ranks it, 1 being their first choice (lib/ranking.ts). */
  rank?: number;
  /** Ranked, but past what the ballot marks: a backup, not on the ballot. */
  backup?: boolean;
  /** The drag handle, in a ranked list. */
  handle?: ReactNode;
}

/** A choice as an item of a plain list (yes/no questions, a race-wide stance). */
export function ChoiceRow(props: ChoiceRowProps) {
  return (
    <li className={choiceRowClass(props.stance, props.backup)}>
      <ChoiceRowContent {...props} />
    </li>
  );
}

/**
 * One choice as the ballot shows it: the bubble, how many followed sources
 * back it, the name with what the ballot prints beside it, the sources, and
 * the user's other marks. The row element is the caller's.
 */
export function ChoiceRowContent({
  group,
  race,
  stance,
  onPick,
  onMark,
  shortcut,
  rank,
  backup,
  handle,
}: ChoiceRowProps) {
  const label = group.choice || "Overall";
  const yesNo = isYesNo(race);
  const note = designation(group);
  const followed = group.positions.filter((p) => p.standing !== "off");
  const others = group.positions.filter((p) => p.standing === "off");
  // A ranked name's own mark is its place; maybe and against are for the rest.
  const tag = rank === undefined && stance && stance !== "endorse" ? MARK_LABEL[stance] : undefined;
  return (
    <>
      {handle}
      {rank !== undefined && (
        <span className="rank-number" aria-hidden="true">
          {rank}
        </span>
      )}
      <button
        type="button"
        className={`bubble bubble-${backup ? "none" : (stance ?? "none")}`}
        aria-pressed={stance === "endorse"}
        aria-keyshortcuts={shortcut === undefined ? undefined : `${shortcut}`}
        onClick={onPick}
      >
        <span className="sr-only">
          My pick: {label}
          {rank !== undefined &&
            `, ranked ${rank}${backup ? ", a backup not marked on the ballot" : ""}`}
        </span>
      </button>
      <span className={`endorse-count${group.support === 0 ? " zero" : ""}`}>
        {group.support}
        <span className="sr-only"> of your sources for</span>
        <span aria-hidden="true">✓</span>
        {group.opposition > 0 && (
          <span className="against">
            {" "}
            {group.opposition}
            <span className="sr-only"> against</span>
            <span aria-hidden="true">✗</span>
          </span>
        )}
      </span>
      <div className="choice-main">
        <div className="choice-name">
          {shortcut !== undefined && <kbd className="choice-key">{shortcut}</kbd>}
          {group.choice || <em>Overall</em>}
          {tag && <span className={`tag tag-inline mark-${stance}`}>{tag}</span>}
          {note && <span className="ballot-note hint">{note}</span>}
          <ChoiceBallotTags group={group} race={race} />
        </div>
        {(followed.length > 0 || others.length > 0) && (
          <div className="source-chips">
            {followed.map((position) => {
              // `named`: listed on the other side of a two-way race from the
              // one the source named (Settings → My ballot).
              const what = `${position.source.name} ${STANCE_WORD[position.stance]} ${position.named ?? (group.choice || race.subject.title)}${position.rank ? `, ranked ${ordinal(position.rank)}` : ""}`;
              // Coloured and marked by how it counts for you: a source you
              // disagree with counts the other way. ✗ = counts against.
              const counted = positionTone(position);
              const leaning = position.stance === "lean_for" || position.stance === "lean_against";
              const disagree = position.standing === "disagree";
              const countsAs = `you disagree with ${position.source.name}, so this counts ${counted === "for" ? "for" : "against"} ${group.choice || race.subject.title}`;
              return (
                <InfoPopover
                  key={`${position.source.id}|${position.named ?? ""}`}
                  className={`source-chip tone-${counted}${disagree ? " disagreed" : ""}`}
                  bare={false}
                  label={disagree && counted !== "neutral" ? `${what}; ${countsAs}` : what}
                  trigger={
                    <>
                      <EndorserAvatar sourceId={position.source.id} name={position.source.name} />
                      {disagree && <ThumbsDown className="icon" aria-hidden="true" />}
                      {counted === "against" && "✗ "}
                      {counted === "for" && leaning && "~ "}
                      <span>
                        {position.source.name}
                        {position.named && (
                          <span className="chip-named"> (said {position.named})</span>
                        )}
                      </span>
                      {position.rank !== undefined && (
                        <span className="chip-rank">{ordinal(position.rank)}</span>
                      )}
                      {!position.valid && " ⚠"}
                    </>
                  }
                >
                  <div className="chip-detail-head">
                    <EndorserAvatar
                      sourceId={position.source.id}
                      name={position.source.name}
                      size="md"
                    />
                    <strong>{what}</strong>
                  </div>
                  {disagree && counted !== "neutral" && (
                    <p className="hint">
                      <ThumbsDown className="icon" aria-hidden="true" />{" "}
                      {countsAs.charAt(0).toUpperCase() + countsAs.slice(1)}.
                    </p>
                  )}
                  {position.statement && <p>“{position.statement}”</p>}
                  {position.written && (
                    <p className="hint">
                      Named as “{position.written}”; the ballot spells it as above.
                    </p>
                  )}
                  {position.source.secondhand && (
                    <p className="hint">
                      Reported by {position.source.signerName ?? "a researcher"}, not signed by{" "}
                      {position.source.name}.
                    </p>
                  )}
                  {!position.valid && <p className="warning">The signature did not verify.</p>}
                  <LeanSummary sourceId={position.source.id} />
                </InfoPopover>
              );
            })}
            {others.length > 0 && (
              // Sources you don't follow are summarised, not shown: comparing
              // isn't trusting. The race page lists them all.
              <InfoPopover
                className="source-chip tone-neutral unfollowed"
                bare={false}
                label={`${others.length} sources you don't follow`}
                trigger={
                  <>
                    +{others.length} {followed.length > 0 ? "more " : ""}you don't follow
                  </>
                }
              >
                <ul className="chip-detail-list">
                  {others.map((p) => (
                    <li key={p.source.id}>
                      <EndorserAvatar sourceId={p.source.id} name={p.source.name} />
                      {p.source.name} {STANCE_WORD[p.stance]} {group.choice || race.subject.title}
                    </li>
                  ))}
                </ul>
                <p className="hint">Not followed, so they don't count here.</p>
              </InfoPopover>
            )}
          </div>
        )}
      </div>
      <fieldset className="pick-buttons no-print">
        <legend className="sr-only">Other marks: {label}</legend>
        {/* On a yes/no question, "against Yes" is just No: the bubbles say it. */}
        {OTHER_MARKS.filter((m) => !(yesNo && m.stance === "oppose")).map((m) => {
          // A ranked name's mark is its place, not a maybe.
          const active = rank === undefined && stance === m.stance;
          const MarkIcon = m.icon;
          return (
            <button
              key={m.stance}
              type="button"
              className={`stance-btn stance-${m.stance}${active ? " active" : ""}`}
              aria-pressed={active}
              aria-keyshortcuts={
                shortcut !== undefined && m.stance === "oppose" ? `Shift+${shortcut}` : undefined
              }
              onClick={() => onMark(m.stance)}
            >
              <MarkIcon className="icon" /> {m.label}
            </button>
          );
        })}
      </fieldset>
    </>
  );
}
