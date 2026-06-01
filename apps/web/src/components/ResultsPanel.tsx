import { type Race, type Stance, type Subject, confidenceBucket } from "@openslate/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { electionPhase, upcomingChipLabel } from "../lib/election-phase";
import {
  raceQueryOptions,
  raceSearchQueryOptions,
  resolveSubjectRace,
  saveSubjectRace,
} from "../lib/results";
import { type Actor, outcomeLine, pendingLine } from "../lib/results-framing";
import { RegionBreakdown } from "./RegionBreakdown";
import { ResultsTimeline } from "./ResultsTimeline";

interface ResultsPanelProps {
  subject: Subject;
  /** Optional: the user's stance + choice on this subject; renders the win/loss check. */
  stance?: Stance;
  choice?: string;
  /**
   * When the slate carrying this position is a secondhand report (SPEC §3.9),
   * the win/loss copy frames the outcome around the *reported* entity rather
   * than the signer. Pass `attribution.of.name` here; leave undefined for
   * firsthand slates.
   */
  attributedTo?: string;
}

export function ResultsPanel({ subject, stance, choice, attributedTo }: ResultsPanelProps) {
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
    const phase = electionPhase(subject);
    // Future elections legitimately have no results yet; surface that instead
    // of the generic "no civicAPI race found" so the user knows it's not a
    // matching failure.
    if (phase.kind === "upcoming" || phase.kind === "today") {
      return (
        <div className="card">
          <UpcomingNotice subject={subject} label={upcomingChipLabel(phase) ?? ""} />
        </div>
      );
    }
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
        {(() => {
          const label = upcomingChipLabel(electionPhase(subject));
          return label ? <span className="tag">{label}</span> : null;
        })()}
        {race.data?.is_disputed && (
          <span
            className="tag warning"
            title="civicAPI flagged this race as disputed — outcomes may shift."
          >
            disputed
          </span>
        )}
        {race.data?.last_updated && (
          <span className="hint" title={`Upstream timestamp: ${race.data.last_updated}`}>
            updated {formatRelativeTime(race.data.last_updated)}
          </span>
        )}
        {race.data &&
          (() => {
            const turnout = turnoutPercent(race.data);
            if (turnout === null) return null;
            return (
              <span
                className="hint"
                title={`${totalVotes(race.data).toLocaleString()} of ${race.data.registered_voters?.toLocaleString()} registered voters`}
              >
                {turnout.toFixed(1)}% turnout
              </span>
            );
          })()}
        <button
          type="button"
          className="link no-print"
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

      {race.data && (
        <RaceBody race={race.data} stance={stance} choice={choice} attributedTo={attributedTo} />
      )}

      {overrideOpen && (
        <div className="no-print">
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
        </div>
      )}

      {race.data && (
        <div className="no-print">
          <ResultsTimeline raceId={race.data.id} hasMap={race.data.has_map ?? false} />
        </div>
      )}

      <SourceFooter />
    </div>
  );
}

interface RaceBodyProps {
  race: Race;
  stance?: Stance;
  choice?: string;
  attributedTo?: string;
}

function RaceBody({ race, stance, choice, attributedTo }: RaceBodyProps) {
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
          attributedTo={attributedTo}
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

      <RegionBreakdown race={race} />
    </>
  );
}

interface UserCheckProps {
  stance: Stance;
  choice: string;
  winner?: string;
  matchedUserChoice?: boolean;
  /** Reported entity name when the slate is secondhand; falls back to "you". */
  attributedTo?: string;
}

function UserCheck({ stance, choice, winner, matchedUserChoice, attributedTo }: UserCheckProps) {
  const actor: Actor = attributedTo ? { kind: "attributed", name: attributedTo } : { kind: "self" };

  if (!winner) {
    const pending = pendingLine(actor, stance, choice);
    return pending ? <p className="hint">{pending}</p> : null;
  }
  const frame = outcomeLine(actor, stance, choice, winner, matchedUserChoice === true);
  if (!frame) return null;
  return (
    <p className={frame.success ? "ok" : "bad"}>
      <strong>{frame.success ? "✓" : "✗"}</strong> {frame.label}
    </p>
  );
}

function UpcomingNotice({ subject, label }: { subject: Subject; label: string }) {
  return (
    <>
      <div className="card-title">
        <strong>Results</strong>
        <span className="tag">{label}</span>
      </div>
      <p className="hint">
        Election scheduled for <strong>{subject.election}</strong>. Results will appear here once
        the race is called.
      </p>
      <SourceFooter />
    </>
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
        <SourceFooter />
      </>
    );
  }
  if (hits.length === 0) {
    return (
      <>
        <p className="hint">
          No civicAPI race found for <strong>{subject.title}</strong>.
        </p>
        <SourceFooter />
      </>
    );
  }
  return (
    <>
      <p className="hint">
        No high-confidence match for <strong>{subject.title}</strong>. Pick a race:
      </p>
      <HitList hits={hits} onPick={onPick} />
      <SourceFooter />
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
  const [query, setQuery] = useState("");
  const trimmed = query.trim();

  // Build a synthetic Subject that reuses the position's jurisdiction +
  // election but replaces the title with the user's free-text query, so the
  // search keeps the geographic / temporal filters from the original.
  const searchSubject: Subject | null = trimmed ? { ...subject, title: trimmed } : null;

  const manualSearch = useQuery({
    ...raceSearchQueryOptions(searchSubject ?? subject),
    enabled: searchSubject !== null,
  });

  const visibleHits = trimmed ? (manualSearch.data?.ranked ?? []) : hits;

  return (
    <div className="card-inset">
      <p className="hint">
        Pick the correct civicAPI race for <strong>{subject.title}</strong>:
      </p>
      <input
        type="search"
        placeholder="Search races by name…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: "100%", marginBottom: "0.5rem" }}
        aria-label="Search civicAPI races by name"
      />
      {trimmed && manualSearch.isFetching && <p className="hint">Searching…</p>}
      {trimmed && manualSearch.error && (
        <p className="error">
          Search failed:{" "}
          {manualSearch.error instanceof Error ? manualSearch.error.message : "unknown error"}
        </p>
      )}
      {trimmed && !manualSearch.isFetching && visibleHits.length === 0 && (
        <p className="hint">No matching races for "{trimmed}" in this jurisdiction.</p>
      )}
      <HitList hits={visibleHits} onPick={onPick} currentRaceId={currentRaceId} />
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

function SourceFooter() {
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

/**
 * Total votes counted across all candidates, useful for turnout math and as
 * a "votes counted so far" denominator on live races.
 */
function totalVotes(race: Race): number {
  return race.candidates.reduce((acc, c) => acc + (c.votes ?? 0), 0);
}

/**
 * Turnout % = total votes counted / registered voters. Returns `null` when
 * either side is missing or zero so the caller can suppress the display
 * rather than render a misleading 0% or a NaN.
 */
function turnoutPercent(race: Race): number | null {
  const registered = race.registered_voters;
  if (!registered || registered <= 0) return null;
  const cast = totalVotes(race);
  if (cast <= 0) return null;
  return (cast / registered) * 100;
}

/**
 * Compact relative-time formatter for the "updated 2m ago" label. Falls back
 * to the absolute date when the timestamp is more than a day old (at which
 * point the relative form stops being useful).
 */
function formatRelativeTime(ts: string): string {
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return ts;
  const diffMs = Date.now() - date.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 5) return "just now";
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return date.toLocaleDateString();
}
