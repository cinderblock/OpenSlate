import {
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { STANCES, type Stance, type Subject } from "@openslate/core";
import { Link } from "@tanstack/react-router";
import type React from "react";
import { useState } from "react";
import { type DraftRow, effectiveOrder, rowIdFor } from "../lib/ballotDraft";
import type { BallotContest } from "../lib/query";
import { subjectKey } from "../lib/subjects";

const STANCE_LABEL: Record<Stance, string> = {
  endorse: "Endorse",
  oppose: "Oppose",
  lean_for: "Lean for",
  lean_against: "Lean against",
  neutral: "Neutral",
  abstain: "Abstain",
};

const PARTY_ABBREV: Record<string, string> = {
  Democratic: "DEM",
  Republican: "REP",
  Green: "GRN",
  Libertarian: "LIB",
  "Peace and Freedom": "P&F",
  "American Independent": "AI",
  "No Party Preference": "NPP",
  Nonpartisan: "NP",
  Independent: "IND",
};

function partyDisplay(raw: string): { short: string; full: string } {
  const dashMatch = raw.match(/^\s*(\S+)\s*[-–—]\s*(.+?)\s*$/);
  if (dashMatch?.[1] && dashMatch[2]) return { short: dashMatch[1], full: dashMatch[2] };
  const trimmed = raw.trim();
  const abbrev = PARTY_ABBREV[trimmed];
  return abbrev ? { short: abbrev, full: trimmed } : { short: trimmed, full: trimmed };
}

type PatchFn = (
  electionId: string,
  subject: Subject,
  choice: string | undefined,
  fields: { stance?: Stance; statement?: string; privateNote?: string },
) => void;

type RankFn = (electionId: string, subject: Subject, order: string[]) => void;

export function BallotComposer({
  contests,
  electionId,
  rows,
  patch,
  rankings,
  setRanking,
  isLoading,
  error,
  enabled,
}: {
  contests: BallotContest[];
  electionId: string;
  rows: Record<string, DraftRow>;
  patch: PatchFn;
  rankings: Record<string, string[]>;
  setRanking: RankFn;
  isLoading: boolean;
  error: Error | null;
  enabled: boolean;
}) {
  if (!enabled) {
    return (
      <p className="hint">
        Enter an address + pick an election above to load your ballot. (You can still add off-ballot
        positions below.)
      </p>
    );
  }
  if (!electionId) return <p className="hint">Pick an election above to load your ballot.</p>;
  if (isLoading) return <p className="hint">Loading ballot…</p>;
  if (error) {
    return (
      <p className="hint" title={error.message}>
        Ballot unavailable — {error.message}
      </p>
    );
  }
  if (contests.length === 0) {
    return (
      <p className="hint">
        No contests returned for this address + election. (You can still add off-ballot positions
        below.)
      </p>
    );
  }

  return (
    <div className="ballot">
      {contests.map((contest) => (
        <ContestCard
          key={contest.subject.id ?? contest.subject.title}
          contest={contest}
          electionId={electionId}
          rows={rows}
          patch={patch}
          rankings={rankings}
          setRanking={setRanking}
        />
      ))}
    </div>
  );
}

function ContestCard({
  contest,
  electionId,
  rows,
  patch,
  rankings,
  setRanking,
}: {
  contest: BallotContest;
  electionId: string;
  rows: Record<string, DraftRow>;
  patch: PatchFn;
  rankings: Record<string, string[]>;
  setRanking: RankFn;
}) {
  const { subject, candidates, voteFor } = contest;
  const subjectKeyVal = subjectKey(subject);
  const measureMode = candidates.length === 0;
  const defaultOrder = candidates.map((c) => c.name);
  const rankKey = `${electionId}|${subjectKeyVal}`;
  const order = effectiveOrder(rankings[rankKey], defaultOrder);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(String(active.id));
    const newIndex = order.indexOf(String(over.id));
    if (oldIndex >= 0 && newIndex >= 0) {
      setRanking(electionId, subject, arrayMove(order, oldIndex, newIndex));
    }
  }

  return (
    <div className="card">
      <div className="card-title">
        <Link to="/race/$key" params={{ key: subjectKeyVal }} className="race-link">
          <strong>{subject.title}</strong>
        </Link>
        {subject.kind && <span className="tag">{subject.kind}</span>}
      </div>
      <p className="hint">
        {subject.jurisdiction}
        {subject.jurisdiction && voteFor ? " · " : ""}
        {voteFor ? (voteFor === 1 ? "Vote for one" : `Vote for up to ${voteFor}`) : ""}
        {!measureMode && candidates.length > 1 && " · drag to rank by preference"}
      </p>

      {measureMode ? (
        <Row
          electionId={electionId}
          subject={subject}
          choice={undefined}
          label="Your stance"
          rows={rows}
          patch={patch}
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={order} strategy={verticalListSortingStrategy}>
            {order.map((name, index) => {
              const candidate = candidates.find((c) => c.name === name);
              const topN = voteFor !== undefined && index < voteFor;
              return (
                <SortableCandidateRow
                  key={name}
                  id={name}
                  rank={index + 1}
                  topN={topN}
                  electionId={electionId}
                  subject={subject}
                  choice={name}
                  label={candidate?.name ?? name}
                  party={candidate?.party}
                  rows={rows}
                  patch={patch}
                />
              );
            })}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function SortableCandidateRow(props: {
  id: string;
  rank: number;
  topN: boolean;
  electionId: string;
  subject: Subject;
  choice: string;
  label: string;
  party?: string;
  rows: Record<string, DraftRow>;
  patch: PatchFn;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.id,
  });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <Row
      electionId={props.electionId}
      subject={props.subject}
      choice={props.choice}
      label={props.label}
      party={props.party}
      rows={props.rows}
      patch={props.patch}
      rank={props.rank}
      topN={props.topN}
      setNodeRef={setNodeRef}
      style={style}
      dragHandleProps={{ ...attributes, ...listeners }}
    />
  );
}

function Row({
  electionId,
  subject,
  choice,
  label,
  party,
  rows,
  patch,
  rank,
  topN,
  setNodeRef,
  style,
  dragHandleProps,
}: {
  electionId: string;
  subject: Subject;
  choice: string | undefined;
  label: string;
  party?: string;
  rows: Record<string, DraftRow>;
  patch: PatchFn;
  rank?: number;
  topN?: boolean;
  setNodeRef?: (node: HTMLElement | null) => void;
  style?: React.CSSProperties;
  dragHandleProps?: React.HTMLAttributes<HTMLElement>;
}) {
  const id = rowIdFor(electionId, subject, choice);
  const row = rows[id];
  const [notesOpen, setNotesOpen] = useState(false);
  const hasNotes = Boolean(row?.statement || row?.privateNote);
  const showNotes = notesOpen || hasNotes;

  function setStance(stance: Stance) {
    patch(electionId, subject, choice, { stance: row?.stance === stance ? undefined : stance });
  }
  function setStatement(value: string) {
    patch(electionId, subject, choice, { statement: value });
  }
  function setPrivateNote(value: string) {
    patch(electionId, subject, choice, { privateNote: value });
  }

  const partyInfo = party ? partyDisplay(party) : null;
  const sortable = Boolean(dragHandleProps);

  return (
    <div
      ref={setNodeRef as React.Ref<HTMLDivElement>}
      style={style}
      className={`ballot-row${topN ? " top-n" : ""}${sortable ? " sortable" : ""}`}
    >
      <div className="ballot-row-main">
        {sortable ? (
          <span className="ballot-drag" {...dragHandleProps} title="drag to reorder">
            <span className="drag-grip" aria-hidden="true">
              ⋮⋮
            </span>
            <span className="ballot-rank">{rank}.</span>
          </span>
        ) : (
          <span className="ballot-drag-placeholder" />
        )}
        <span className="ballot-row-label">{label}</span>
        {partyInfo ? (
          <span className="ballot-row-party" title={partyInfo.full}>
            {partyInfo.short}
          </span>
        ) : (
          <span className="ballot-row-party" />
        )}
        <div className="stance-buttons">
          {STANCES.map((stance) => (
            <button
              key={stance}
              type="button"
              className={`stance-btn stance-${stance}${row?.stance === stance ? " active" : ""}`}
              onClick={() => setStance(stance)}
            >
              {STANCE_LABEL[stance]}
            </button>
          ))}
        </div>
        <select
          className={`stance-select stance-${row?.stance ?? "none"}${row?.stance ? " has-stance" : ""}`}
          value={row?.stance ?? ""}
          onChange={(e) =>
            patch(electionId, subject, choice, {
              stance: e.target.value ? (e.target.value as Stance) : undefined,
            })
          }
        >
          <option value="">— stance —</option>
          {STANCES.map((stance) => (
            <option key={stance} value={stance}>
              {STANCE_LABEL[stance]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="link"
          onClick={() => setNotesOpen((v) => !v)}
          aria-expanded={showNotes}
        >
          {showNotes ? "notes ▾" : "+ notes"}
        </button>
      </div>
      {showNotes && (
        <div className="ballot-row-notes">
          <label>
            <span className="hint">Public statement — becomes part of your signed slate</span>
            <textarea
              rows={2}
              value={row?.statement ?? ""}
              onChange={(e) => setStatement(e.target.value)}
            />
          </label>
          <label>
            <span className="hint">Private note — stays on your device, never shared</span>
            <textarea
              rows={2}
              value={row?.privateNote ?? ""}
              onChange={(e) => setPrivateNote(e.target.value)}
            />
          </label>
        </div>
      )}
    </div>
  );
}
