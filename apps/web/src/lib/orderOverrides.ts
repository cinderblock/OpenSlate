import { createLocalStore } from "./localStore";

/**
 * The voter's own word on the order their ballot prints a race's names in,
 * where the app's order is wrong or unknown (plans/ballot-order.md). Kept on
 * this device only, keyed by `overrideKey`; the names in the voter's order.
 */
export type OrderOverrides = Record<string, string[]>;

export const orderOverrideStore = createLocalStore<OrderOverrides>(
  "openslate.ballotOrder.v1",
  {},
  (raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const out: OrderOverrides = {};
    for (const [key, names] of Object.entries(raw)) {
      if (Array.isArray(names) && names.every((n) => typeof n === "string")) out[key] = names;
    }
    return out;
  },
);

/** One race's key in the store: its election and its collated key. */
export function overrideKey(race: { election?: string; key: string }): string {
  return `${race.election ?? ""}|${race.key}`;
}

/** Save the voter's order for a race, or forget it (`undefined`). */
export function setOrderOverride(
  race: { election?: string; key: string },
  names: string[] | undefined,
): void {
  orderOverrideStore.set((current) => {
    const key = overrideKey(race);
    const next = { ...current };
    if (names) next[key] = names;
    else delete next[key];
    return next;
  });
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
