import { type Actor, actorPossessive, actorVerbSubject } from "../lib/results-framing";
import type { SlateSummary } from "../lib/slate-summary";

export type OutcomeFilter = "all" | "win" | "loss" | "pending" | "unresolved";

interface SlateSummaryHeadlineProps {
  summary: SlateSummary;
  /** Reported entity name for secondhand slates; "you" framing otherwise. */
  attributedTo?: string;
  filter: OutcomeFilter;
  onFilterChange: (next: OutcomeFilter) => void;
}

/**
 * Presentational headline above ResultsForSlate's position list. Renders
 * the win-rate copy, the count breakdown, and a filter chip group so
 * users can drill into wins / losses / pending / unmatched-races. Doesn't
 * fetch anything itself — the parent owns the data.
 */
export function SlateSummaryHeadline({
  summary,
  attributedTo,
  filter,
  onFilterChange,
}: SlateSummaryHeadlineProps) {
  if (summary.total === 0) return null;
  const actor: Actor = attributedTo ? { kind: "attributed", name: attributedTo } : { kind: "self" };
  const possessive = actorPossessive(actor);
  const verbSubject = actorVerbSubject(actor);
  const headline = renderHeadline(summary, possessive, verbSubject);

  return (
    <div className="card slate-summary">
      <div className="card-title">
        <strong>{headline}</strong>
      </div>
      <div className="filter-chips">
        <FilterChip
          label={`All (${summary.total})`}
          active={filter === "all"}
          onClick={() => onFilterChange("all")}
        />
        {summary.wins > 0 && (
          <FilterChip
            label={`Wins (${summary.wins})`}
            active={filter === "win"}
            onClick={() => onFilterChange(filter === "win" ? "all" : "win")}
            tone="ok"
          />
        )}
        {summary.losses > 0 && (
          <FilterChip
            label={`Losses (${summary.losses})`}
            active={filter === "loss"}
            onClick={() => onFilterChange(filter === "loss" ? "all" : "loss")}
            tone="bad"
          />
        )}
        {summary.pending > 0 && (
          <FilterChip
            label={`Still calling (${summary.pending})`}
            active={filter === "pending"}
            onClick={() => onFilterChange(filter === "pending" ? "all" : "pending")}
          />
        )}
        {summary.unresolved > 0 && (
          <FilterChip
            label={`Not yet matched (${summary.unresolved})`}
            active={filter === "unresolved"}
            onClick={() => onFilterChange(filter === "unresolved" ? "all" : "unresolved")}
          />
        )}
        {summary.na > 0 && <span className="hint">· {summary.na} no win/loss</span>}
      </div>
    </div>
  );
}

interface FilterChipProps {
  label: string;
  active: boolean;
  onClick: () => void;
  tone?: "ok" | "bad";
}

function FilterChip({ label, active, onClick, tone }: FilterChipProps) {
  const toneClass = tone ? ` ${tone}` : "";
  return (
    <button
      type="button"
      className={`tag filter-chip${active ? " active" : ""}${toneClass}`}
      onClick={onClick}
      aria-pressed={active}
    >
      {label}
    </button>
  );
}

function renderHeadline(summary: SlateSummary, possessive: string, verbSubject: string): string {
  const Possessive = capitalize(possessive);
  if (summary.winRate === null) {
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
