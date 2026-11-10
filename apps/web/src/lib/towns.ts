import { slugOf } from "./jurisdictions";

/**
 * Towns and townships: the local governments that aren't incorporated places.
 * In twenty states (New England, New York, New Jersey, Pennsylvania and the
 * Midwest) the land outside the cities, and in New England nearly all of it,
 * is divided into towns or townships that elect their own officers. The
 * Census calls them county subdivisions and names each as its own name and
 * its kind: "Lexington town", "Washington township", "Canton charter
 * township", "Matinicus Isle plantation".
 *
 * How one is spelled in a path (SPEC §3.3):
 *
 * - A township is `<name>-township`, a charter township too
 *   (`canton-township`); a plantation `<name>-plantation`.
 * - A town in New England is its bare name, `lexington`: there the town is
 *   the municipality, and a village, borough or city of the same name takes
 *   its kind instead (`woodstock-village`, `st-albans-city`; `placeSlug`).
 * - A town anywhere else (New York, Wisconsin) is `<name>-town`, since a
 *   city or village of the same name is the rule there, not the exception
 *   (`ithaca` the city, `ithaca-town` the town around it).
 *
 * Township names repeat within a state (Pennsylvania has 22 Washington
 * Townships), so a town can always be filed under its county,
 * `us/pa/greene-county/washington-township`, and is filed bare only where
 * the name is the only one in the state. Which names repeat is in the
 * state's boundary file, so that is what knows (`geo.ts`).
 *
 * Pure; unit-tested in test/towns.test.ts.
 */

/** A town as the Census names it. */
export interface CensusTown {
  /** The whole name, kind included: "Washington township". */
  name: string;
  /** The name alone: "Washington". */
  basename: string;
}

/** The states whose towns are their municipalities, by region path. */
const NEW_ENGLAND: ReadonlySet<string> = new Set([
  "us/ct",
  "us/ma",
  "us/me",
  "us/nh",
  "us/ri",
  "us/vt",
]);

/** Whether a state's towns go by their bare names. */
export function townsAreBare(state: string): boolean {
  return NEW_ENGLAND.has(state);
}

/** The kind the Census puts after a name ("township"), or "" when the name isn't built that way. */
function kindOf({ name, basename }: CensusTown): string | undefined {
  if (!name.startsWith(basename)) return undefined;
  return name.slice(basename.length).trim().toLowerCase();
}

/** A town's path segment in its state. */
export function townSlug(state: string, town: CensusTown): string {
  const kind = kindOf(town);
  // "Township 5" (Kansas, Nebraska): the kind comes first, so the name is all of it.
  if (kind === undefined) return slugOf(town.name);
  const base = slugOf(town.basename);
  if (kind.includes("township")) return `${base}-township`;
  if (kind === "") return base;
  if (kind === "town") return townsAreBare(state) ? base : `${base}-town`;
  return `${base}-${slugOf(kind)}`;
}

/** What to call a town: "Lexington", "Washington Township", "Town of Ithaca". */
export function townLabel(state: string, town: CensusTown): string {
  const kind = kindOf(town);
  if (kind === "town") return townsAreBare(state) ? town.basename : `Town of ${town.basename}`;
  if (!kind) return town.name;
  return `${town.basename} ${kind.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())}`;
}

/**
 * An incorporated place's path segment where a town of the state has its
 * name and the town goes bare: the place takes its kind. `name` is the
 * Census's whole name for it ("Woodstock village").
 */
export function namesakePlaceSlug(name: string): string {
  return slugOf(name);
}
