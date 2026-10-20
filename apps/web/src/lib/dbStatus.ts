import { useSyncExternalStore } from "react";

/**
 * Whether this tab can use the browser database. Page state, not persisted.
 *
 * - `blocked`: a newer version of the app needs to upgrade the database, but
 *   another tab running the old version still has it open. Nothing loads until
 *   that tab closes or reloads.
 * - `outdated`: the reverse. A newer version opened in another tab and this
 *   tab let go of the database so it could upgrade; this tab must reload.
 * - `failed`: the database wouldn't open at all (private mode, storage off…).
 */
export type DbStatus =
  | { state: "ok" }
  | { state: "blocked" }
  | { state: "outdated" }
  | { state: "failed"; message: string };

let status: DbStatus = { state: "ok" };
const listeners = new Set<() => void>();

export function setDbStatus(next: DbStatus): void {
  status = next;
  for (const listener of listeners) listener();
}

export function useDbStatus(): DbStatus {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => status,
  );
}
