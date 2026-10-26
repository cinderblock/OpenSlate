import type { Stance } from "@openslate/core";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { type DraftRow, rowIdFor, type useBallotDraft } from "../lib/ballotDraft";
import type { Race } from "../lib/collate";
import type { Standing } from "../lib/sources";
import {
  type FillEdit,
  partiesOn,
  partyFill,
  partyPlural,
  sourceFill,
  sourcesOn,
} from "../lib/triage";
import { track } from "../lib/usage";
import { ComboBox } from "./ui/Select";

type Draft = ReturnType<typeof useBallotDraft>;

/** The last fill, so it can be undone. */
interface Applied {
  message: string;
  /** Rows as they were before, by id (`undefined` = there was none). */
  previous: Record<string, DraftRow | undefined>;
  /** The stance the fill set on each row, so undo leaves later edits alone. */
  set: Record<string, Stance>;
}

const DID: Array<[Stance, string]> = [
  ["endorse", "picked"],
  ["lean_for", "marked Maybe"],
  ["oppose", "marked Against"],
];

const STANDING_NOTE: Record<Standing, string> = {
  follow: "",
  disagree: " · you disagree",
  off: " · not followed",
};

function describeFill(edits: FillEdit[]): string {
  const parts = DID.map(([stance, verb]) => {
    const n = edits.filter((e) => e.stance === stance).length;
    return n > 0 ? `${n} ${verb}` : "";
  }).filter(Boolean);
  const raceCount = new Set(edits.map((e) => e.raceKey)).size;
  return `${parts.join(", ")} in ${raceCount} race${raceCount === 1 ? "" : "s"}.`;
}

/**
 * Decide many races at once: every candidate of a party, or everything one
 * source recommends (or the opposite). Fills only what you haven't marked, and
 * the last fill can be undone. The card shows when `open`; the undo notice
 * stays either way.
 */
export function QuickFill({
  open,
  onClose,
  races,
  election,
  draft,
}: {
  open: boolean;
  onClose: () => void;
  /** The races the ballot lists (election + area), whatever the status filter. */
  races: Race[];
  election: string;
  draft: Draft;
}) {
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [nothing, setNothing] = useState(false);

  const parties = useMemo(() => partiesOn(races), [races]);
  const sources = useMemo(() => sourcesOn(races), [races]);
  const source = sources.find((s) => s.id === sourceId);

  function apply(edits: FillEdit[], by: "party" | "source") {
    track({ name: "ballot.quick_fill", dims: { by } });
    if (edits.length === 0) {
      setApplied(null);
      setNothing(true);
      return;
    }
    const previous: Applied["previous"] = {};
    const set: Applied["set"] = {};
    for (const e of edits) {
      const id = rowIdFor(election, e.subject, e.choice);
      previous[id] = draft.rows[id];
      set[id] = e.stance;
    }
    draft.patchMany(
      election,
      edits.map((e) => ({ subject: e.subject, choice: e.choice, fields: { stance: e.stance } })),
    );
    setNothing(false);
    setApplied({ message: describeFill(edits), previous, set });
  }

  function undo() {
    if (!applied) return;
    const previous = Object.fromEntries(
      Object.entries(applied.previous).filter(([id]) => draft.rows[id]?.stance === applied.set[id]),
    );
    draft.restore(previous);
    setApplied(null);
  }

  // Always mounted, so screen readers announce what a fill did.
  const notice = (
    <output className="quick-fill-notice no-print">
      {(applied || nothing) && (
        <>
          {applied ? (
            <>
              {applied.message}{" "}
              <button type="button" className="link" onClick={undo}>
                Undo
              </button>
            </>
          ) : (
            "Nothing to fill: everything it would mark is already marked."
          )}{" "}
          <button
            type="button"
            className="link"
            onClick={() => {
              setApplied(null);
              setNothing(false);
            }}
          >
            dismiss
          </button>
        </>
      )}
    </output>
  );

  return (
    <>
      {open && (
        <div className="card quick-fill no-print">
          <div className="card-title">
            <strong>Quick fill</strong>
            <span className="grow" />
            <button type="button" className="link" onClick={onClose}>
              close
            </button>
          </div>
          <p className="hint">
            Mark many races at once. Only fills choices you haven't marked yet, never adds a second
            pick to a race, and can be undone.
          </p>

          <h4>By party</h4>
          {parties.length === 0 ? (
            <p className="hint">
              Party comes from the official candidate list, and none is imported for these races.
              Add your Secretary of State's list in <Link to="/sources">Sources</Link>.
            </p>
          ) : (
            <ul className="quick-fill-parties">
              {parties.map(({ party, candidates }) => (
                <li key={party}>
                  <span className="quick-fill-party">
                    {partyPlural(party)} <span className="hint">· {candidates}</span>
                  </span>
                  <button
                    type="button"
                    title={`Pick each race's ${party} candidate. Where there are several, mark them Maybe.`}
                    onClick={() =>
                      apply(partyFill(races, draft.rows, election, party, "pick"), "party")
                    }
                  >
                    Pick all
                  </button>
                  <button
                    type="button"
                    title={`Mark every ${party} candidate Against`}
                    onClick={() =>
                      apply(partyFill(races, draft.rows, election, party, "against"), "party")
                    }
                  >
                    Against all
                  </button>
                </li>
              ))}
            </ul>
          )}

          <h4>By source</h4>
          {sources.length === 0 ? (
            <p className="hint">
              No source has recommendations for these races. Add one in{" "}
              <Link to="/sources">Sources</Link>.
            </p>
          ) : (
            <>
              <div className="row quick-fill-source">
                <ComboBox
                  label="Source"
                  placeholder="Pick a source…"
                  value={sourceId}
                  onChange={setSourceId}
                  options={sources.map((s) => ({
                    id: s.id,
                    label: s.name,
                    description: `${s.races} race${s.races === 1 ? "" : "s"}${STANDING_NOTE[s.standing]}`,
                  }))}
                />
                <button
                  type="button"
                  disabled={!source}
                  onClick={() =>
                    source &&
                    apply(sourceFill(races, draft.rows, election, source.id, "agree"), "source")
                  }
                >
                  Agree with all
                </button>
                <button
                  type="button"
                  disabled={!source}
                  onClick={() =>
                    source &&
                    apply(sourceFill(races, draft.rows, election, source.id, "against"), "source")
                  }
                >
                  Go against all
                </button>
              </div>
              <p className="hint">
                In two-way races and Yes/No measures, going against a source picks the other side.
                Elsewhere it marks the source's picks Against. Lists you don't follow work too: add
                any list in <Link to="/sources">Sources</Link> (unfollow it there if you don't want
                it beside your picks).
              </p>
            </>
          )}
        </div>
      )}
      {notice}
    </>
  );
}
