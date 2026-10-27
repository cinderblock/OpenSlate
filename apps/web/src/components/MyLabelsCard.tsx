import type { Stance } from "@openslate/core";
import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useState } from "react";
import { useBallotDraft } from "../lib/ballotDraft";
import { addLabel, labelProblem, type MyLabel, moveLabel, useMyLabels } from "../lib/myLabels";
import { STANCE_OPTIONS } from "./stanceOptions";
import { Select, type SelectOption } from "./ui/Select";
import { TextField } from "./ui/TextField";

/** The default-stance select's "none". No stance is named this. */
const NO_STANCE = "none";
const DEFAULT_STANCE_OPTIONS: SelectOption<Stance | typeof NO_STANCE>[] = [
  { id: NO_STANCE, label: "No default stance" },
  ...STANCE_OPTIONS,
];

/**
 * The user's own words for their positions (SPEC §3.17), for Compose to offer
 * on each pick. Renaming or removing one updates the picks that use it.
 */
export function MyLabelsCard({ onChange }: { onChange: () => void }) {
  const [labels, setLabels] = useMyLabels();
  const draft = useBallotDraft();
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [stance, setStance] = useState<Stance | typeof NO_STANCE>(NO_STANCE);
  const [error, setError] = useState<string | null>(null);

  function add() {
    const problem = labelProblem(labels, label);
    if (problem) {
      setError(problem);
      return;
    }
    setLabels(
      addLabel(labels, { label, description, ...(stance === NO_STANCE ? {} : { stance }) }),
    );
    setLabel("");
    setDescription("");
    setStance(NO_STANCE);
    setError(null);
  }

  function update(index: number, next: MyLabel) {
    const current = labels[index];
    if (!current) return;
    setLabels(labels.map((l, i) => (i === index ? next : l)));
    if (next.label !== current.label) draft.relabel(current.label, next.label);
    onChange();
  }

  function remove(index: number) {
    const current = labels[index];
    if (!current) return;
    setLabels(labels.filter((_, i) => i !== index));
    draft.relabel(current.label, undefined);
    onChange();
  }

  return (
    <div className="card my-labels">
      <h3>My labels</h3>
      <p className="hint">
        Your own words for your positions, like “Endorsed” or “Recommended”. Anyone who imports your
        slate reads a pick’s label instead of words like “leans for”; its stance still decides how
        it counts. Labels you use are published with what they mean, in this order.
      </p>
      {labels.length > 0 && (
        <ul className="label-list">
          {labels.map((entry, index) => (
            <LabelRow
              key={entry.label}
              entry={entry}
              labels={labels}
              first={index === 0}
              last={index === labels.length - 1}
              onChange={(next) => update(index, next)}
              onMove={(by) => {
                setLabels(moveLabel(labels, index, by));
                onChange();
              }}
              onRemove={() => remove(index)}
            />
          ))}
        </ul>
      )}
      <div className="grid">
        <TextField
          label="New label"
          placeholder="e.g. Recommended"
          value={label}
          onChange={(value) => {
            setLabel(value);
            setError(null);
          }}
          errorMessage={error}
        />
        <Select
          label="Picks with it default to"
          value={stance}
          onChange={setStance}
          options={DEFAULT_STANCE_OPTIONS}
        />
      </div>
      <TextField
        label="What it means (optional, published)"
        placeholder="e.g. Approved by a majority of our members"
        value={description}
        onChange={setDescription}
      />
      <button type="button" onClick={add} disabled={!label.trim()}>
        Add label
      </button>
    </div>
  );
}

function LabelRow({
  entry,
  labels,
  first,
  last,
  onChange,
  onMove,
  onRemove,
}: {
  entry: MyLabel;
  labels: readonly MyLabel[];
  first: boolean;
  last: boolean;
  onChange: (next: MyLabel) => void;
  onMove: (by: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(entry.label);
  const [description, setDescription] = useState(entry.description ?? "");
  const [error, setError] = useState<string | null>(null);
  return (
    <li className="label-row">
      <TextField
        className="label-name"
        aria-label={`Label ${entry.label}`}
        value={name}
        errorMessage={error}
        onChange={(value) => {
          setName(value);
          setError(null);
        }}
        onBlur={() => {
          const trimmed = name.trim();
          if (trimmed === entry.label) return;
          const problem = labelProblem(labels, trimmed, entry.label);
          if (problem) {
            setError(problem);
            return;
          }
          onChange({ ...entry, label: trimmed });
        }}
      />
      <TextField
        className="label-description"
        aria-label={`What ${entry.label} means`}
        placeholder="what it means (optional)"
        value={description}
        onChange={setDescription}
        onBlur={() => {
          const trimmed = description.trim();
          if (trimmed === (entry.description ?? "")) return;
          const { description: _, ...rest } = entry;
          onChange(trimmed ? { ...rest, description: trimmed } : rest);
        }}
      />
      <Select
        className="label-stance"
        aria-label={`Default stance for ${entry.label}`}
        value={entry.stance ?? NO_STANCE}
        onChange={(value) => {
          const { stance: _, ...rest } = entry;
          onChange(value === NO_STANCE ? rest : { ...rest, stance: value });
        }}
        options={DEFAULT_STANCE_OPTIONS}
      />
      <span className="label-actions">
        <button
          type="button"
          className="link"
          aria-label={`Move ${entry.label} up`}
          disabled={first}
          onClick={() => onMove(-1)}
        >
          <ArrowUp className="icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="link"
          aria-label={`Move ${entry.label} down`}
          disabled={last}
          onClick={() => onMove(1)}
        >
          <ArrowDown className="icon" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="link danger"
          aria-label={`Remove ${entry.label}`}
          onClick={onRemove}
        >
          <X className="icon" aria-hidden="true" /> remove
        </button>
      </span>
    </li>
  );
}
