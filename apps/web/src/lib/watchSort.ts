import type { ContestResult } from "./liveCount";
import { createLocalStore, useLocalStore } from "./localStore";

/**
 * How the live count orders its races, and whether it groups them by place.
 * The voter's pick, kept in this browser. Pure helpers apart from the store;
 * unit-tested in test/watchSort.test.ts.
 */

export const SORT_KEYS = [
  "ballot",
  "manual",
  "closest",
  "clearest",
  "counted",
  "updated",
  "alpha",
] as const;

export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_LABELS: Record<SortKey, { label: string; description: string }> = {
  ballot: { label: "Ballot order", description: "As they appear on the ballot" },
  manual: { label: "Your order", description: "Move races up and down yourself" },
  closest: { label: "Closest first", description: "Smallest lead between the top two" },
  clearest: { label: "Clearest leads first", description: "Biggest lead between the top two" },
  counted: { label: "Most counted first", description: "Share of precincts in, then votes" },
  updated: { label: "Recently updated first", description: "Newest count first" },
  alpha: { label: "A–Z", description: "By name" },
};

export interface WatchView {
  sort: SortKey;
  /** Sections by place (true), or every race in one list. */
  grouped: boolean;
  /** Contest ids in the voter's own order ("Your order"); ones not in it follow, in ballot order. */
  order: string[];
}

const DEFAULT_VIEW: WatchView = { sort: "ballot", grouped: true, order: [] };

export const watchViewStore = createLocalStore<WatchView>(
  "openslate.watchView.v1",
  DEFAULT_VIEW,
  (raw) => {
    if (typeof raw !== "object" || raw === null) return undefined;
    const v = raw as Partial<WatchView>;
    return {
      sort: SORT_KEYS.includes(v.sort as SortKey) ? (v.sort as SortKey) : "ballot",
      grouped: typeof v.grouped === "boolean" ? v.grouped : true,
      order: Array.isArray(v.order) ? v.order.filter((c) => typeof c === "string") : [],
    };
  },
);

export const useWatchView = () => useLocalStore(watchViewStore);

/** What a race's count says, for sorting. */
export interface ContestFacts {
  title: string;
  result?: ContestResult;
  /** When the count was last updated (ms). */
  updatedAt?: number;
}

/** Votes counted, all choices together. */
export function votesCounted(result: ContestResult | undefined): number {
  if (!result) return 0;
  if (result.kind === "candidates") return result.candidates.reduce((s, c) => s + c.votes, 0);
  if (result.kind === "measure") return result.measure.yes + result.measure.no;
  return result.measures.reduce((s, m) => s + m.yes + m.no, 0);
}

/**
 * Percentage points between first and second (Yes and No for a measure), or
 * undefined with no votes counted. A race with one candidate has no contest:
 * its lead is the whole count.
 */
export function leadOf(result: ContestResult | undefined): number | undefined {
  if (!result || votesCounted(result) === 0) return undefined;
  if (result.kind === "candidates") {
    const [first, second] = [...result.candidates].sort((a, b) => b.percent - a.percent);
    return (first?.percent ?? 0) - (second?.percent ?? 0);
  }
  if (result.kind === "measure")
    return Math.abs(result.measure.yesPercent - result.measure.noPercent);
  return undefined;
}

/** `ids` in the voter's order: those in `order` first, as there, then the rest as they were. */
export function manualOrder(ids: readonly string[], order: readonly string[]): string[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return [...ids]
    .map((id, i) => ({ id, i, r: rank.get(id) }))
    .sort((a, b) => {
      if (a.r !== undefined && b.r !== undefined) return a.r - b.r;
      if (a.r !== undefined) return -1;
      if (b.r !== undefined) return 1;
      return a.i - b.i;
    })
    .map((x) => x.id);
}

/**
 * Sort contest ids. `ids` arrive in ballot order, which also breaks ties.
 * Races without a count yet go last in the count-based sorts.
 */
export function sortContests(
  ids: readonly string[],
  key: SortKey,
  facts: (id: string) => ContestFacts,
  order: readonly string[] = [],
): string[] {
  if (key === "ballot") return [...ids];
  if (key === "manual") return manualOrder(ids, order);
  const pos = new Map(ids.map((id, i) => [id, i]));
  const tie = (a: string, b: string) => (pos.get(a) ?? 0) - (pos.get(b) ?? 0);
  /** Sort by a number, missing last. */
  const by = (value: (id: string) => number | undefined, descending: boolean) =>
    [...ids].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      if (x === undefined && y === undefined) return tie(a, b);
      if (x === undefined) return 1;
      if (y === undefined) return -1;
      return (descending ? y - x : x - y) || tie(a, b);
    });
  switch (key) {
    case "closest":
      return by((id) => leadOf(facts(id).result), false);
    case "clearest":
      return by((id) => leadOf(facts(id).result), true);
    case "counted":
      return by((id) => {
        const r = facts(id).result;
        const votes = votesCounted(r);
        if (!r || votes === 0) return undefined;
        // Precinct share first, votes to break ties (mail ballots arrive before precincts).
        return (r.reporting.percent ?? 0) * 1e9 + votes;
      }, true);
    case "updated":
      return by((id) => facts(id).updatedAt, true);
    case "alpha":
      return [...ids].sort(
        (a, b) =>
          facts(a).title.localeCompare(facts(b).title, "en", { numeric: true }) || tie(a, b),
      );
  }
}

/**
 * Move one race up or down among those shown (`shown`, in their current order),
 * giving back the voter's whole order with the move made.
 */
export function moveInOrder(
  order: readonly string[],
  shown: readonly string[],
  id: string,
  direction: -1 | 1,
): string[] {
  const visible = manualOrder(shown, order);
  const at = visible.indexOf(id);
  const to = at + direction;
  if (at < 0 || to < 0 || to >= visible.length) return [...order];
  const next = [...visible];
  [next[at], next[to]] = [next[to] as string, next[at] as string];
  // Shown races in their new order; races not shown keep their place after them.
  return [...next, ...order.filter((o) => !next.includes(o))];
}
