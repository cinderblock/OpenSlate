import { createLocalStore } from "./localStore";
import { type OrderOverrides, overrideKey } from "./orderReconcile";

// The rules are in orderReconcile.ts, where a worker can load them without the store.
export { type OrderOverrides, overrideKey, reconcileOrder } from "./orderReconcile";

/** The voter's own ballot order, by `overrideKey` (orderReconcile.ts says what it holds). */
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
