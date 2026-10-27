import { useLiveQuery } from "@tanstack/react-db";
import { useMemo } from "react";
import { translateSlates } from "./ballotCheck";
import { type DecodedSlate, type DisagreeMode, decodeSlates } from "./collate";
import { slatesCollection } from "./collections";
import type { KnownIdentity } from "./db";
import { useKnownIdentities } from "./identities";
import type { Area } from "./jurisdictions";
import { EMPTY_AREA, upgradeArea } from "./jurisdictions";
import { createLocalStore, useLocalStore } from "./localStore";
import { type Standing, isStanding } from "./sources";

/**
 * Client-side state for the "My vote" mode. All of it stays in this browser.
 */

function isRecordOf<T>(raw: unknown, check: (v: unknown) => v is T): raw is Record<string, T> {
  return (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    Object.values(raw).every((v) => check(v))
  );
}

const isBoolean = (v: unknown): v is boolean => typeof v === "boolean";
const isString = (v: unknown): v is string => typeof v === "string";

/**
 * Follow choices from before you could disagree with a source: id → followed.
 * Read once, to seed the current store; left in place so an older build in the
 * same browser still finds them.
 */
function followsFromV1(): Record<string, Standing> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem("openslate.follows.v1") ?? "null");
    if (!isRecordOf(raw, isBoolean)) return {};
    return Object.fromEntries(
      Object.entries(raw).map(([id, followed]) => [id, followed ? "follow" : "off"]),
    );
  } catch {
    return {};
  }
}

/** Source id → standing. Missing means followed (see `standingOf`). */
export const followsStore = createLocalStore<Record<string, Standing>>(
  "openslate.follows.v2",
  followsFromV1(),
  (raw) => (isRecordOf(raw, isStanding) ? raw : undefined),
);

export const useFollows = () => useLocalStore(followsStore);

export function setStanding(sourceId: string, standing: Standing): void {
  followsStore.set((current) => ({ ...current, [sourceId]: standing }));
}

/** Where sources you disagree with count in two-way races (see `DisagreeMode`). */
export const disagreeModeStore = createLocalStore<DisagreeMode>(
  "openslate.disagreeMode.v1",
  "choice",
  (raw) => (raw === "choice" || raw === "side" ? raw : undefined),
);

export const useDisagreeMode = () => useLocalStore(disagreeModeStore);

/** Record `off` for sources nobody decided about yet (bulk "import for comparison"). */
export function defaultToUnfollowed(sourceIds: Iterable<string>): void {
  followsStore.set((current) => {
    const next = { ...current };
    for (const id of sourceIds) if (!(id in next)) next[id] = "off";
    return next;
  });
}

/**
 * Sources the user removed (Sources → Remove), so nothing adds them back on
 * its own (CatalogUpdater's news coverage). Importing one again clears it.
 */
export const removedSourcesStore = createLocalStore<string[]>(
  "openslate.removedSources.v1",
  [],
  (raw) => (Array.isArray(raw) && raw.every(isString) ? raw : undefined),
);

export function setRemoved(sourceId: string, removed: boolean): void {
  removedSourcesStore.set((current) => {
    const rest = current.filter((id) => id !== sourceId);
    return removed ? [...rest, sourceId] : rest;
  });
}

/** Where the user votes. */
export const areaStore = createLocalStore<Area>("openslate.area.v1", EMPTY_AREA, (raw) => {
  if (typeof raw !== "object" || raw === null) return undefined;
  const { localities, districts, labels, found, recheck, answers } = raw as Partial<Area>;
  if (!Array.isArray(localities) || !localities.every(isString)) return undefined;
  if (!isRecordOf(districts, isString)) return undefined;
  const area: Area = { localities, districts };
  if (isRecordOf(labels, isString)) area.labels = labels;
  if (Array.isArray(found) && found.every(isString)) area.found = found;
  if (Array.isArray(recheck) && recheck.every(isString)) area.recheck = recheck;
  if (isRecordOf(answers, (v): v is boolean => typeof v === "boolean")) area.answers = answers;
  return upgradeArea(area);
});

export const useArea = () => useLocalStore(areaStore);

/** The election My ballot shows, as a date (`2026-11-03`). Empty = pick a default. */
export const myElectionStore = createLocalStore<string>("openslate.myElection.v1", "", (raw) =>
  isString(raw) ? raw : undefined,
);

export const useMyElection = () => useLocalStore(myElectionStore);

/** Local "YYYY-MM-DD". UTC would flip election day to "past" mid-afternoon in the Americas. */
export function localToday(): string {
  return new Date().toLocaleDateString("en-CA");
}

/**
 * Every imported slate, verified and decoded once, with choices shown under
 * the ballot listing's spelling where they plainly mean a listed candidate
 * (`translateSlates`), and firsthand sources named by the user's nickname for
 * the issuer when they've set one.
 */
export function useDecodedSlates(): { slates: DecodedSlate[]; isReady: boolean } {
  const { data, isReady } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  const contacts = useKnownIdentities();
  const decoded = useMemo(() => translateSlates(decodeSlates(data)), [data]);
  const slates = useMemo(() => withNicknames(decoded, contacts), [decoded, contacts]);
  return { slates, isReady };
}

/** Firsthand sources named by the user's nickname for the issuer, where they've set one. */
export function withNicknames(
  slates: DecodedSlate[],
  contacts: Array<Pick<KnownIdentity, "publicKey" | "displayName">>,
): DecodedSlate[] {
  const nicknames = new Map(
    contacts.filter((c) => c.displayName?.trim()).map((c) => [c.publicKey, c.displayName?.trim()]),
  );
  if (nicknames.size === 0) return slates;
  return slates.map((slate) => {
    const nickname = slate.source.secondhand ? undefined : nicknames.get(slate.source.signerKey);
    return nickname ? { ...slate, source: { ...slate.source, name: nickname } } : slate;
  });
}
