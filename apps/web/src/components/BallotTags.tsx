import { type BallotProblem, describeProblem, problemReport } from "../lib/ballotCheck";
import type { ChoiceGroup, Race } from "../lib/collate";
import { reportFeedback } from "../lib/feedback";
import { jurisdictionLabel } from "../lib/jurisdictions";
import { InfoPopover } from "./ui/InfoPopover";

/**
 * What the ballot listing says about a choice an endorser named (SPEC §3.11,
 * §3.12): a write-in, or not on the ballot at all. The translator has already
 * moved every plainly-listed spelling onto the ballot's own, so whatever is
 * left here is something a person should look at, and can report.
 */

function where(race: Race): string {
  return `"${race.subject.title}"${race.jurisdiction ? ` (${race.jurisdiction})` : ""}`;
}

function whoNamed(group: ChoiceGroup): string {
  const names = group.positions.map((p) => p.source.name);
  return names.length > 0 ? `, named by ${names.join(", ")}` : "";
}

function ReportButton({ message }: { message: string }) {
  return (
    <button type="button" className="link" onClick={() => reportFeedback("wrong-info", message)}>
      Report it
    </button>
  );
}

export function ChoiceBallotTags({ group, race }: { group: ChoiceGroup; race: Race }) {
  if (!group.choice) return null;
  if (group.writeIn) {
    const uncertified = race.onBallot && !group.onBallot;
    return (
      <InfoPopover
        className={`tag tag-inline${uncertified ? " tag-warn" : ""}`}
        bare={false}
        label={`${group.choice} is a write-in candidate`}
        trigger={uncertified ? "Write-in, not certified" : "Write-in"}
      >
        <p>
          <strong>{group.choice}</strong> isn't printed on the ballot. To vote for them, write the
          name in on the line under this race (and fill in the bubble or arrow beside it).
        </p>
        {uncertified && (
          <>
            <p className="warning">
              They aren't on the official list of certified write-in candidates. In many places,
              including California, a vote for a write-in who isn't certified isn't counted.
            </p>
            {group.suggestion && (
              <p>
                Did they mean <strong>{group.suggestion}</strong>?
              </p>
            )}
            <p className="hint">
              If the list is wrong or out of date,{" "}
              <ReportButton
                message={`Write-in "${group.choice}" in ${where(race)}${whoNamed(group)}, isn't on the certified write-in list OpenSlate has.`}
              />
              .
            </p>
          </>
        )}
      </InfoPopover>
    );
  }
  if (!race.onBallot || group.onBallot) return null;
  return (
    <InfoPopover
      className="tag tag-inline tag-warn"
      bare={false}
      label={`${group.choice} isn't on the official ballot list`}
      trigger="Not on the ballot"
    >
      <p>
        <strong>{group.choice}</strong> isn't one of the names on the official ballot list for{" "}
        {race.subject.title}. It's shown as the source wrote it.
      </p>
      {group.suggestion && (
        <p>
          It looks like <strong>{group.suggestion}</strong>, which is on the ballot, maybe
          misspelled. Check the source before relying on it.
        </p>
      )}
      <p className="hint">
        This usually means the endorsement didn't import cleanly.{" "}
        <ReportButton
          message={`"${group.choice}" in ${where(race)}${whoNamed(group)}, isn't on the official ballot list.${group.suggestion ? ` Maybe "${group.suggestion}"?` : ""}`}
        />{" "}
        so it can be fixed.
      </p>
    </InfoPopover>
  );
}

/** A race in a jurisdiction the ballot listing covers, but that the listing doesn't name. */
export function RaceUnlistedNote({ race }: { race: Race }) {
  if (!race.unlisted || race.onBallot) return null;
  const sources = [...new Set(race.choices.flatMap((c) => c.positions.map((p) => p.source.name)))];
  const named = sources.length > 0 ? `, named by ${sources.join(", ")}` : "";
  return (
    <p className="warning">
      This race isn't on the official ballot list for{" "}
      {jurisdictionLabel(race.jurisdiction) || "this area"}: the source may have named it
      differently, or it may not be on this ballot.{" "}
      <ReportButton message={`Race ${where(race)}${named}, isn't on the official ballot list.`} />
    </p>
  );
}

/**
 * The detector's summary: endorsements that name something the ballot listing
 * doesn't have, so probably didn't import cleanly. Write-ins aren't counted:
 * they're meant to be off the printed ballot.
 */
export function BallotProblemsNotice({ problems }: { problems: BallotProblem[] }) {
  const shown = problems.filter((p) => p.kind !== "write-in");
  if (shown.length === 0) return null;
  const sources = new Set(shown.map((p) => p.sourceName));
  return (
    <div className="card ballot-notice no-print" role="status">
      <p>
        <strong>
          {shown.length === 1 ? "1 endorsement names" : `${shown.length} endorsements name`} a
          candidate or race that isn't on the official ballot list
        </strong>{" "}
        ({sources.size === 1 ? [...sources][0] : `${sources.size} sources`}). They may not have
        imported cleanly. They're shown as the source wrote them, marked “Not on the ballot”.
      </p>
      <details>
        <summary>Which ones</summary>
        <ul>
          {shown.map((p) => (
            <li key={`${p.sourceId}|${p.subject.title}|${p.choice ?? ""}`}>{describeProblem(p)}</li>
          ))}
        </ul>
      </details>
      <p>
        <button
          type="button"
          className="link"
          onClick={() => reportFeedback("wrong-info", problemReport(shown))}
        >
          Report them
        </button>{" "}
        so they can be fixed.
      </p>
    </div>
  );
}
