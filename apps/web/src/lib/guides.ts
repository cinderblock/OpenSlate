import {
  checkGuideFile,
  GUIDE_REFERENCES_FILE,
  type GuideItem,
  type GuideManifest,
  type GuideReference,
  measureNumber,
  parseGuideItem,
  parseGuideReferences,
  type ReferencePlace,
  type Subject,
  verifyGuide,
} from "@openslate/core";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG } from "./query";
import { subjectKey } from "./subjects";

/**
 * Voter guides: an election authority's official material about what's on the
 * ballot (candidate statements and photos, a measure's summary, analysis,
 * arguments and full text). Reference material, not positions: shown on the
 * race page, never counted. A catalog lists its guides in `guides.json`
 * beside its `index.json`; each guide is a signed manifest whose files are
 * fetched only when a race page needs them, and checked against its hashes.
 */

export interface GuideEntry {
  election: string;
  jurisdiction: string;
  title?: string;
  /**
   * The jurisdictions the guide has items for. A county guide covers its
   * districts for Congress and the Legislature too, which its own
   * jurisdiction doesn't contain. Without it, the guide covers its
   * jurisdiction and every area inside it.
   */
  covers?: string[];
  /** The signed manifest (`guide.jws`); its files are relative to it. */
  url: string;
  /** The key the manifest must be signed with. */
  key: string;
  repo?: string;
  /**
   * Only in a catalog snapshot: where a file with a name too long for the app's
   * archive was saved, by its path in the manifest. The manifest still names it
   * and checks it by the original path (scripts/snapshot-catalog.ts).
   */
  saved_as?: Record<string, string>;
}

export interface GuideList {
  version: number;
  guides: GuideEntry[];
}

export function guideListUrl(catalogUrl: string): string {
  return new URL("guides.json", catalogUrl).href;
}

/**
 * The usable entries of a guide list, each `url` made absolute. A list may
 * name its guides relative to itself: a catalog snapshot carries its guides
 * along (scripts/snapshot-catalog.ts).
 */
export function parseGuideList(list: Partial<GuideList>, listUrl: string): GuideEntry[] {
  return (list.guides ?? [])
    .filter(
      (g): g is GuideEntry =>
        typeof g?.url === "string" && typeof g.key === "string" && typeof g.election === "string",
    )
    .flatMap((g) => {
      try {
        return [{ ...g, url: new URL(g.url, listUrl).href }];
      } catch {
        return [];
      }
    });
}

const HOUR = 1000 * 60 * 60;

export function guideListQueryOptions(catalogUrl: string) {
  return {
    queryKey: ["guide-list", catalogUrl] as const,
    queryFn: async (): Promise<GuideEntry[]> => {
      const listUrl = guideListUrl(catalogUrl);
      const response = await fetch(listUrl);
      // A catalog without guides is fine: nothing to show.
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(`Voter guide list: HTTP ${response.status}`);
      return parseGuideList((await response.json()) as Partial<GuideList>, listUrl);
    },
    staleTime: HOUR,
  };
}

export function guideManifestQueryOptions(entry: GuideEntry | undefined) {
  return {
    queryKey: ["guide-manifest", entry?.url, entry?.key] as const,
    enabled: entry !== undefined,
    queryFn: async (): Promise<GuideManifest> => {
      if (!entry) throw new Error("no guide");
      // Revalidate rather than trust the browser's copy: a guide's files change with it.
      const response = await fetch(entry.url, { cache: "no-cache" });
      if (!response.ok) throw new Error(`Voter guide: HTTP ${response.status}`);
      const result = verifyGuide(await response.text(), { expectedKey: entry.key });
      if (!result.valid || !result.manifest) {
        throw new Error(`Voter guide didn't verify: ${result.errors.join("; ")}`);
      }
      return result.manifest;
    },
    staleTime: HOUR,
  };
}

/**
 * A file whose bytes aren't the ones its manifest lists: one of the two is out
 * of date (the guide was republished), or the file was tampered with.
 */
export class GuideFileMismatch extends Error {}

/** A file listed in a verified manifest, fetched and checked against its hash. */
export async function fetchGuideFile(
  entry: GuideEntry,
  manifest: GuideManifest,
  path: string,
): Promise<Uint8Array> {
  // The browser's cached copy may predate the manifest; ask the server once more before failing.
  for (const cache of ["default", "no-cache"] as const) {
    const response = await fetch(new URL(entry.saved_as?.[path] ?? path, entry.url), { cache });
    if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (await checkGuideFile(manifest, path, bytes)) return bytes;
  }
  throw new GuideFileMismatch(`${path} doesn't match the signed guide`);
}

