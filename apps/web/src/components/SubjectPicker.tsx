import type { Subject } from "@openslate/core";
import { useMemo, useState } from "react";
import { formatElectionDate } from "../lib/dates";
import { jurisdictionLabel } from "../lib/jurisdictions";
import type { KnownSubject } from "../lib/subjects";
import { Segmented } from "./ui/Segmented";
import { ComboBox, type SelectOption } from "./ui/Select";
import { TextField } from "./ui/TextField";

const FREE = "__free__";
const FREE_TEXT = "New subject";
const NONE = "";

const SUBJECT_KINDS = ["race", "measure", "candidate", "option"] as const;

/**
 * Pick a subject from the user's imported slates, or enter a free-text one.
 * Used for Compose's "Other positions". The same title can occur in several
 * places and elections, so each option says where and when.
 */
export function SubjectPicker({
  imported,
  onChange,
}: {
  imported: KnownSubject[];
  onChange: (next: Subject | null) => void;
}) {
  const [selected, setSelected] = useState<string>(NONE);
  const [freeTitle, setFreeTitle] = useState("");
  const [freeKind, setFreeKind] = useState<string>("race");
  const [typed, setTyped] = useState("");

  const options = useMemo<SelectOption[]>(
    () => [
      ...imported.map((entry) => {
        const where = [
          entry.subject.jurisdiction && jurisdictionLabel(entry.subject.jurisdiction),
          entry.subject.election && formatElectionDate(entry.subject.election),
        ]
          .filter(Boolean)
          .join(" · ");
        const n = entry.endorserCount;
        return {
          id: entry.key,
          label: entry.subject.title,
          textValue: where ? `${entry.subject.title} · ${where}` : entry.subject.title,
          description: where || undefined,
          badge: n > 0 ? `${n} issuer${n === 1 ? "" : "s"}` : undefined,
        };
      }),
      {
        id: FREE,
        label: "+ Enter a new subject…",
        textValue: FREE_TEXT,
        className: "ui-option-action",
      },
    ],
    [imported],
  );

  function updateFromSelect(key: string) {
    setSelected(key);
    if (key === FREE) {
      // Carry what was typed into the title, so a search that found nothing
      // becomes the new subject.
      const title = freeTitle.trim() || (typed === FREE_TEXT ? "" : typed.trim());
      if (title !== freeTitle) setFreeTitle(title);
      onChange(title ? { title, kind: freeKind } : null);
    } else if (key === NONE) {
      onChange(null);
    } else {
      const found = imported.find((k) => k.key === key);
      onChange(found?.subject ?? null);
    }
  }

  function updateFreeTitle(title: string) {
    setFreeTitle(title);
    onChange(title.trim() ? { title: title.trim(), kind: freeKind } : null);
  }

  function updateFreeKind(kind: string) {
    setFreeKind(kind);
    if (freeTitle.trim()) onChange({ title: freeTitle.trim(), kind });
  }

  const showFree = selected === FREE;

  return (
    <div className="subject-picker">
      <ComboBox
        label="Subject"
        placeholder={
          imported.length > 0
            ? `search ${imported.length} subjects from your slates…`
            : "enter a new subject…"
        }
        value={selected === NONE ? null : selected}
        onChange={updateFromSelect}
        onInputChange={setTyped}
        options={options}
        alwaysShow={(option) => option.id === FREE}
      />

      {showFree && (
        <div className="grid subject-free">
          <TextField
            label="Title"
            placeholder="e.g. Mayor of Springfield"
            value={freeTitle}
            onChange={updateFreeTitle}
          />
          <Segmented
            layout="stacked"
            label="Kind"
            value={freeKind}
            onChange={updateFreeKind}
            options={SUBJECT_KINDS.map((kind) => ({ id: kind, label: kind }))}
          />
        </div>
      )}
    </div>
  );
}
