import { useMemo, useState } from "react";
import type { AreaOptions } from "../lib/collate";
import {
  type Area,
  DISTRICT_LOOKUP,
  districtFamilyLabel,
  jurisdictionLabel,
  parseJurisdiction,
} from "../lib/jurisdictions";
import { Select } from "./ui/Select";
import { SearchField } from "./ui/TextField";

/** Above this many localities, show a filter box instead of every chip. */
const CHIP_LIMIT = 16;

/**
 * "Where do you vote?": the localities and district numbers the user's ballot
 * covers. Offers only what the imported (or catalog) races actually use.
 */
/** The district Select's "clear it" option. */
const NOT_SET = "__not_set__";

export function AreaPicker({
  options,
  area,
  onChange,
}: {
  options: AreaOptions;
  area: Area;
  onChange: (next: Area) => void;
}) {
  const [filter, setFilter] = useState("");

  const localities = useMemo(() => {
    // Selected ones first, so they never hide behind the filter.
    const selected = options.localities.filter((p) => area.localities.includes(p));
    const rest = options.localities.filter((p) => !area.localities.includes(p));
    const q = filter.trim().toLowerCase();
    const matching = q ? rest.filter((p) => jurisdictionLabel(p).toLowerCase().includes(q)) : rest;
    const shown =
      options.localities.length > CHIP_LIMIT && !q ? matching.slice(0, CHIP_LIMIT) : matching;
    return { selected, shown, hidden: matching.length - shown.length };
  }, [options.localities, area.localities, filter]);

  const states = useMemo(() => {
    const set = new Set<string>();
    for (const family of Object.keys(options.districts)) {
      set.add(family.split("/").slice(0, 2).join("/"));
    }
    return [...set];
  }, [options.districts]);

  function toggleLocality(path: string) {
    const has = area.localities.includes(path);
    onChange({
      ...area,
      localities: has ? area.localities.filter((p) => p !== path) : [...area.localities, path],
    });
  }

  function setDistrict(family: string, number: string) {
    const districts = { ...area.districts };
    if (number) districts[family] = number;
    else delete districts[family];
    onChange({ ...area, districts });
  }

  const familyEntries = Object.entries(options.districts);

  return (
    <div className="area-picker">
      {options.localities.length > 0 && (
        <fieldset>
          <legend>City, county or local area</legend>
          {options.localities.length > CHIP_LIMIT && (
            <SearchField
              className="area-search"
              placeholder={`search ${options.localities.length} areas…`}
              value={filter}
              onChange={setFilter}
            />
          )}
          <div className="chips">
            {[...localities.selected, ...localities.shown].map((path) => {
              const on = area.localities.includes(path);
              return (
                <button
                  key={path}
                  type="button"
                  className={`chip${on ? " on" : ""}`}
                  aria-pressed={on}
                  onClick={() => toggleLocality(path)}
                >
                  {jurisdictionLabel(path)}
                </button>
              );
            })}
            {localities.hidden > 0 && (
              <span className="hint">+{localities.hidden} more, search to find yours</span>
            )}
          </div>
        </fieldset>
      )}

      {familyEntries.length > 0 && (
        <fieldset>
          <legend>
            Your districts{" "}
            {states.map((state) =>
              DISTRICT_LOOKUP[state] ? (
                <a key={state} href={DISTRICT_LOOKUP[state]} target="_blank" rel="noreferrer">
                  (look yours up)
                </a>
              ) : null,
            )}
          </legend>
          <div className="district-grid">
            {familyEntries.map(([family, numbers]) => {
              const part = parseJurisdiction(`${family}-1`);
              const label = part.kind === "district" ? districtFamilyLabel(part.family) : family;
              return (
                <Select
                  key={family}
                  label={label}
                  placeholder="not set"
                  value={area.districts[family] ?? null}
                  onChange={(n) => setDistrict(family, n === NOT_SET ? "" : n)}
                  options={[
                    { id: NOT_SET, label: "not set", className: "ui-option-quiet" },
                    ...numbers.map((n) => ({ id: n, label: n })),
                  ]}
                />
              );
            })}
          </div>
          <p className="hint">
            Only districts that have endorsements are listed. Races in a kind of district you
            haven't set stay hidden.
          </p>
        </fieldset>
      )}
    </div>
  );
}

/** One-line description of an area, e.g. "San Francisco · Congressional district 11". */
export function describeArea(area: Area): string {
  const parts = [
    ...area.localities.map(jurisdictionLabel),
    ...Object.entries(area.districts).map(([family, n]) => jurisdictionLabel(`${family}-${n}`)),
  ];
  return parts.join(" · ");
}
