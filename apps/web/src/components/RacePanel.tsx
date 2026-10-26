import type { CandidateInfo, Passage, Stance, Subject } from "@openslate/core";
import { Link, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { useBallotDraft } from "../lib/ballotDraft";
import { type ChoiceGroup, type Race, collateRaces, stanceTone } from "../lib/collate";
import { type GuideForSubject, useGuideItem } from "../lib/guides";
import { useDecodedSlates, useFollows } from "../lib/myVote";
import { subjectFromKey, subjectKey } from "../lib/subjects";
import { ChoiceBallotTags, RaceUnlistedNote } from "./BallotTags";
import { EndorserAvatar } from "./EndorserAvatar";
import { ForecastsPanel } from "./ForecastsPanel";
import { CandidateGuide, GuideDetails, GuideMeans, GuideOverview } from "./GuideContent";
import { LeanMeter } from "./LeanMeter";
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

  // A shared link can open a race no imported slate has: then the subject
  // comes from my own picks, or from the key itself.
  const keySubject = useMemo(() => subjectFromKey(targetKey), [targetKey]);
  const knownSubject = race?.subject ?? myRows[0]?.subject ?? keySubject;

  // The official voter guide's material on this race, when a guide covers it.
  const guide = useGuideItem(knownSubject);

  // The guide's subject has what a parsed key lacks (kind, id).
  const subject = race || myRows[0] ? knownSubject : (guide.guide?.item.subject ?? knownSubject);
  // The race's election and jurisdiction fall back to the slate's context when
  // the subject leaves them out.
  const jurisdiction = race?.jurisdiction ?? subject?.jurisdiction;
  const election = race?.election ?? subject?.election;
  const pollSubject = useMemo<Subject>(
    () => ({
      title: subject?.title ?? targetKey,
      ...(subject?.id ? { id: subject.id } : {}),
      ...(subject?.kind ? { kind: subject.kind } : {}),
      ...(jurisdiction ? { jurisdiction } : {}),
      ...(election ? { election } : {}),
    }),
    [subject, jurisdiction, election, targetKey],
  );

  return (
    <section className="panel">
      <p>
        <Link to="/">← My ballot</Link>
      </p>
      <h2>{subject?.title ?? targetKey}</h2>
      <p className="hint">
        {subject?.kind && <span className="tag">{subject.kind}</span>}{" "}
        {jurisdiction && <span>{jurisdiction}</span>}
        {election && <span> · {election}</span>}
        {subject?.id && (
          <>
            {" · "}
            <code className="key">{subject.id}</code>
          </>
        )}
      </p>

      <div className="race-layout">
        {myRows.length > 0 && (
          <div className="card race-mine">
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

        {/* Beside the endorsements on a wide screen; between My positions and them on a phone. */}
        <aside className="race-context" aria-label="Polls, forecast and results">
          <PollsPanel subject={pollSubject} />

          <ForecastsPanel subject={pollSubject} />

          <ResultsPanel subject={pollSubject} />
        </aside>

        <div className="race-choices">
          {guide.guide && <GuideOverview guide={guide.guide} />}
          {guide.status === "error" && (
            <p className="hint warning">
              Couldn't load the official voter guide: {guide.error?.message ?? "unknown error"}
            </p>
          )}
          {!race ? (
            <>
              {guide.guide && <GuideChoices guide={guide.guide} />}
              <div className="card">
                <p className="hint">
                  No endorsements imported for this race yet. Add some in{" "}
                  <Link to="/sources">Sources</Link>.
                </p>
              </div>
            </>
          ) : (
            <>
              <RaceUnlistedNote race={race} />
              {race.onBallot && (
                <p className="hint">
                  {race.choices.filter((c) => c.onBallot).length} on the ballot ·{" "}
                  {race.followedSources} of {race.totalSources} sources with a position here are
                  ones you follow
                </p>
              )}
              {race.choices.map((group) => (
                <ChoiceCard
                  key={group.choice}
                  group={group}
                  race={race}
                  subjectTitle={race.subject.title}
                  guide={guide.guide}
                />
              ))}
            </>
          )}
          {guide.guide && <GuideDetails guide={guide.guide} />}
        </div>
      </div>
    </section>
  );
}

/**
 * The guide's candidates, or what each vote on a measure means, for a race no
 * imported slate lists choices for (a shared link opened by a new visitor).
 */
function GuideChoices({ guide }: { guide: GuideForSubject }) {
  const { candidates, means } = guide.item;
  return (
    <>
      {candidates?.map((candidate) => (
        <div key={candidate.choice} className="card">
          <div className="card-title">
            <strong>{candidate.choice}</strong>
          </div>
          <CandidateGuide candidate={candidate} guide={guide} />
        </div>
      ))}
      {means &&
        Object.entries(means).map(([choice, passage]) => (
          <div key={choice} className="card">
            <div className="card-title">
              <strong>{choice}</strong>
            </div>
            <GuideMeans passage={passage} guide={guide} />
          </div>
        ))}
    </>
  );
}

function ChoiceCard({
  group,
  race,
  subjectTitle,
  guide,
}: {
  group: ChoiceGroup;
  race: Race;
  subjectTitle: string;
  guide?: GuideForSubject;
}) {
  const candidate: CandidateInfo | undefined = guide?.item.candidates?.find(
    (c) => c.choice === group.choice,
  );
  const means: Passage | undefined = group.choice ? guide?.item.means?.[group.choice] : undefined;
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
        <ChoiceBallotTags group={group} race={race} />
        <span className="grow" />
        <span className="tag">
          {total.for} for · {total.against} against, followed or not
        </span>
      </div>
      {guide && candidate && <CandidateGuide candidate={candidate} guide={guide} />}
      {guide && !candidate && group.onBallot && guide.item.subject.kind === "race" && (
        <p className="hint">No statement or photo in the official voter guide.</p>
      )}
      {guide && means && <GuideMeans passage={means} guide={guide} />}
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
              <EndorserAvatar sourceId={position.source.id} name={position.source.name} size="md" />
              <span className="position-subject">
                {position.source.uri ? (
                  <a href={position.source.uri} target="_blank" rel="noreferrer">
                    <strong>{position.source.name}</strong>
                  </a>
                ) : (
                  <strong>{position.source.name}</strong>
                )}
                {position.standing === "off" && (
                  <span className="tag tag-inline">not followed, not on My ballot</span>
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
                {position.statement && <div className="hint">“{position.statement}”</div>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
