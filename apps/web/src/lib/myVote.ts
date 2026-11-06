import { type SlatePayload, slatePayloadSchema } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { useMemo } from "react";
import { z } from "zod";
import { expandAdoptions } from "./adoptions";
import { translateSlates } from "./ballotCheck";
import { type DecodedSlate, type DisagreeMode, decodeLocalGuides } from "./collate";
import { slatesCollection } from "./collections";
import { useDecodedSlates as useCheckedSlates } from "./decodedSlates";
import { useKnownIdentities } from "./identities";
import type { Area } from "./jurisdictions";
import { EMPTY_AREA, upgradeArea } from "./jurisdictions";
import { createLocalStore, useLocalStore } from "./localStore";
import { withNicknames } from "./nicknames";
import {
  type Follows,
  isCount,
  isStanding,
  STANDING_COUNT,
  type Standing,
  standingOfCount,
} from "./sources";

export { withNicknames } from "./nicknames";

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
 * Follow choices from before they were numbers: v2's words, else v1's id →
 * followed. Read once, to seed the current store; left in place so an older
 * build in the same browser still finds them.
 */
function earlierFollows(): Follows {
  const stored = (key: string): unknown => JSON.parse(localStorage.getItem(key) ?? "null");
  try {
    const words = stored("openslate.follows.v2");
    if (isRecordOf(words, isStanding)) {
      return Object.fromEntries(
        Object.entries(words).map(([id, standing]) => [id, STANDING_COUNT[standing]]),
      );
    }
    const raw = stored("openslate.follows.v1");
    if (!isRecordOf(raw, isBoolean)) return {};
    return Object.fromEntries(Object.entries(raw).map(([id, followed]) => [id, followed ? 1 : 0]));
  } catch {
    return {};
  }
}

/** Source id → how much it counts. Missing means once (see `countOf`). */
export const followsStore = createLocalStore<Follows>(
  "openslate.follows.v3",
  earlierFollows(),
  (raw) => (isRecordOf(raw, isCount) ? raw : undefined),
);

export const useFollows = () => useLocalStore(followsStore);

/** Set a source's way of counting. One already counting that way keeps its number. */
export function setStanding(sourceId: string, standing: Standing): void {
  followsStore.set((current) => {
    const count = current[sourceId];
    if (count !== undefined && standingOfCount(count) === standing) return current;
    return { ...current, [sourceId]: STANDING_COUNT[standing] };
  });
}

export function setCount(sourceId: string, count: number): void {
  followsStore.set((current) => ({ ...current, [sourceId]: count }));
}

/** Where sources you disagree with count in two-way races (see `DisagreeMode`). */
export const disagreeModeStore = createLocalStore<DisagreeMode>(
  "openslate.disagreeMode.v1",
  "choice",
  (raw) => (raw === "choice" || raw === "side" ? raw : undefined),
);

export const useDisagreeMode = () => useLocalStore(disagreeModeStore);

/** Record 0 for sources nobody decided about yet (bulk "import for comparison"). */
export function defaultToUnfollowed(sourceIds: Iterable<string>): void {
  followsStore.set((current) => {
    const next = { ...current };
    for (const id of sourceIds) if (!(id in next)) next[id] = 0;
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

/**
 * Remove slates from this browser. A source left with none of its slates is
 * marked removed, so nothing adds it back on its own, and its follow choice is
 * forgotten, so importing it again starts fresh. `all` is every slate there is,
 * to tell whether a source has any left.
 */
export function removeSlates(slates: readonly DecodedSlate[], all: readonly DecodedSlate[]): void {
  const going = new Set(slates.map((slate) => slate.token));
  for (const slate of slates) {
    if (slate.local) removeFriendGuide(slate.token);
    else slatesCollection.delete(slate.token);
  }
  const emptied = [...new Set(slates.map((slate) => slate.source.id))].filter((id) =>
    all.every((slate) => slate.source.id !== id || going.has(slate.token)),
  );
  if (emptied.length === 0) return;
  for (const id of emptied) setRemoved(id, true);
  followsStore.set((current) => {
    const next = { ...current };
    for (const id of emptied) delete next[id];
    return next;
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

/**
 * Friends' guides saved unsigned by `d7b8ace`. Nothing new lands here: they stay on
 * the ballot until the voter signs them from the guide card, or removes them.
 */
export const friendGuidesStore = createLocalStore<SlatePayload[]>(
  "openslate.friendGuides.v1",
  [],
  (raw) => {
    const parsed = z.array(slatePayloadSchema).safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  },
);

export function removeFriendGuide(token: string): void {
  friendGuidesStore.set((guides) =>
    decodeLocalGuides(guides)
      .filter((g) => g.token !== token)
      .map((g) => g.payload),
  );
}

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
 * Every imported slate, verified and decoded once, with the positions it
 * adopts from other slates (`expandAdoptions`), choices shown under the ballot
 * listing's spelling where they plainly mean a listed candidate
 * (`translateSlates`), and firsthand sources named by the user's nickname for
 * the issuer when they've set one.
 */
export function useDecodedSlates(): { slates: DecodedSlate[]; isReady: boolean } {
  const { data, isReady } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  const contacts = useKnownIdentities();
  const guides = useLocalStore(friendGuidesStore)[0];
  // Checked a slice at a time (and kept for the next visit), not all at once
  // in this render: every page's layout asks for these, and with a few
  // hundred imported that was a freeze of many seconds on a phone.
  const { slates: checked } = useCheckedSlates(data, { keepForNextVisit: true });
  const decoded = useMemo(
    () =>
      checked
        ? translateSlates(expandAdoptions([...checked, ...decodeLocalGuides(guides)]))
        : NO_SLATES,
    [checked, guides],
  );
  const slates = useMemo(() => withNicknames(decoded, contacts), [decoded, contacts]);
  return { slates, isReady: isReady && checked !== undefined };
}

const NO_SLATES: DecodedSlate[] = [];
