/**
 * Anonymous usage statistics, behind one per-browser switch.
 *
 * Opt-in: off until the user turns it on, in Settings or in the footer. Both
 * read the same state (`useUsageEnabled`), so they never disagree.
 *
 * What leaves the browser is counts of the fixed events in `USAGE_SCHEMA`
 * below, sent to our own telemetry-collector, with no user, device or session
 * id. Nothing else: no third-party analytics script. (A Cloudflare Web
 * Analytics beacon was tried and removed. It's loaded live and unversioned,
 * and its Web Vitals report a CSS selector for the element that was clicked,
 * e.g. `button.stance-btn.stance-endorse`, so nothing could guarantee it never
 * carries a choice.)
 *
 * The hard rule (plans/usage-analytics.md): nothing reported may reveal a
 * choice, preference, race, candidate, measure, org, slate or jurisdiction.
 * Two layers enforce it:
 * - Types: `UsageEvent` is derived from `USAGE_SCHEMA`, so anything outside it
 *   is a compile error.
 * - Runtime: `sanitizeUsageEvent` re-checks every event against the same
 *   schema before it reaches the sink: known name, exactly the declared dims,
 *   each value from its closed list. A cast, an `any` or a bug can't widen it.
 */

import { useSyncExternalStore } from "react";

/** Route *templates*, never the matched values. */
export const ROUTE_TEMPLATES = [
  "/",
  "/compose",
  "/import",
  "/catalog",
  "/collate",
  "/race/$key",
  "/viewer",
  "/elections",
  "/results",
  "/results/$token",
  "/settings",
] as const;

export const SLATE_IMPORT_SOURCES = ["catalog", "url", "file", "qr", "paste"] as const;

/**
 * Every event that may be sent, and for each, its dims and their only allowed
 * values. Every value is a fixed, non-political string written here.
 */
export const USAGE_SCHEMA = {
  "page.view": { route: ROUTE_TEMPLATES },
  "slate.import": { source: SLATE_IMPORT_SOURCES },
  "catalog.import_all": {},
  "identity.create": {},
  "identity.import": {},
  "identity.export": {},
  "results.print": {},
  "results.export": { format: ["csv", "markdown"] },
} as const satisfies Record<string, Record<string, readonly string[]>>;

type Schema = typeof USAGE_SCHEMA;
type EventName = keyof Schema;

export type RouteTemplate = (typeof ROUTE_TEMPLATES)[number];
export type SlateImportSource = (typeof SLATE_IMPORT_SOURCES)[number];

export type UsageEvent = {
  [N in EventName]: keyof Schema[N] extends never
    ? { name: N }
    : { name: N; dims: { [D in keyof Schema[N]]: Schema[N][D][number & keyof Schema[N][D]] } };
}[EventName];

/** What the Settings page lists under "What we collect". */
export const USAGE_EVENT_DESCRIPTIONS: Record<EventName, string> = {
  "page.view": "Which screen was opened (e.g. “Results”), never what was on it",
  "slate.import":
    "That a slate was imported, and whether from the catalog, a URL, a file, a QR code or pasted",
  "catalog.import_all": "That “Import all” was used on the catalog",
  "identity.create": "That a new signing identity was created",
  "identity.import": "That an identity backup was restored",
  "identity.export": "That an identity backup was downloaded",
  "results.print": "That a results sheet was printed",
  "results.export": "That results were exported, and as CSV or Markdown",
};

export interface SanitizedUsageEvent {
  name: EventName;
  dims?: Record<string, string>;
}

/**
 * Returns a fresh copy of the event if it matches `USAGE_SCHEMA` exactly, or
 * null if anything about it doesn't: unknown name, a missing or extra dim, a
 * value outside its list, a non-string. Never trims or coerces; a near-miss is
 * dropped, not repaired.
 */
export function sanitizeUsageEvent(name: unknown, dims: unknown): SanitizedUsageEvent | null {
  if (typeof name !== "string" || !Object.hasOwn(USAGE_SCHEMA, name)) return null;
  const allowed: Record<string, readonly string[]> = USAGE_SCHEMA[name as EventName];
  const expected = Object.keys(allowed);

  if (expected.length === 0) {
    return dims === undefined ? { name: name as EventName } : null;
  }
  if (typeof dims !== "object" || dims === null || Array.isArray(dims)) return null;
  if (Object.getPrototypeOf(dims) !== Object.prototype) return null;

  const given = Object.keys(dims);
  if (given.length !== expected.length) return null;

  const clean: Record<string, string> = {};
  for (const key of expected) {
    if (!Object.hasOwn(dims, key)) return null;
    const value: unknown = (dims as Record<string, unknown>)[key];
    if (typeof value !== "string" || !allowed[key]?.includes(value)) return null;
    clean[key] = value;
  }
  return { name: name as EventName, dims: clean };
}

export interface UsageSink {
  track(name: string, dims?: Record<string, string>): void;
}

const STORAGE_KEY = "openslate.usage-stats";

type Stored = "on" | "off";

/** This page's choice, for when localStorage is unavailable. */
let memoryChoice: Stored | null = null;

function readStored(): Stored | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "on" || v === "off" ? v : memoryChoice;
  } catch {
    return memoryChoice;
  }
}

export function usageEnabled(): boolean {
  return readStored() === "on";
}

let sink: UsageSink | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changed the setting; storage is shared, so just re-read.
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** Takes effect at once: `track` checks the switch on every call. */
export function setUsageEnabled(enabled: boolean): void {
  memoryChoice = enabled ? "on" : "off";
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // Storage unavailable (private mode quotas etc.) — the switch then only
    // lasts for this page load, which still honours the choice right now.
  }
  notify();
}

/** The switch, kept in sync across every component (and tab) that shows it. */
export function useUsageEnabled(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, usageEnabled);
  return [enabled, setUsageEnabled];
}

/** Install the telemetry-collector sink. Events before this are dropped. */
export function setUsageSink(next: UsageSink | null): void {
  sink = next;
}

export function track(event: UsageEvent): void {
  if (!usageEnabled() || !sink) return;
  const clean = sanitizeUsageEvent(event.name, "dims" in event ? event.dims : undefined);
  if (!clean) {
    if (import.meta.env?.DEV) console.warn("[usage] dropped an event outside USAGE_SCHEMA", event);
    return;
  }
  sink.track(clean.name, clean.dims);
}
