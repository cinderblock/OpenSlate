import { type Subject, confidenceBucket } from "@openslate/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { raceQueryOptions, raceSearchQueryOptions, resolveSubjectRace } from "../lib/results";

/**
 * Compact outcome marker used in the collation view alongside each subject
 * group. Doesn't save mappings (the per-slate `ResultsPanel` handles that).
 * Just surfaces the declared winner so multi-issuer comparisons can include
 * "and the race actually went to ___" without opening a separate page.
 */
export function OutcomeChip({ subject }: { subject: Subject }) {
  const [pinnedRaceId, setPinnedRaceId] = useState<string | null>(null);

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
  // Only auto-pick if confidence is high — this chip mustn't mislead.
  const autoId =
    topMatch && confidenceBucket(topMatch.score) === "high" ? String(topMatch.race.id) : null;
  const raceId = pinnedRaceId ?? autoId;

  const race = useQuery(raceQueryOptions(raceId ?? undefined));

  if (!raceId) return null;
  if (race.isLoading) return <span className="tag">…</span>;
  if (!race.data) return null;

  const winner = race.data.candidates.find((c) => c.winner);
  if (!winner) {
    const reporting = race.data.percent_reporting;
    return (
      <span className="tag" title="No winner declared yet">
        {reporting !== undefined ? `${reporting.toFixed(0)}% reporting` : "in progress"}
      </span>
    );
  }

  return (
    <span className="tag" title={`Source: civicAPI · race #${race.data.id}`}>
      Winner: {winner.name}
      {winner.percent !== undefined && ` (${winner.percent.toFixed(1)}%)`}
    </span>
  );
}
