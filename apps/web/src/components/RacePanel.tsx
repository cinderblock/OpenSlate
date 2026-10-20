import type { Stance, Subject } from "@openslate/core";
import { Link, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { useBallotDraft } from "../lib/ballotDraft";
import { type ChoiceGroup, collateRaces, stanceTone } from "../lib/collate";
import { useDecodedSlates, useFollows } from "../lib/myVote";
import { subjectKey } from "../lib/subjects";
import { ForecastsPanel } from "./ForecastsPanel";
import { PollsPanel } from "./PollsPanel";
import { ResultsPanel } from "./ResultsPanel";

const STANCE_LABEL: Record<Stance, string> = {
  endorse: "Endorse",
  oppose: "Oppose",
  lean_for: "Lean for",
  lean_against: "Lean against",
  neutral: "Neutral",
  abstain: "Abstain",
};

/**
 * One race: every imported source's position on it, followed sources first,
 * plus my own picks, polls, forecasts and results. Unlike My ballot, sources
 * you don't follow are listed in full here: this is where you compare.
 */
export function RacePanel() {
  const { key: routeKey } = useParams({ from: "/race/$key" });
  // TanStack Router auto-decodes route params, so routeKey is already the raw subject key.
  const targetKey = routeKey;

  const { slates } = useDecodedSlates();
  const [follows] = useFollows();
  const draft = useBallotDraft();

  const race = useMemo(
    () =>
      collateRaces(slates, { follows, includeUnfollowed: true }).find((r) => r.key === targetKey),
    [slates, follows, targetKey],
  );

  const myRows = useMemo(
    () => Object.values(draft.rows).filter((r) => subjectKey(r.subject) === targetKey),
    [draft.rows, targetKey],
  );

  const subject = race?.subject;
  const pollSubject = useMemo<Subject>(
    () => ({
      title: subject?.title ?? targetKey,
      ...(subject?.id ? { id: subject.id } : {}),
      ...(subject?.jurisdiction ? { jurisdiction: subject.jurisdiction } : {}),
      ...(subject?.election ? { election: subject.election } : {}),
    }),
    [subject, targetKey],
  );

  return (
    <section className="panel">
      <p>
        <Link to="/">← My ballot</Link>
      </p>
      <h2>{subject?.title ?? targetKey}</h2>
      <p className="hint">
        {subject?.kind && <span className="tag">{subject.kind}</span>}{" "}
        {race?.jurisdiction && <span>{race.jurisdiction}</span>}
        {race?.election && <span> · {race.election}</span>}
        {subject?.id && (
          <>
            {" · "}
            <code className="key">{subject.id}</code>
          </>
        )}
      </p>

      {myRows.length > 0 && (
        <div className="card">
          <h3>My positions</h3>
          <ul className="position-list">
            {myRows.map((row) => (
              <li key={row.id}>
                <span className={`stance stance-${row.stance ?? "neutral"}`}>
                  {row.stance ? STANCE_LABEL[row.stance] : "—"}
                </span>
                <span className="position-subject">
                  {row.choice ?? <em>(overall)</em>}
                  {row.statement && (
                    <div className="hint">
                      <em>statement:</em> {row.statement}
                    </div>
                  )}
                  {row.privateNote && (
                    <div className="hint">
                      <em>private note:</em> {row.privateNote}
                    </div>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <PollsPanel subject={pollSubject} />

      <ForecastsPanel subject={pollSubject} />

      <ResultsPanel subject={pollSubject} />

      {!race ? (
        <div className="card">
          <p className="hint">No endorsements imported for this subject yet.</p>
        </div>
      ) : (
        <>
          {race.onBallot && (
            <p className="hint">
              {race.choices.filter((c) => c.onBallot).length} on the ballot · {race.followedSources}{" "}
              of {race.totalSources} sources with a position here are ones you follow
            </p>
          )}
          {race.choices.map((group) => (
            <ChoiceCard key={group.choice} group={group} subjectTitle={race.subject.title} />
          ))}
        </>
      )}
    </section>
  );
}

function ChoiceCard({ group, subjectTitle }: { group: ChoiceGroup; subjectTitle: string }) {
  const total = { for: 0, against: 0 };
  for (const p of group.positions) {
    const tone = stanceTone(p.stance);
    if (tone === "for") total.for++;
    else if (tone === "against") total.against++;
  }
  return (
    <div className="card">
      <div className="card-title">
        <strong>{group.choice || <em>(no specific choice)</em>}</strong>
        {group.ballotNote && <span className="hint">{group.ballotNote}</span>}
        <span className="grow" />
        <span
          className="tag"
          title="Counting every imported source; My ballot counts only followed ones"
        >
          {total.for} for · {total.against} against
        </span>
      </div>
      {group.positions.length === 0 ? (
        <p className="hint">
          On the ballot; none of your imported sources take a position on {subjectTitle} for this
          choice.
        </p>
      ) : (
        <ul className="position-list">
          {group.positions.map((position) => (
            <li key={position.source.id}>
              <span className={`stance stance-${position.stance}`}>
                {STANCE_LABEL[position.stance]}
              </span>
              <span className="position-subject">
                {position.source.uri ? (
                  <a href={position.source.uri} target="_blank" rel="noreferrer">
                    <strong>{position.source.name}</strong>
                  </a>
                ) : (
                  <strong title={position.source.signerKey}>{position.source.name}</strong>
                )}
                {!position.followed && (
                  <span className="tag tag-inline" title="Shown for comparison; not on My ballot">
                    not followed
                  </span>
                )}
                {position.source.secondhand && (
                  <span
                    className="hint"
                    title={`Signed by ${position.source.signerKey}. ${position.source.name} did not sign this.`}
                  >
                    {" "}
                    · reported by {position.source.signerName ?? "a researcher"}
                  </span>
                )}
                {!position.valid && <span className="warning"> (unverified)</span>}
                {position.statement && <div className="hint">“{position.statement}”</div>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
