import { useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { AreaOptions } from "../lib/collate";
import {
  type Area,
  allDistricts,
  areaStates,
  districtFamilyLabel,
  districtName,
  inOneState,
  isAreaSet,
  jurisdictionLabel,
  jurisdictionRank,
  NO_DISTRICT,
  noRaceReason,
  parseJurisdiction,
  stateLabel,
} from "../lib/jurisdictions";
import { allRegions, pageRegion, regionPathOf, regionProfile } from "../lib/regions";
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
 * this election. The lists are one state's at a time: the one the area is in,
 * or the one chosen there.
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

  // The state the lists are for: the one chosen here, else the area's, else
  // the one the page's address names (`/va`), else the only one the imported
  // races are in. With races from several states and none of those, the lists
  // wait for a choice.
  const [chosenState, setChosenState] = useState<string>();
  const optionStates = useMemo(
    () =>
      new Set(
        [...options.localities, ...Object.keys(options.districts)].flatMap(
          (path) => regionPathOf(path) ?? [],
        ),
      ),
    [options],
  );
  const [areaState] = [...areaStates(area)];
  const state =
    chosenState ??
    areaState ??
    pageRegion() ??
    (optionStates.size === 1 ? [...optionStates][0] : undefined);
  const needsState = state === undefined && optionStates.size > 1;
  const inState = (path: string) => state === undefined || regionPathOf(path) === state;

  const localities = useMemo(() => {
    const offered = options.localities.filter(
      (path) => state === undefined || regionPathOf(path) === state,
    );
    // Selected ones first, so they never hide behind the filter.
    const selected = offered.filter((p) => area.localities.includes(p));
    const rest = offered.filter((p) => !area.localities.includes(p));
    const q = filter.trim().toLowerCase();
    const matching = q ? rest.filter((p) => jurisdictionLabel(p).toLowerCase().includes(q)) : rest;
    const shown = offered.length > CHIP_LIMIT && !q ? matching.slice(0, CHIP_LIMIT) : matching;
    return { count: offered.length, selected, shown, hidden: matching.length - shown.length };
  }, [options.localities, area.localities, filter, state]);

  function toggleLocality(path: string) {
    const has = area.localities.includes(path);
    const next: Area = {
      ...area,
      localities: has ? area.localities.filter((p) => p !== path) : [...area.localities, path],
    };
    // One taken off by hand stays off, though the lookup found it.
    if (has && area.found) next.found = area.found.filter((p) => p !== path);
    // Someone votes in one state: a place set in another replaces the first.
    onChange(has ? next : inOneState(next, regionPathOf(path)));
  }

  function setDistrict(family: string, number: string) {
    const districts = { ...area.districts };
    if (number) districts[family] = number;
    else delete districts[family];
    const next = { ...area, districts };
    onChange(number ? inOneState(next, regionPathOf(family)) : next);
  }

  // Families the races use, plus any the user has set (a district with no race
  // this election still belongs on the list), plus the state's own Congress
  // and legislature: everyone is in one of each, races imported or not.
  const layers = regionProfile(state)?.layers;
  const own = [layers?.congress, layers?.upper, layers?.lower].flatMap((key) =>
    key ? [`${state}/${key}`] : [],
  );
  const families = [
    ...new Set([...Object.keys(options.districts), ...Object.keys(area.districts), ...own]),
  ]
    .filter(inState)
    .sort((a, b) => jurisdictionRank(`${a}-1`) - jurisdictionRank(`${b}-1`));

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
        <Select
          className="area-state"
          label="State"
          placeholder="Choose your state"
          value={state ?? null}
          onChange={setChosenState}
          options={allRegions().map((region) => ({ id: region.path, label: region.name }))}
        />
        {needsState && <p className="hint">Choose your state to see its cities and districts.</p>}
        {state && localities.count === 0 && (
          <p className="hint">
            Nothing imported is filed under a city or county in {stateLabel(state)} yet. Your
            districts below are yours whether or not anything is.
          </p>
        )}

        {!needsState && localities.count > 0 && (
          <fieldset>
            <legend>City, county or local area</legend>
            {localities.count > CHIP_LIMIT && (
              <SearchField
                className="area-search"
                placeholder={`search ${localities.count} areas…`}
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

        {!needsState && families.length > 0 && (
          <fieldset>
            <legend>Your districts</legend>
            <div className="district-grid">
              {families.map((family) => {
                const part = parseJurisdiction(`${family}-1`);
                const label =
                  part.kind === "district" ? districtFamilyLabel(part.family, part.state) : family;
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
                        ...numbers.map((n) => {
                          // What the state calls it: 35A, Third Middlesex.
                          const called = districtName(family, n);
                          return present.includes(n)
                            ? { id: n, label: called }
                            : {
                                id: n,
                                label: called,
                                badge: "no race",
                                className: "district-no-race",
                              };
                        }),
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
