import type { Stance } from "@openslate/core";
import { forwardRef } from "react";
import { type DraftRow, NOTE_CHOICE, rowIdFor } from "../lib/ballotDraft";
import {
  ballotChoices,
  designation,
  instructionLine,
  picksIn,
  raceHeading,
  voteFor,
} from "../lib/ballotView";
import type { Race } from "../lib/collate";
import { formatElectionDate, formatLocalDate } from "../lib/dates";

/**
 * My ballot on paper: every race as the ballot prints it, a bubble per
 * choice (filled where I picked), and beside each bubble how many of the
 * sources I follow back it. Laid out in columns and scaled to fit one page
 * (`fitToPage` in lib/printFit.ts). Hidden on screen; see `.print-ballot` in styles.css.
 */

export interface PrintSection {
  label: string;
  races: Race[];
}

const BUBBLE_LABEL: Partial<Record<Stance, string>> = {
  endorse: "my pick",
  lean_for: "leaning",
  lean_against: "leaning against",
  oppose: "against",
};

export const PrintBallot = forwardRef<
  HTMLDivElement,
  {
    election: string;
    area: string;
    sections: PrintSection[];
    rows: Record<string, DraftRow>;
    followedCount: number;
    notes: boolean;
  }
>(function PrintBallot({ election, area, sections, rows, followedCount, notes }, ref) {
  return (
    <div ref={ref} className="print-ballot">
      <header className="pb-header">
        <h1>
          My ballot{election ? ` · ${formatElectionDate(election)}` : ""}
          {area && <span className="pb-area"> · {area}</span>}
        </h1>
        <p>
          <strong>Not an official ballot.</strong> Beside each bubble: how many of the{" "}
          {followedCount} sources I follow back that choice (✓) or oppose it (✗).{" "}
          <span className="pb-bubble pb-endorse" /> my pick ·{" "}
          <span className="pb-bubble pb-lean_for" /> leaning ·{" "}
          <span className="pb-bubble pb-oppose" /> against. Printed{" "}
          {formatLocalDate(new Date().toISOString())} from OpenSlate.
        </p>
      </header>
      <div className="pb-columns">
        {sections.map((section) => (
          <section key={section.label} className="pb-section">
            <h2>{section.label}</h2>
            {section.races.map((race) => (
              <PrintRace key={race.key} race={race} election={election} rows={rows} notes={notes} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
});

function PrintRace({
  race,
  election,
  rows,
  notes,
}: {
  race: Race;
  election: string;
  rows: Record<string, DraftRow>;
  notes: boolean;
}) {
  const title = raceHeading(race);
  const instruction = instructionLine(race);
  const note = notes ? rows[rowIdFor(election, race.subject, NOTE_CHOICE)]?.privateNote : undefined;
  const seats = voteFor(race);
  const overvoted = seats !== undefined && picksIn(race, election, rows) > seats;
  return (
    <div className="pb-race">
      <div className="pb-race-title">{title.heading}</div>
      {instruction && (
        <div className="pb-vote-for">
          {instruction}
          {overvoted && <strong> · ⚠ too many picks</strong>}
        </div>
      )}
      {title.label && <div className="pb-race-detail">{title.label}</div>}
      {title.measureType && <div className="pb-race-detail pb-kind">{title.measureType}</div>}
      <ul>
        {ballotChoices(race).map((group) => {
          const stance = rows[rowIdFor(election, race.subject, group.choice || undefined)]?.stance;
          return (
            <li key={group.choice} className={stance === "endorse" ? "pb-picked" : undefined}>
              <span className={`pb-bubble pb-${stance ?? "none"}`} />
              <span
                className={`pb-count${group.support + group.opposition === 0 ? " pb-zero" : ""}`}
              >
                {group.support > 0 || group.opposition === 0 ? `${group.support}✓` : ""}
                {group.opposition > 0 && ` ${group.opposition}✗`}
              </span>
              <span className="pb-name">
                {group.choice || "Overall"}
                {stance && BUBBLE_LABEL[stance] && stance !== "endorse" && (
                  <em> ({BUBBLE_LABEL[stance]})</em>
                )}
                {designation(group) && <span className="pb-designation">{designation(group)}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {note && <p className="pb-note">{note}</p>}
    </div>
  );
}
