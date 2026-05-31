import { type Race, type Stance, type Subject, confidenceBucket } from "@openslate/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import {
  raceQueryOptions,
  raceSearchQueryOptions,
  resolveSubjectRace,
  saveSubjectRace,
} from "../lib/results";
import { ResultsTimeline } from "./ResultsTimeline";

interface ResultsPanelProps {
  subject: Subject;
  /** Optional: the user's stance + choice on this subject; renders the win/loss check. */
  stance?: Stance;
  choice?: string;
}

export function ResultsPanel({ subject, stance, choice }: ResultsPanelProps) {
  const [pinnedRaceId, setPinnedRaceId] = useState<string | null>(null);
  const [overrideOpen, setOverrideOpen] = useState(false);

  // Load any persisted (auto or manual) mapping; that wins over fresh search.
  useEffect(() => {
    let cancelled = false;
    resolveSubjectRace(subject).then((mapping) => {
      if (cancelled) return;
      if (mapping) setPinnedRaceId(mapping.raceId);
    });
    return () => {
      cancelled = true;
    };
  }, [subject]);

  const search = useQuery(raceSearchQueryOptions(subject));

  const topMatch = search.data?.ranked[0];
  const effectiveRaceId = pinnedRaceId ?? (topMatch ? String(topMatch.race.id) : null);

  // Auto-persist a high-confidence match if nothing is pinned yet.
  useEffect(() => {
    if (pinnedRaceId) return;
    if (!topMatch) return;
    if (confidenceBucket(topMatch.score) !== "high") return;
    saveSubjectRace(subject, topMatch.race.id, "auto").then(() => {
      setPinnedRaceId(String(topMatch.race.id));
    });
  }, [pinnedRaceId, topMatch, subject]);

  const race = useQuery(raceQueryOptions(effectiveRaceId ?? undefined));

  if (search.isLoading && !race.data) {
    return (
      <div className="card">
        <p className="hint">Loading results…</p>
      </div>
    );
  }

  if (!effectiveRaceId) {
    return (
      <div className="card">
        <NoMatch
          subject={subject}
          hits={search.data?.ranked ?? []}
          onPick={(id) => {
            saveSubjectRace(subject, id, "manual").then(() => setPinnedRaceId(String(id)));
          }}
          error={search.error}
        />
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-title">
        <strong>Results</strong>
        {race.data?.percent_reporting !== undefined && (
          <span className="tag">
            {race.data.percent_reporting < 100
              ? `${race.data.percent_reporting.toFixed(1)}% reporting`
              : "Final"}
          </span>
        )}
        <button
          type="button"
          className="link"
          onClick={() => setOverrideOpen((v) => !v)}
          aria-expanded={overrideOpen}
        >
          {overrideOpen ? "Done" : "Change race"}
        </button>
      </div>

      {race.error && (
        <p className="error">
          Couldn't load race detail:{" "}
          {race.error instanceof Error ? race.error.message : "unknown error"}
        </p>
      )}

      {race.data && <RaceBody race={race.data} stance={stance} choice={choice} />}

      {overrideOpen && (
        <OverridePicker
          subject={subject}
          hits={search.data?.ranked ?? []}
          currentRaceId={effectiveRaceId}
          onPick={(id) => {
            saveSubjectRace(subject, id, "manual").then(() => {
              setPinnedRaceId(String(id));
              setOverrideOpen(false);
            });
          }}
        />
      )}

      {race.data && <ResultsTimeline raceId={race.data.id} hasMap={race.data.has_map ?? false} />}

      <Attribution />
    </div>
  );
}

interface RaceBodyProps {
  race: Race;
  stance?: Stance;
  choice?: string;
}

function RaceBody({ race, stance, choice }: RaceBodyProps) {
  const winner = race.candidates.find((c) => c.winner);
  const matchedUserChoice = useMemo(() => {
    if (!choice) return null;
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
    const target = norm(choice);
    return race.candidates.find((c) => norm(c.name) === target) ?? null;
  }, [choice, race.candidates]);

  return (
    <>
      <p className="hint">
        <strong>{race.election_name}</strong>
        {race.election_date && (
          <>
            {" "}
            · <span>{race.election_date.slice(0, 10)}</span>
          </>
        )}
        {race.province && <> · {race.province}</>}
        {race.district && <> · {race.district}</>}
      </p>

      {stance && choice && (
        <UserCheck
          stance={stance}
          choice={choice}
          winner={winner?.name}
          matchedUserChoice={matchedUserChoice?.winner}
        />
      )}

      <ul className="position-list results-candidates">
        {race.candidates.map((c, i) => (
          <li key={`${race.id}-${i}-${c.name}`}>
            <span
              className="result-swatch"
              style={c.color ? { background: c.color } : undefined}
              aria-hidden="true"
            />
            <span className="position-subject">
              <strong>{c.name}</strong>
              {c.party && <span className="tag-inline"> {c.party}</span>}
              {c.incumbent && <span className="hint"> · incumbent</span>}
              {c.winner && <span className="ok"> ✓ winner</span>}
              <div className="hint">
                {c.votes !== undefined && `${c.votes.toLocaleString()} votes`}
                {c.percent !== undefined && (
                  <>
                    {c.votes !== undefined && " · "}
                    {c.percent.toFixed(1)}%
                  </>
                )}
              </div>
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

interface UserCheckProps {
  stance: Stance;
  choice: string;
  winner?: string;
  matchedUserChoice?: boolean;
}

function UserCheck({ stance, choice, winner, matchedUserChoice }: UserCheckProps) {
  if (!winner) {
    return (
      <p className="hint">
        Your <em>{stance}</em> for <strong>{choice}</strong> — no winner declared yet.
      </p>
    );
  }
  const userPickedWinner = matchedUserChoice === true;
  let success = false;
  let label = "";
  switch (stance) {
    case "endorse":
    case "lean_for":
      success = userPickedWinner;
      label = success ? "Your pick won." : `Your pick lost (winner: ${winner}).`;
      break;
    case "oppose":
    case "lean_against":
      // For oppose, success means the user's choice did NOT win.
      success = !userPickedWinner;
      label = success ? `Your opposed pick lost — winner: ${winner}.` : "What you opposed won.";
      break;
    default:
      return null;
  }
  return (
    <p className={success ? "ok" : "bad"}>
      <strong>{success ? "✓" : "✗"}</strong> {label}
    </p>
  );
}

interface NoMatchProps {
  subject: Subject;
  hits: {
    race: { id: string | number; election_name: string; election_date?: string };
    score: number;
  }[];
  onPick: (id: string | number) => void;
  error: unknown;
}

function NoMatch({ subject, hits, onPick, error }: NoMatchProps) {
  if (error) {
    return (
      <>
        <p className="error">
          Couldn't search civicAPI: {error instanceof Error ? error.message : "unknown error"}
        </p>
        <Attribution />
      </>
    );
  }
  if (hits.length === 0) {
    return (
      <>
        <p className="hint">
          No civicAPI race found for <strong>{subject.title}</strong>.
        </p>
        <Attribution />
      </>
    );
  }
  return (
    <>
      <p className="hint">
        No high-confidence match for <strong>{subject.title}</strong>. Pick a race:
      </p>
      <HitList hits={hits} onPick={onPick} />
      <Attribution />
    </>
  );
}

interface OverridePickerProps {
  subject: Subject;
  hits: {
    race: { id: string | number; election_name: string; election_date?: string };
    score: number;
  }[];
  currentRaceId: string;
  onPick: (id: string | number) => void;
}

function OverridePicker({ subject, hits, currentRaceId, onPick }: OverridePickerProps) {
  return (
    <div className="card-inset">
      <p className="hint">
        Pick the correct civicAPI race for <strong>{subject.title}</strong>:
      </p>
      <HitList hits={hits} onPick={onPick} currentRaceId={currentRaceId} />
    </div>
  );
}

interface HitListProps {
  hits: {
    race: { id: string | number; election_name: string; election_date?: string };
    score: number;
  }[];
  onPick: (id: string | number) => void;
  currentRaceId?: string;
}

function HitList({ hits, onPick, currentRaceId }: HitListProps) {
  return (
    <ul className="position-list">
      {hits.slice(0, 8).map(({ race, score }) => {
        const isCurrent = currentRaceId === String(race.id);
        return (
          <li key={race.id}>
            <span className="tag">{confidenceBucket(score)}</span>
            <span className="position-subject">
              <strong>{race.election_name}</strong>
              {race.election_date && (
                <span className="hint"> · {race.election_date.slice(0, 10)}</span>
              )}
              {isCurrent ? (
                <span className="hint"> · current</span>
              ) : (
                <>
                  {" · "}
                  <button type="button" className="link" onClick={() => onPick(race.id)}>
                    use this
                  </button>
                </>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Attribution() {
  return (
    <p className="hint attribution">
      Source:{" "}
      <a href="https://civicapi.org" target="_blank" rel="noreferrer">
        civicAPI
      </a>{" "}
      · third-party aggregator; verify against official results for high-stakes use.
    </p>
  );
}
