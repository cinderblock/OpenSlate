import { useSyncExternalStore } from "react";

/** Whether the getting-started wizard is open. Page state, not persisted. */
let open = false;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  open = next;
  for (const listener of listeners) listener();
}

export const openWizard = (): void => set(true);
export const closeWizard = (): void => set(false);

export function useWizardOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
  );
}
