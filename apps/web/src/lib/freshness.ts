import { type Query, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";

/**
 * Whether the count on screen may be behind: after a tab sat in the
 * background or a phone slept, its last check is older than the next one was
 * due. The page dims such a count and shows that it's catching up, rather than
 * passing old numbers off as current.
 */

/** How long past a due check a count still counts as current. */
export const FRESH_GRACE_MS = 30_000;

/** Data checked at `checkedAt` is out of date at `now` if the next check, due `everyMs` later, is overdue. */
export function isOutOfDate(
  checkedAt: number,
  now: number,
  everyMs: number,
  graceMs = FRESH_GRACE_MS,
): boolean {
  return checkedAt > 0 && now - checkedAt > everyMs + graceMs;
}

// ---- One shared clock ---------------------------------------------------------

const TICK_MS = 5_000;
/** A tick this late means the device slept (timers don't run then). */
const SLEPT_MS = 4 * TICK_MS;

let now = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();
const wakeListeners = new Set<() => void>();

function tick(): void {
  const t = Date.now();
  const slept = t - now > SLEPT_MS;
  now = t;
  for (const l of listeners) l();
  if (slept) for (const l of wakeListeners) l();
}

function onVisible(): void {
  if (document.visibilityState !== "visible") return;
  tick();
  for (const l of wakeListeners) l();
}

function onOnline(): void {
  tick();
  for (const l of wakeListeners) l();
}

function start(): void {
  if (timer !== undefined) return;
  now = Date.now();
  timer = setInterval(tick, TICK_MS);
  document.addEventListener("visibilitychange", onVisible);
  window.addEventListener("online", onOnline);
}

function stopIfIdle(): void {
  if (listeners.size > 0 || wakeListeners.size > 0 || timer === undefined) return;
  clearInterval(timer);
  timer = undefined;
  document.removeEventListener("visibilitychange", onVisible);
  window.removeEventListener("online", onOnline);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    stopIfIdle();
  };
}

/** The time, updated every few seconds and at once when the page comes back. */
export function useNow(): number {
  return useSyncExternalStore(
    subscribe,
    () => now,
    () => now,
  );
}

/**
 * When the page comes back into view, the device wakes, or the network returns, check every live count on the page that's out of date at once,
 * rather than waiting for its timer. Counts still current aren't refetched.
 */
export function useCatchUpOnWake(queryKey: readonly unknown[], everyMs: number): void {
  const client = useQueryClient();
  // biome-ignore lint/correctness/useExhaustiveDependencies: the key is compared by value
  useEffect(() => {
    const onWake = () => {
      const t = Date.now();
      void client.refetchQueries({
        queryKey,
        type: "active",
        predicate: (q) => isLive(q) && isOutOfDate(q.state.dataUpdatedAt, t, everyMs, 0),
      });
    };
    wakeListeners.add(onWake);
    start();
    return () => {
      wakeListeners.delete(onWake);
      stopIfIdle();
    };
  }, [client, JSON.stringify(queryKey), everyMs]);
}

/** Whether a live count checked at `checkedAt` is overdue for its next check, by the shared clock. */
export function useOutOfDate(checkedAt: number, everyMs: number): boolean {
  return isOutOfDate(checkedAt, useNow(), everyMs);
}

/** A query a page keeps checking on a timer (a live count), not one fetched once a day. */
export function isLive(q: Query): boolean {
  return q.observers.some((o) => Boolean(o.options.refetchInterval));
}

function onlineNow(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

function subscribeOnline(listener: () => void): () => void {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
}

/** Whether the browser thinks it's online. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, onlineNow, () => true);
}
