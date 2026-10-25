import { useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { AreaOptions } from "../lib/collate";
import {
  type Area,
  NO_DISTRICT,
  allDistricts,
  districtFamilyLabel,
  isAreaSet,
  jurisdictionLabel,
  jurisdictionRank,
  noRaceReason,
  parseJurisdiction,
} from "../lib/jurisdictions";
import { FindDistricts } from "./FindDistricts";
import { Radio, RadioGroup } from "./ui/Radio";
import { Select } from "./ui/Select";
import { SearchField } from "./ui/TextField";

/** Above this many localities, show a filter box instead of every chip. */
const CHIP_LIMIT = 16;

/** The district Select's "clear it" option. */
const NOT_SET = "__not_set__";

/** Find the area from a map, location or address, or choose it from lists. */
type Mode = "find" | "manual";

/**
 * "Where do you vote?": the localities and district numbers the user's ballot
 * covers. Two ways to set it, one shown at a time so finding it automatically
 * never means scrolling past the lists: "Find them for me" (map, location or
 * address), or "Choose them myself", where localities are the ones imported
 * races use and every real district is offered, marked when it has no race
 * this election.
 */
export function AreaPicker({
  options,
  area,
  election,
  onChange,
}: {
  options: AreaOptions;
  area: Area;
  /** The election `options` describe (`2026-11-03`), for saying why a district has no race. */
  election?: string;
  onChange: (next: Area) => void;
}) {
  // An area that's already set opens on the lists, where its values show.
  const [mode, setMode] = useState<Mode>(() => (isAreaSet(area) ? "manual" : "find"));
  const [filter, setFilter] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  /** From a found result: the button that asked is now hidden, so land on the lists' option. */
  function adjustByHand() {
    flushSync(() => setMode("manual"));
    rootRef.current?.querySelector<HTMLInputElement>(".area-modes input[value='manual']")?.focus();
  }

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

  // Families the races use, plus any the user has set (a district with no race
  // this election still belongs on the list).
  const families = [
    ...new Set([...Object.keys(options.districts), ...Object.keys(area.districts)]),
  ].sort((a, b) => jurisdictionRank(`${a}-1`) - jurisdictionRank(`${b}-1`));

  return (
    <div className="area-picker" ref={rootRef}>
      <RadioGroup
        aria-label="How to set where you vote"
        className="area-modes"
        orientation="horizontal"
        value={mode}
        onChange={(value) => setMode(value as Mode)}
      >
        <Radio value="find" variant="card">
          <span>
            <strong>Find them for me</strong>
            <span className="hint ui-option-note">
              Click a map, use your location, or type your address
            </span>
          </span>
        </Radio>
        <Radio value="manual" variant="card">
          <span>
            <strong>Choose them myself</strong>
            <span className="hint ui-option-note">
              Pick your city and district numbers from lists
            </span>
          </span>
        </Radio>
      </RadioGroup>

      {/* Both stay mounted so switching keeps the map, a lookup's result, the filter. */}
      <div hidden={mode !== "find"}>
        <FindDistricts
          options={options}
          area={area}
          election={election}
          onChange={onChange}
          onAdjust={adjustByHand}
        />
      </div>

      <div hidden={mode !== "manual"}>
        {options.localities.length === 0 && families.length === 0 && (
          <p className="hint">Nothing on this ballot is filed under a city or district yet.</p>
        )}

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

        {families.length > 0 && (
          <fieldset>
            <legend>Your districts</legend>
            <div className="district-grid">
              {families.map((family) => {
                const part = parseJurisdiction(`${family}-1`);
                const label = part.kind === "district" ? districtFamilyLabel(part.family) : family;
                const present = options.districts[family] ?? [];
                const current = area.districts[family];
                const numbers = allDistricts(family, current ? [...present, current] : present);
                return (
                  <div key={family} className="district-field">
                    <Select
                      label={label}
                      placeholder="not set"
                      value={current ?? null}
                      onChange={(n) => setDistrict(family, n === NOT_SET ? "" : n)}
                      options={[
                        { id: NOT_SET, label: "not set", className: "ui-option-quiet" },
                        ...numbers.map((n) =>
                          present.includes(n)
                            ? { id: n, label: n }
                            : { id: n, label: n, badge: "no race", className: "district-no-race" },
                        ),
                      ]}
                    />
                    {current && !present.includes(current) && (
                      <p className="hint district-no-race-note">
                        {noRaceReason(family, current, present, election)}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
            <p className="hint">
              Races in a kind of district you haven't set stay hidden. “No race” means nothing on
              this ballot is filed under that district.
            </p>
          </fieldset>
        )}
      </div>
    </div>
  );
}

/** One-line description of an area, e.g. "San Francisco · Congressional district 11". */
export function describeArea(area: Area): string {
  const parts = [
    ...area.localities.map(jurisdictionLabel),
    ...Object.entries(area.districts)
      .filter(([, n]) => n !== NO_DISTRICT)
      .map(([family, n]) => area.labels?.[family] ?? jurisdictionLabel(`${family}-${n}`)),
  ];
  return parts.join(" · ");
}
