/**
 * The voter's own word on the order their ballot prints a race's names in,
 * where the app's order is wrong or unknown (plans/ballot-order.md). Kept on
 * this device only, keyed by `overrideKey`; the names in the voter's order.
 */
export type OrderOverrides = Record<string, string[]>;

/** One race's key in the store: its election and its collated key. */
export function overrideKey(race: { election?: string; key: string }): string {
  return `${race.election ?? ""}|${race.key}`;
}

/**
 * The voter's saved order against today's names: saved names still listed,
 * in their order, then any name listed since, in the app's order. Names no
 * longer listed drop out.
 */
export function reconcileOrder(saved: readonly string[], current: readonly string[]): string[] {
  const listed = new Set(current);
  const kept = saved.filter((name) => listed.has(name));
  const keptSet = new Set(kept);
  return [...kept, ...current.filter((name) => !keptSet.has(name))];
}
