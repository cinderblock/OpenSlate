import Fuse from "fuse.js";
import { useMemo, useState } from "react";
import type { Election } from "../lib/query";

const MAX_RESULTS = 80;
const TODAY = new Date().toISOString().slice(0, 10);

export function ElectionCombobox({
  value,
  onChange,
  elections,
  isLoading,
  error,
}: {
  value: string;
  onChange: (id: string) => void;
  elections: Election[];
  isLoading: boolean;
  error: Error | null;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [showPast, setShowPast] = useState(false);

  // Filter out past + Test by default; selection display always uses the full list.
  const visibleElections = useMemo(() => {
    if (showPast) return elections;
    return elections.filter((e) => e.id !== "2000" && (!e.electionDay || e.electionDay >= TODAY));
  }, [elections, showPast]);

  const hiddenCount = elections.length - visibleElections.length;

  const fuse = useMemo(
    () =>
      new Fuse(visibleElections, {
        keys: ["name", "ocdDivisionId", "electionDay", "id"],
        threshold: 0.4,
        ignoreLocation: true,
      }),
    [visibleElections],
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return visibleElections.slice(0, MAX_RESULTS);
    return fuse.search(query, { limit: MAX_RESULTS }).map((r) => r.item);
  }, [query, fuse, visibleElections]);

  // selected is from the FULL list so a past/Test selection still renders.
  const selected = elections.find((e) => e.id === value);
  const selectedIsPast = selected?.electionDay ? selected.electionDay < TODAY : false;
  const selectedIsTest = selected?.id === "2000";

  function select(id: string) {
    onChange(id);
    setQuery("");
    setOpen(false);
  }

  return (
    <div className="combobox grow">
      {selected ? (
        <div className="grow">
          <div className="hint">Election</div>
          <div className="combobox-selected">
            <span>
              {selected.name} <span className="hint">({selected.electionDay})</span>
              {selectedIsPast && <span className="tag"> past</span>}
              {selectedIsTest && <span className="tag"> test</span>}
            </span>
            <button type="button" className="link" onClick={() => onChange("")}>
              change
            </button>
          </div>
        </div>
      ) : (
        <label className="grow">
          Election
          <input
            type="text"
            placeholder="search elections by name, state, or date…"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              // Defer so onMouseDown on options can fire first.
              setTimeout(() => setOpen(false), 120);
            }}
          />
        </label>
      )}

      {open && !selected && (
        <ul className="combobox-list">
          {isLoading && <li className="combobox-status">loading elections…</li>}
          {error && (
            <li className="combobox-status" title={error.message}>
              elections unavailable
            </li>
          )}
          {!isLoading && !error && filtered.length === 0 && (
            <li className="combobox-status">no matches</li>
          )}
          {filtered.map((election) => (
            <li key={election.id}>
              <button
                type="button"
                className="combobox-option"
                // onMouseDown fires before the input's onBlur, so the click registers.
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(election.id);
                }}
              >
                <strong>{election.name}</strong>
                <span className="hint">
                  {election.electionDay}
                  {election.ocdDivisionId ? ` · ${election.ocdDivisionId}` : ""}
                </span>
              </button>
            </li>
          ))}
          {hiddenCount > 0 && (
            <li className="combobox-status">
              <label className="row">
                <input
                  type="checkbox"
                  checked={showPast}
                  onMouseDown={(e) => e.stopPropagation()}
                  onChange={(e) => setShowPast(e.target.checked)}
                />
                <span>
                  Show past + Test elections <span className="hint">({hiddenCount} hidden)</span>
                </span>
              </label>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
