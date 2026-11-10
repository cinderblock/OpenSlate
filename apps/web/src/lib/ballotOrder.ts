import type { Area } from "./jurisdictions";
import { regionFor } from "./regions";
import { CA_BALLOT_ORDER } from "./regions/us-ca/ballotOrder";

/**
 * The order a ballot prints a race's candidates in, for one voter. That's
 * each region's law: California draws a random alphabet and rotates names
 * from one Assembly district to the next (`regions/us-ca/ballotOrder.ts`);
 * a region with no rules here keeps the order its listing gives. Pure: no
 * React, no storage, nothing sent anywhere. Unit-tested in
 * test/ballotOrder.test.ts.
 */

/** Where an order comes from, or why it can't be known. */
export type OrderBasis =
  /** The law, the drawing and the voter's districts fix it. */
  | "ballot"
  /** The law's default for local races; a county or charter city may differ. */
  | "likely"
  /** It differs across the race's area and the voter's district can't say which. */
  | "varies"
  /** The voter set it by hand from their own ballot. */
  | "yours";

export interface ComputedOrder {
  basis: OrderBasis;
  /** The names in ballot order; the input order when it "varies". */
  names: string[];
  /** Why the order can't be known, or may be off, for a note under the race. */
  reason?: string;
}

export interface RaceForOrder {
  election?: string;
  jurisdiction?: string;
  /** Who votes on it, when narrower than the jurisdiction (a supervisorial district). */
  district?: string;
  title: string;
  kind?: string;
  /** A judge's yes/no retention question. */
  retention?: boolean;
}

/** One region's rules for the order its ballots print names in. */
export interface BallotOrderRules {
  /** The letters the region drew for an election, first first, if it draws them and we have them. */
  alphabetFor: (election: string | undefined) => string | undefined;
  /**
   * A race's printed names in this voter's ballot order. Undefined when no
   * rule applies: an office the rules don't order, or an election we have no
   * drawing for.
   */
  orderFor: (
    race: RaceForOrder,
    names: string[],
    area: Area | undefined,
  ) => ComputedOrder | undefined;
  /** The order a county prints its local measures in, by number or letter, where it publishes one. */
  measureOrderOf?: (
    race: { election?: string; jurisdiction?: string },
    area: Area | undefined,
  ) => string[] | undefined;
}

/** The regions whose ballot order the app knows, by region path. */
const RULES: Record<string, BallotOrderRules> = {
  "us/ca": CA_BALLOT_ORDER,
};

/** The rules of the region a jurisdiction is in (or is). */
function rulesFor(jurisdiction: string | undefined): BallotOrderRules | undefined {
  const region = regionFor(jurisdiction);
  return region ? RULES[region.path] : undefined;
}

/**
 * The drawn letters a region's ballots sort names by for an election, if it
 * draws them and we have them. `jurisdiction`: the region, or anywhere in it.
 */
export function alphabetFor(
  election: string | undefined,
  jurisdiction: string | undefined,
): string | undefined {
  return rulesFor(jurisdiction)?.alphabetFor(election);
}

/**
 * The order a county prints its local measures in, by letter, if it says:
 * the race's county, else the voter's one county.
 */
export function measureOrderOf(
  race: { election?: string; jurisdiction?: string },
  area: Area | undefined,
): string[] | undefined {
  return rulesFor(race.jurisdiction)?.measureOrderOf?.(race, area);
}

/**
 * The race's printed names in this voter's ballot order. `undefined` when no
 * rule here applies (keep the listing's order): measures, retention
 * questions, regions whose rules we don't have, elections we have no drawing
 * for.
 */
export function ballotOrderFor(
  race: RaceForOrder,
  names: string[],
  area: Area | undefined,
): ComputedOrder | undefined {
  if (!race.election || race.kind === "measure" || race.retention) return undefined;
  return rulesFor(race.jurisdiction)?.orderFor(race, names, area);
}
