import { contrastsFromBallot, LEAN_MIN_EVIDENCE, leanOf, type Position } from "@openslate/core";
import { useQuery } from "@tanstack/react-query";
import { createContext, useContext, useMemo } from "react";
import type { DecodedSlate } from "./collate";
import { useDecodedSlates } from "./myVote";
import {
  type Catalog,
  catalogEntryLogoUrl,
  catalogQueryOptions,
  DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG,
} from "./query";
import { isBallotSource, sourceIdOf } from "./sources";

/**
 * What the app knows about an endorser beyond its slates: a logo, and where its
 * picks put it between the Democratic and Republican parties (see `leanOf` in
 * core). Both come from the public catalog when it lists the endorser; the lean
 * falls back to one computed here from imported ballot data.
 */
export interface EndorserInfo {
  /** Absolute URL of the endorser's logo, served by the catalog's host. */
  logo?: string;
  /** `"dark"` when the logo is white-only and goes on a dark tile. */
  logoBackground?: "dark";
  lean?: EndorserLean;
}

export interface EndorserLean {
  /** Contrasted subjects where the endorser took the Democratic / Republican side. */
  left: number;
  right: number;
  /** Where the counts came from: the catalog (every party slate it has) or this browser. */
  via: "catalog" | "local";
}

/** -1 (always the Democratic side) … 1 (always the Republican side), or undefined below the minimum. */
export function leanScore(lean: EndorserLean | undefined): number | undefined {
  if (!lean) return undefined;
  const total = lean.left + lean.right;
  if (total < LEAN_MIN_EVIDENCE) return undefined;
  return (lean.right - lean.left) / total;
}

/**
 * Catalog metadata by source id. A source with entries for several elections
 * adds up their lean counts and keeps the first logo.
 */
export function directoryFromCatalog(
  catalog: Catalog,
  catalogUrl: string,
): Map<string, EndorserInfo> {
  const out = new Map<string, EndorserInfo>();
  for (const entry of catalog.entries) {
    const id = sourceIdOf(entry);
    const info = out.get(id) ?? {};
    if (!info.logo && entry.logo) {
      info.logo = catalogEntryLogoUrl(entry, catalogUrl);
      if (info.logo && entry.logo_background === "dark") info.logoBackground = "dark";
    }
    if (entry.lean) {
      info.lean = {
        left: (info.lean?.left ?? 0) + entry.lean.left,
        right: (info.lean?.right ?? 0) + entry.lean.right,
        via: "catalog",
      };
    }
    out.set(id, info);
  }
  return out;
}

/**
 * Lean counts from what this browser has: Democrat-vs-Republican races in the
 * imported ballot data, and each source's picks in them.
 */
export function localLeans(slates: DecodedSlate[]): Map<string, EndorserLean> {
  const ballot: Position[] = [];
  const bySource = new Map<string, Position[]>();
  for (const slate of slates) {
    if (!slate.valid) continue;
    if (isBallotSource(slate.source)) {
      ballot.push(...slate.payload.positions);
      continue;
    }
    const list = bySource.get(slate.source.id) ?? [];
    list.push(...slate.payload.positions);
    bySource.set(slate.source.id, list);
  }
  const out = new Map<string, EndorserLean>();
  if (ballot.length === 0) return out;
  const contrasts = contrastsFromBallot(ballot);
  for (const [id, positions] of bySource) {
    const { left, right } = leanOf(positions, contrasts);
    if (left + right > 0) out.set(id, { left, right, via: "local" });
  }
  return out;
}

/**
 * Look up endorsers by source id. Reads the default public catalog (cached and
 * persisted like any query, so this costs nothing once the Sources page or the
 * setup has loaded it). Mounted once, by `EndorsersProvider`; components use
 * `useEndorser`.
 */
export function useEndorserDirectory(): (sourceId: string) => EndorserInfo {
  const catalogUrl = DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG;
  const { data: catalog } = useQuery({
    ...catalogQueryOptions(catalogUrl),
    staleTime: 1000 * 60 * 60,
  });
  const { slates } = useDecodedSlates();
  const directory = useMemo(
    () => (catalog ? directoryFromCatalog(catalog, catalogUrl) : new Map<string, EndorserInfo>()),
    [catalog],
  );
  const local = useMemo(() => localLeans(slates), [slates]);
  return useMemo(() => {
    const cache = new Map<string, EndorserInfo>();
    return (sourceId: string) => {
      let info = cache.get(sourceId);
      if (!info) {
        const listed = directory.get(sourceId) ?? NO_INFO;
        const lean = listed.lean ?? local.get(sourceId);
        info = lean && !listed.lean ? { ...listed, lean } : listed;
        cache.set(sourceId, info);
      }
      return info;
    };
  }, [directory, local]);
}

const NO_INFO: EndorserInfo = {};

export const EndorsersContext = createContext<(sourceId: string) => EndorserInfo>(() => NO_INFO);

/** The lookup itself, for components that read many endorsers. */
export function useEndorserLookup(): (sourceId: string) => EndorserInfo {
  return useContext(EndorsersContext);
}

export function useEndorser(sourceId: string): EndorserInfo {
  return useContext(EndorsersContext)(sourceId);
}

/** Words that don't make a good initial. */
const MINOR = new Set(["the", "of", "for", "and", "a", "an", "in", "on", "to", "&"]);

/** "San Francisco Chronicle (editorial board)" → "SF". */
export function initialsOf(name: string): string {
  const words = name
    .replace(/\([^)]*\)/g, " ")
    .split(/[\s\-–—/]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((w) => w && !MINOR.has(w.toLowerCase()));
  const letters = words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "");
  return letters.join("") || "?";
}

/** A steady hue per source, so one endorser keeps its colour everywhere. */
export function hueOf(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % 360;
}

/** A short phrase for a lean score (-1 … 1). */
export function leanWord(score: number): string {
  if (score <= -0.6) return "Sides with Democrats";
  if (score < -0.2) return "Leans Democratic";
  if (score <= 0.2) return "Mixed";
  if (score < 0.6) return "Leans Republican";
  return "Sides with Republicans";
}

/**
 * Stack spectrum markers (`x` from 0 to 1) that would overlap: each goes in
 * the lowest row whose last marker is at least one marker-width to its left.
 * Sorted by `x` first, so rows fill left to right.
 */
export function stackMarkers<T extends { x: number }>(
  items: T[],
  markerPx: number,
  widthPx: number,
): Array<T & { row: number }> {
  const gap = widthPx > 0 ? markerPx / widthPx : 0.08;
  const rowEnds: number[] = [];
  return [...items]
    .sort((a, b) => a.x - b.x)
    .map((item) => {
      let row = rowEnds.findIndex((end) => item.x - end >= gap);
      if (row === -1) {
        row = rowEnds.length;
        rowEnds.push(item.x);
      } else {
        rowEnds[row] = item.x;
      }
      return { ...item, row };
    });
}
