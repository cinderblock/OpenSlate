import type { Adoption, Position } from "@openslate/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  type AdoptMethod,
  adoptableSlates,
  adoptionFor,
  copiedPositions,
  positionsFor,
  slateUri,
} from "../lib/adoptionDraft";
import type { DecodedSlate } from "../lib/collate";
import { catalogQueryOptions, DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG } from "../lib/query";
import { subjectKey } from "../lib/subjects";
import { STANCE_LABEL } from "./stanceOptions";
import { Checkbox } from "./ui/Checkbox";
import { Radio, RadioGroup } from "./ui/Radio";
import { Select } from "./ui/Select";

const CATALOG_URL = DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG;

export interface ComposedAdoption {
  id: string;
  name: string;
  method: AdoptMethod;
  count: number;
  /** Absent for a copy, whose positions join the slate's own. */
  adoption?: Adoption;
  positions?: Position[];
}

function positionLine(position: Position): string {
  const pick = position.choice ?? STANCE_LABEL[position.stance];
  return `${position.subject.title} → ${pick}`;
}

/**
 * Take on another slate's positions in the one being composed (SPEC §3.10),
 * the way the publisher prefers: by reference, with a snapshot, or as a copy.
 */
export function AdoptCard({
  slates,
  election,
  ownKey,
  added,
  onAdd,
  onRemove,
}: {
  slates: DecodedSlate[];
  election: string | undefined;
  ownKey: string | undefined;
  added: ComposedAdoption[];
  onAdd: (entry: ComposedAdoption) => void;
  onRemove: (id: string) => void;
}) {
  const options = useMemo(
    () => adoptableSlates(slates, election, ownKey),
    [slates, election, ownKey],
  );
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [method, setMethod] = useState<AdoptMethod>("reference");
  // Positions left out of the chosen slate, by subject key: everything starts in.
  const [excluded, setExcluded] = useState<ReadonlySet<string>>(new Set());
  const { data: catalog } = useQuery(catalogQueryOptions(CATALOG_URL));

  const slate = options.find((s) => s.source.id === sourceId);
  const offered = slate ? positionsFor(slate, election) : [];
  const chosen = offered.filter((p) => !excluded.has(subjectKey(p.subject)));
  const uri = slate && slateUri(slate, election, catalog?.entries ?? [], CATALOG_URL);
  const noLink = method === "reference" && !uri;

  function add() {
    if (!slate || chosen.length === 0 || noLink) return;
    onAdd({
      id: crypto.randomUUID(),
      name: slate.source.name,
      method,
      count: chosen.length,
      ...(method === "copy"
        ? { positions: copiedPositions(chosen) }
        : { adoption: adoptionFor(slate, chosen, method, uri) }),
    });
    setSourceId(null);
    setExcluded(new Set());
  }

  function toggle(key: string) {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <div className="card">
      <h3>From another slate</h3>
      <p className="hint">
        Publishing someone else's list too? Take on their positions instead of retyping them.
      </p>
      {options.length === 0 ? (
        <p className="hint">Import a slate for this election first (Sources).</p>
      ) : (
        <>
          <Select
            label="Slate"
            placeholder="Choose a slate"
            value={sourceId}
            onChange={(id) => {
              setSourceId(id);
              setExcluded(new Set());
            }}
            options={options.map((s) => ({
              id: s.source.id,
              label: s.source.name,
              badge: `${positionsFor(s, election).length}`,
            }))}
          />
          {slate && (
            <>
              <RadioGroup
                label="How"
                value={method}
                onChange={(value) => setMethod(value as AdoptMethod)}
              >
                <Radio value="reference">
                  Reference: your slate points at theirs, so readers see their positions with where
                  they came from.
                </Radio>
                <Radio value="snapshot">
                  Reference with a snapshot: also carries their signed slate, so it checks out
                  offline, but your slate gets bigger.
                </Radio>
                <Radio value="copy">
                  Copy: their positions become lines of your own, with no link back.
                </Radio>
              </RadioGroup>
              {noLink && (
                <p className="hint">
                  This slate has no public address to point at. Use a snapshot or a copy.
                </p>
              )}
              <details>
                <summary>
                  {chosen.length} of {offered.length} positions
                </summary>
                <ul className="pick-list">
                  {offered.map((position) => {
                    const key = subjectKey(position.subject);
                    return (
                      <li key={`${key}:${position.choice ?? ""}`}>
                        <Checkbox isSelected={!excluded.has(key)} onChange={() => toggle(key)}>
                          {positionLine(position)}
                        </Checkbox>
                      </li>
                    );
                  })}
                </ul>
              </details>
              <button type="button" onClick={add} disabled={chosen.length === 0 || noLink}>
                Add {chosen.length} position{chosen.length === 1 ? "" : "s"}
              </button>
            </>
          )}
        </>
      )}
      {added.length > 0 && (
        <ul className="position-list">
          {added.map((entry) => (
            <li key={entry.id}>
              <span className="position-subject">
                {entry.count} from <strong>{entry.name}</strong>
                <span className="hint">
                  {" "}
                  ·{" "}
                  {entry.method === "copy"
                    ? "copied"
                    : entry.method === "snapshot"
                      ? "reference with a snapshot"
                      : "by reference"}
                </span>
              </span>
              <button type="button" className="link danger" onClick={() => onRemove(entry.id)}>
                remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