const retryUnlessMismatch = (failures: number, error: unknown) =>
  !(error instanceof GuideFileMismatch) && failures < 3;

/**
 * When a file doesn't match, the manifest may be the stale one: it is cached,
 * and kept across visits, for an hour. Fetch it again, once for each file and
 * hash it lists, so a file that really was tampered with doesn't loop.
 */
function useRefetchManifestOnMismatch(
  entry: GuideEntry | undefined,
  manifest: GuideManifest | undefined,
  path: string | undefined,
  error: unknown,
): void {
  const queryClient = useQueryClient();
  const tried = useRef(new Set<string>());
  useEffect(() => {
    if (!entry || !manifest || !path || !(error instanceof GuideFileMismatch)) return;
    const attempt = `${entry.url}|${path}|${manifest.files[path] ?? ""}`;
    if (tried.current.has(attempt)) return;
    tried.current.add(attempt);
    void queryClient.invalidateQueries({ queryKey: guideManifestQueryOptions(entry).queryKey });
  }, [entry, manifest, path, error, queryClient]);
}

/** Guides for the subject's election that cover its area, in catalog order. */
export function guidesFor(entries: GuideEntry[], subject: Subject): GuideEntry[] {
  const area = subject.jurisdiction;
  if (!area) return [];
  const within = (outer: string) => area === outer || area.startsWith(`${outer}/`);
  return entries.filter(
    (g) =>
      g.election === subject.election &&
      (g.covers ? g.covers.some(within) : within(g.jurisdiction)),
  );
}

export interface GuideForSubject {
  entry: GuideEntry;
  manifest: GuideManifest;
  item: GuideItem;
}

/**
 * Whether a voter guide in the default catalog lists the subject. Reads only
 * the guides' manifests, which every race shares, so a ballot of cards can ask
 * without fetching each item.
 */
export function useGuideListed(subject: Subject): boolean {
  const list = useQuery(guideListQueryOptions(DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG));
  const entries = useMemo(
    () => (list.data ? guidesFor(list.data, subject) : []),
    [list.data, subject],
  );
  const manifests = useQueries({ queries: entries.map((e) => guideManifestQueryOptions(e)) });
  const key = subjectKey(subject);
  return manifests.some((m) => m.data?.items.some((it) => subjectKey(it.subject) === key));
}

/**
 * Every subject the default catalog's voter guides list for an election and
 * area, from their manifests only: what a race link can name before any slate
 * is imported. `pending` until the guide list and each manifest has answered
 * (a failed one counts as answered).
 */
export function useGuideSubjects(where: { jurisdiction?: string; election?: string } | undefined): {
  subjects: Subject[];
  pending: boolean;
} {
  const list = useQuery(guideListQueryOptions(DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG));
  const entries = useMemo(
    () => (where && list.data ? guidesFor(list.data, { title: "", ...where }) : []),
    [list.data, where],
  );
  const manifests = useQueries({ queries: entries.map((e) => guideManifestQueryOptions(e)) });
  const pending = Boolean(where) && (list.isPending || manifests.some((m) => m.isPending));
  const subjects = manifests.flatMap((m) => m.data?.items.map((it) => it.subject) ?? []);
  return { subjects, pending };
}

/**
 * The voter guide's item for a subject, from the first guide in the default
 * catalog that lists it (a district can appear in several county guides).
 * `status` separates "nothing to show" from "couldn't load".
 */
export function useGuideItem(subject: Subject | undefined): {
  guide?: GuideForSubject;
  status: "none" | "loading" | "ready" | "error";
  error?: Error;
} {
  const list = useQuery(guideListQueryOptions(DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG));
  const entries = useMemo(
    () => (subject && list.data ? guidesFor(list.data, subject) : []),
    [list.data, subject],
  );
  const manifests = useQueries({ queries: entries.map((e) => guideManifestQueryOptions(e)) });
  const key = subject ? subjectKey(subject) : undefined;
  const found = manifests
    .map((m, i) => ({
      entry: entries[i],
      manifest: m.data,
      listed: m.data?.items.find((it) => subjectKey(it.subject) === key),
    }))
    .find((m) => m.listed);
  const { entry, manifest, listed } = found ?? {};
  const item = useQuery({
    queryKey: ["guide-item", entry?.url, listed?.file, manifest?.files[listed?.file ?? ""]],
    enabled: entry !== undefined && manifest !== undefined && listed !== undefined,
    queryFn: async (): Promise<GuideItem> => {
      if (!entry || !manifest || !listed) throw new Error("no guide item");
      return parseGuideItem(await fetchGuideFile(entry, manifest, listed.file));
    },
    retry: retryUnlessMismatch,
    staleTime: HOUR,
  });
  useRefetchManifestOnMismatch(entry, manifest, listed?.file, item.error);

  if (entry && manifest && item.data) {
    return { status: "ready", guide: { entry, manifest, item: item.data } };
  }
  const error = (list.error ?? item.error ?? manifests.find((m) => m.error)?.error) as
    | Error
    | null
    | undefined;
  // A guide that failed only matters if no other guide has the subject.
  if (found && item.error) return { status: "error", error: item.error as Error };
  if (list.isPending || manifests.some((m) => m.isPending) || (found && item.isPending)) {
    return { status: subject ? "loading" : "none" };
  }
  if (error) return { status: "error", error };
  return { status: "none" };
}

