import { useSyncExternalStore } from "react";

/**
 * A JSON value in localStorage that every component reads live: a change in
 * one component (or another tab) re-renders all readers. Falls back to memory
 * when storage is unavailable, so the value still lasts for this page load.
 */
export interface LocalStore<T> {
  get(): T;
  set(next: T | ((current: T) => T)): void;
  subscribe(listener: () => void): () => void;
  /** Forget the stored value: readers go back to the fallback. */
  reset(): void;
}

/** Every store created so far, by key, so Settings → Your data can reset one live. */
const registry = new Map<string, LocalStore<unknown>>();

export function createLocalStore<T>(
  key: string,
  fallback: T,
  /** Rejects stored values of the wrong shape (returns undefined). */
  parse: (raw: unknown) => T | undefined,
): LocalStore<T> {
  const listeners = new Set<() => void>();
  let memory: string | null = null;
  // useSyncExternalStore needs the same object back while nothing changed.
  let cachedRaw: string | null | undefined;
  let cachedValue: T = fallback;

  function readRaw(): string | null {
    try {
      return localStorage.getItem(key) ?? memory;
    } catch {
      return memory;
    }
  }

  function get(): T {
    const raw = readRaw();
    if (raw === cachedRaw) return cachedValue;
    cachedRaw = raw;
    try {
      cachedValue = raw === null ? fallback : (parse(JSON.parse(raw)) ?? fallback);
    } catch {
      cachedValue = fallback;
    }
    return cachedValue;
  }

  function set(next: T | ((current: T) => T)): void {
    const value = typeof next === "function" ? (next as (current: T) => T)(get()) : next;
    const raw = JSON.stringify(value);
    memory = raw;
    try {
      localStorage.setItem(key, raw);
    } catch {
      // Storage unavailable: memory keeps it for this page load.
    }
    for (const listener of listeners) listener();
  }

  function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    window.addEventListener("storage", listener);
    return () => {
      listeners.delete(listener);
      window.removeEventListener("storage", listener);
    };
  }

  function reset(): void {
    memory = null;
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage unavailable: forgetting memory is all there is.
    }
    for (const listener of listeners) listener();
  }

  const store: LocalStore<T> = { get, set, subscribe, reset };
  registry.set(key, store as LocalStore<unknown>);
  return store;
}

/**
 * Remove a localStorage key, through its store when one is live (a raw removal
 * would leave the store serving its in-memory copy).
 */
export function removeLocalKey(key: string): void {
  const store = registry.get(key);
  if (store) {
    store.reset();
    return;
  }
  try {
    localStorage.removeItem(key);
  } catch {
    // Storage unavailable: nothing stored to remove.
  }
}

export function useLocalStore<T>(store: LocalStore<T>): [T, LocalStore<T>["set"]] {
  const value = useSyncExternalStore(store.subscribe, store.get, store.get);
  return [value, store.set];
}
