import type { Position } from "@openslate/core";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { raceQueryOptions, raceSearchQueryOptions } from "../lib/results";
import { type Actor, actorPossessive, actorVerbSubject } from "../lib/results-framing";
import { type SlateSummary, summarizeSlate } from "../lib/slate-summary";

interface SlateSummaryHeadlineProps {
  positions: Position[];
  /** Reported entity name for secondhand slates; "you" framing otherwise. */
  attributedTo?: string;
}

/**
 * Headline above ResultsForSlate's position list. Aggregates win/loss counts
 * across all positions by running the same search → detail TanStack queries
 * the per-position panels use, so it shares cache and doesn't re-fetch.
 *
 * Note: uses the top auto-match per position. If the user has pinned a
 * different race via "Change race" on a panel, the headline lags behind
 * until the next refresh; the panel itself reflects the override correctly.
 * This is acceptable for a top-of-page summary — the per-position copy is
 * still authoritative.
 */
export function SlateSummaryHeadline({ positions, attributedTo }: SlateSummaryHeadlineProps) {
  const actor: Actor = attributedTo ? { kind: "attributed", name: attributedTo } : { kind: "self" };

  // Fan out searches and race fetches across all positions in parallel.
  // Cache is shared with the per-position panels (same queryKey shape).
  const searches = useQueries({
    queries: positions.map((p) => raceSearchQueryOptions(p.subject)),
  });

  const raceIds = useMemo(() => searches.map((q) => q.data?.ranked[0]?.race.id), [searches]);

  const details = useQueries({
    queries: raceIds.map((id) => raceQueryOptions(id)),
  });

  const summary: SlateSummary = useMemo(
    () =>
      summarizeSlate(
        positions,
        details.map((q) => q.data),
      ),
    [positions, details],
  );

  if (summary.total === 0) return null;

  const possessive = actorPossessive(actor);
  const verbSubject = actorVerbSubject(actor);
  const headline = renderHeadline(summary, possessive, verbSubject);

  return (
    <div className="card slate-summary">
      <div className="card-title">
        <strong>{headline}</strong>
      </div>
      <p className="hint">
        {summary.wins} won · {summary.losses} lost · {summary.pending} still being called ·{" "}
        {summary.unresolved} not yet matched to a race
        {summary.na > 0 && <> · {summary.na} no win/loss</>}
      </p>
    </div>
  );
}

function renderHeadline(summary: SlateSummary, possessive: string, verbSubject: string): string {
  const Possessive = capitalize(possessive);
  if (summary.winRate === null) {
    // Nothing decided yet — surface either pending or unresolved leading.
    if (summary.pending > 0) {
      return `${Possessive} ${summary.pending} call${summary.pending === 1 ? "" : "s"} still being counted.`;
    }
    return `Loading results for ${verbSubject}'s ${summary.total} position${
      summary.total === 1 ? "" : "s"
    }…`;
  }
  const pct = Math.round(summary.winRate * 100);
  return `${Possessive} ${summary.wins}/${summary.wins + summary.losses} called picks won (${pct}%).`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
