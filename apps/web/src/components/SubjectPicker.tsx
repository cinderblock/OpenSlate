import type { Subject } from "@openslate/core";
import { useState } from "react";
import type { KnownSubject } from "../lib/subjects";

const FREE = "__free__";
const NONE = "";

const SUBJECT_KINDS = ["race", "measure", "candidate", "option"] as const;

/**
 * Pick a subject from the user's imported slates, or enter a free-text one.
 * Used for the "off-ballot" add-position flow in Compose. Ballot subjects are
 * rendered inline by BallotComposer, not in this picker.
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

  function updateFromSelect(key: string) {
    setSelected(key);
    if (key === FREE) {
      onChange(freeTitle.trim() ? { title: freeTitle.trim(), kind: freeKind } : null);
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
    <div>
      <label>
        Subject
        <select value={selected} onChange={(e) => updateFromSelect(e.target.value)}>
          <option value={NONE}>— pick a subject —</option>
          {imported.length > 0 && (
            <optgroup label="From imported slates">
              {imported.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.subject.title}
                  {entry.endorserCount > 0 ? ` · ${entry.endorserCount} issuer(s)` : ""}
                </option>
              ))}
            </optgroup>
          )}
          <option value={FREE}>+ Enter a new subject…</option>
        </select>
      </label>

      {showFree && (
        <div className="grid">
          <label>
            Title
            <input
              type="text"
              placeholder="e.g. Mayor of Springfield"
              value={freeTitle}
              onChange={(e) => updateFreeTitle(e.target.value)}
            />
          </label>
          <label>
            Kind
            <select value={freeKind} onChange={(e) => updateFreeKind(e.target.value)}>
              {SUBJECT_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {kind}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