const measureKeys = new WeakMap<GuideManifest, Map<string, string>>();

/** Each numbered measure in a guide, by number: the race key to link it to. */
export function guideMeasureKeys(manifest: GuideManifest): Map<string, string> {
  let keys = measureKeys.get(manifest);
  if (!keys) {
    keys = new Map();
    for (const { subject } of manifest.items) {
      const number = measureNumber(subject);
      if (number) keys.set(number, subjectKey(subject));
    }
    measureKeys.set(manifest, keys);
  }
  return keys;
}

/** What else in the race's voter guide mentions it. Empty when nothing does. */
export function useGuideReferences(guide: GuideForSubject | undefined): GuideReference[] {
  const entry = guide?.entry;
  const manifest = guide?.manifest;
  const hash = manifest?.files[GUIDE_REFERENCES_FILE];
  const file = useQuery({
    queryKey: ["guide-references", entry?.url, hash],
    enabled: hash !== undefined,
    queryFn: async () => {
      if (!entry || !manifest) throw new Error("no guide");
      const bytes = await fetchGuideFile(entry, manifest, GUIDE_REFERENCES_FILE);
      return parseGuideReferences(bytes).references;
    },
    retry: retryUnlessMismatch,
    staleTime: HOUR,
  });
  useRefetchManifestOnMismatch(entry, manifest, GUIDE_REFERENCES_FILE, file.error);
  return useMemo(
    () => (guide ? referencesTo(file.data ?? [], subjectKey(guide.item.subject)) : []),
    [file.data, guide],
  );
}

/** The references to a race, in title order, numbers in order. */
export function referencesTo(references: GuideReference[], key: string): GuideReference[] {
  return references
    .filter((reference) => subjectKey(reference.to) === key)
    .sort((a, b) => a.from.title.localeCompare(b.from.title, undefined, { numeric: true }));
}

/** Where in an item a mention is, as the race page shows it. */
export function referencePlaceLabel({ part, choice }: ReferencePlace): string {
  switch (part) {
    case "about":
      return "Overview";
    case "means":
      return `What “${choice}” means`;
    case "summary":
      return "Official summary";
    case "analysis":
      return "Analysis";
    case "argument":
      return `Argument for “${choice}”`;
    case "rebuttal":
      return `Rebuttal for “${choice}”`;
    case "paid-argument":
      return `Paid argument for “${choice}”`;
    case "signer":
      return `Signer of the argument for “${choice}”`;
    case "statement":
      return `Statement of ${choice}`;
    case "full-text":
      return "Full text";
  }
}

/**
 * An object URL for a guide file (a photo, a figure, a PDF), once it has been
 * fetched and checked against the signed manifest. Revoked on unmount.
 */
export function useGuideFileUrl(
  guide: Pick<GuideForSubject, "entry" | "manifest">,
  path: string | undefined,
  mediaType?: string,
): { url?: string; error?: Error } {
  const file = useQuery({
    queryKey: ["guide-file", guide.entry.url, path, path ? guide.manifest.files[path] : undefined],
    enabled: path !== undefined,
    queryFn: async () => {
      if (!path) throw new Error("no file");
      return await fetchGuideFile(guide.entry, guide.manifest, path);
    },
    retry: retryUnlessMismatch,
    staleTime: HOUR,
  });
  useRefetchManifestOnMismatch(guide.entry, guide.manifest, path, file.error);
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!file.data) return;
    const blob = new Blob([new Uint8Array(file.data)], mediaType ? { type: mediaType } : {});
    const objectUrl = URL.createObjectURL(blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file.data, mediaType]);
  return { url, error: (file.error as Error | null) ?? undefined };
}
