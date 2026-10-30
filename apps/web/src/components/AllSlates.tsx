import { useMemo, useState } from "react";
import type { AllRacesState } from "../lib/allSlates";
import type { RacePosition, StanceTone } from "../lib/collate";
import { formatLocalDate } from "../lib/dates";
import {
  groupPositions,
  type PositionGroup,
  type RaceTally,
  SOURCE_GROUPS,
  type SlateFilter,
  type SourceGroup,
} from "../lib/raceTally";
import { searchTerms } from "../lib/search";
import { PositionRow } from "./PositionRow";
import { ProgressBar } from "./ui/ProgressBar";
import { Segmented } from "./ui/Segmented";
import { Select } from "./ui/Select";
import { Switch } from "./ui/Switch";
import { SearchField } from "./ui/TextField";

/** How long a list of sources runs before "Show all". */
const FIRST_ROWS = 25;

/** A race with this few sources needs no searching through. */
const NAME_SEARCH_FROM = 12;

export function plural(count: number, noun: string): string {
  return `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
}

/** The wait for every slate, or why it isn't coming. Nothing once it's there. */
export function AllSlatesLoading({ state }: { state: AllRacesState }) {
  const { status, preparing, retry } = state;
  if (status.state === "error") {
    return (
      <div className="card" role="alert">
        <p>Couldn't load the public catalog: {status.error}</p>
        <button type="button" onClick={retry}>
          Try again
        </button>
      </div>
    );
  }
  if (status.state !== "loading" && !preparing) return null;
  return (
    <div className="card all-slates-loading">
      {preparing ? (
        <ProgressBar label="Lining up every race" value={0} />
      ) : (
        status.state === "loading" && (
          <ProgressBar
            label={status.label}
            value={status.value}
            {...(status.maxValue ? { maxValue: status.maxValue } : {})}
          />
        )
      )}
      <p className="hint">
        Every slate in the public catalog comes down as one file, so its host can't tell what you're
        looking up. It's kept in this browser for next time, and adds nothing to My ballot.
      </p>
    </div>
  );
}

/** Where the counts come from, and anything left out of them. */
export function CatalogNote({ all }: { all: NonNullable<AllRacesState["all"]> }) {
  return (
    <p className="hint">
      The public catalog as of {formatLocalDate(all.generatedAt)}, plus anything you've imported.
      {all.rejected > 0 &&
        ` ${plural(all.rejected, "catalog slate")} didn't verify, so they're left out.`}
    </p>
  );
}

/** The race's counts, and what narrows the list of sources under them. */
export function AllSlatesFilters({
  tally,
  filter,
  onChange,
}: {
  tally: RaceTally;
  filter: SlateFilter;
  onChange: (next: SlateFilter) => void;
}) {
  const [name, setName] = useState("");
  const toneLabels: Record<StanceTone, string> = tally.yesNo
    ? { for: "Yes", against: "No", neutral: "Neutral" }
    : { for: "For", against: "Against", neutral: "Neutral" };
  const countOf = (tone: StanceTone) =>
    tally.yesNo && tone !== "neutral"
      ? (tally.choices.find((c) => c.group.choice === toneLabels[tone])?.for ?? 0)
      : tally.tones[tone];
  const tones = (["for", "against", "neutral"] as const).filter(
    (tone) => countOf(tone) > 0 || tone !== "neutral",
  );
  const kinds = SOURCE_GROUPS.filter((group) => tally.groups[group.id]);
  return (
    <div className="all-slates-filters">
      <Segmented<StanceTone | "all">
        aria-label="Show slates by stance"
        className="all-slates-tones"
        value={filter.tone}
        onChange={(tone) => onChange({ ...filter, tone })}
        options={[
          { id: "all", label: `All ${tally.sources.toLocaleString()}` },
          ...tones.map((tone) => ({
            id: tone,
            label: `${toneLabels[tone]} ${countOf(tone).toLocaleString()}`,
          })),
        ]}
      />
      {kinds.length > 1 && (
        <Select<SourceGroup | "all">
          aria-label="Show slates by kind of source"
          value={filter.group}
          onChange={(group) => onChange({ ...filter, group: group ?? "all" })}
          options={[
            { id: "all", label: "Every kind of source", badge: tally.sources },
            ...kinds.map((group) => ({
              id: group.id,
              label: group.label,
              badge: tally.groups[group.id],
            })),
          ]}
        />
      )}
      {tally.sources >= NAME_SEARCH_FROM && (
        <SearchField
          aria-label="Find a source by name"
          placeholder="Find a source"
          value={name}
          onChange={(next) => {
            setName(next);
            onChange({ ...filter, terms: searchTerms(next) });
          }}
        />
      )}
      {tally.followed > 0 && tally.followed < tally.sources && (
        <Switch
          isSelected={filter.followedOnly}
          onChange={(followedOnly) => onChange({ ...filter, followedOnly })}
        >
          Only sources I follow ({tally.followed})
        </Switch>
      )}
    </div>
  );
}

function toneLine({ tones }: PositionGroup): string {
  const parts = [
    tones.for > 0 && `${tones.for} for`,
    tones.against > 0 && `${tones.against} against`,
    tones.neutral > 0 && `${tones.neutral} neutral`,
  ];
  return parts.filter(Boolean).join(" · ");
}

function SlateGroup({ group, defaultOpen }: { group: PositionGroup; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? group.positions : group.positions.slice(0, FIRST_ROWS);
  return (
    <details
      className="slate-group"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        {group.label} <span className="hint">· {toneLine(group)}</span>
      </summary>
      {/* Closed groups render nothing: a proposition can have 100+ sources. */}
      {open && (
        <>
          <ul className="position-list">
            {shown.map((position) => (
              <PositionRow key={position.source.id} position={position} everySlate />
            ))}
          </ul>
          {shown.length < group.positions.length && (
            <button type="button" className="link" onClick={() => setExpanded(true)}>
              Show all {group.positions.length}
            </button>
          )}
        </>
      )}
    </details>
  );
}

/**
 * A choice's sources, counts first: a heading for each kind with its numbers,
 * opened when there are few enough to read, or when asked to find a name.
 */
export function SlateGroups({
  positions,
  searching,
}: {
  positions: RacePosition[];
  searching: boolean;
}) {
  const groups = useMemo(() => groupPositions(positions), [positions]);
  return (
    <div className="slate-groups">
      {groups.map((group) => (
        <SlateGroup
          key={`${group.id}|${searching}`}
          group={group}
          defaultOpen={searching || group.id === "followed" || positions.length <= 6}
        />
      ))}
    </div>
  );
}
