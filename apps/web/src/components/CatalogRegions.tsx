import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import {
  addScopeRegion,
  removeScopeRegion,
  scopeRegions,
  useCatalogScope,
} from "../lib/catalogScope";
import { stateLabel } from "../lib/jurisdictions";
import { catalogQueryOptions, DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG } from "../lib/query";
import { Select } from "./ui/Select";

/** "California", "California and Texas", "California, Texas and Virginia". */
function listOf(names: string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** A catalog region that is a state or the like (`us/ca`), not a country's own shard (`us`). */
function isState(region: string): boolean {
  return region.split("/").length === 2;
}

/**
 * The states the public catalog is loaded for, where it comes a state at a
 * time (catalogScope.ts): which ones, a way to look at another, and a plain
 * word when it has nothing yet for where the voter votes. Nothing to show for
 * a catalog that comes whole.
 */
export function CatalogRegions({
  catalogUrl = DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG,
}: {
  catalogUrl?: string;
}) {
  const { data: catalog } = useQuery(catalogQueryOptions(catalogUrl));
  const [scope, setScope] = useCatalogScope();
  const [adding, setAdding] = useState<string>();
  if (!catalog?.sharded) return null;

  const has = catalog.sharded.regions.filter(isState);
  const asked = scopeRegions(scope).filter(isState);
  const missing = scope.mine.filter((region) => isState(region) && !has.includes(region));
  const shown = asked.filter((region) => has.includes(region));
  const more = has.filter((region) => !asked.includes(region));
  const names = (regions: string[]) => listOf(regions.map(stateLabel));
  /** Short enough to say; past that, a count. */
  const covers = has.length > 6 ? `${has.length} states` : names(has);
  const waiting = catalog.sharded.waiting === true;

  return (
    <div className="catalog-regions">
      {missing.length > 0 && (
        <p role="status">
          The public catalog has nothing for {names(missing)} yet.
          {has.length > 0 && ` It covers ${covers}.`}
        </p>
      )}
      <p className="hint">
        {waiting
          ? `The catalog covers ${covers}. Set where you vote on My ballot, or choose a state here, to see its races.`
          : asked.length === 0
            ? `Showing everything the catalog has: ${covers || "nothing yet"}.`
            : shown.length > 0
              ? `Showing ${names(shown)}.`
              : "Nothing to show for where you vote."}{" "}
        The catalog comes a state at a time: its host learns which states you look at, and nothing
        finer.
      </p>
      {scope.also.length > 0 && (
        <ul className="catalog-regions-also">
          {scope.also.map((region) => (
            <li key={region}>
              {stateLabel(region)}{" "}
              <button
                type="button"
                className="link"
                onClick={() => setScope((current) => removeScopeRegion(current, region))}
              >
                Stop showing<span className="sr-only"> {stateLabel(region)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {(asked.length > 0 || waiting) && more.length > 0 && (
        <div className="catalog-regions-add">
          <Select
            label={asked.length > 0 ? "Look at another state" : "Look at a state"}
            placeholder="Choose a state"
            value={adding}
            onChange={setAdding}
            options={more.map((region) => ({ id: region, label: stateLabel(region) }))}
          />
          <button
            type="button"
            disabled={!adding}
            onClick={() => {
              if (!adding) return;
              setScope((current) => addScopeRegion(current, adding));
              setAdding(undefined);
            }}
          >
            Show it
          </button>
        </div>
      )}
    </div>
  );
}
