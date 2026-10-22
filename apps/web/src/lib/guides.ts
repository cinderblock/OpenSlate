import {
  type GuideItem,
  type GuideManifest,
  type Subject,
  checkGuideFile,
  parseGuideItem,
  verifyGuide,
} from "@openslate/core";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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
  /** The signed manifest (`guide.jws`); its files are relative to it. */
  url: string;
  /** The key the manifest must be signed with. */
  key: string;
  repo?: string;
}

export interface GuideList {
  version: number;
  guides: GuideEntry[];
}

export function guideListUrl(catalogUrl: string): string {
  return new URL("guides.json", catalogUrl).href;
}

const HOUR = 1000 * 60 * 60;

export function guideListQueryOptions(catalogUrl: string) {
  return {
    queryKey: ["guide-list", catalogUrl] as const,
    queryFn: async (): Promise<GuideEntry[]> => {
      const response = await fetch(guideListUrl(catalogUrl));
      // A catalog without guides is fine: nothing to show.
      if (response.status === 404) return [];
      if (!response.ok) throw new Error(`Voter guide list: HTTP ${response.status}`);
      const list = (await response.json()) as Partial<GuideList>;
      return (list.guides ?? []).filter(
        (g): g is GuideEntry =>
          typeof g?.url === "string" && typeof g.key === "string" && typeof g.election === "string",
      );
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
      const response = await fetch(entry.url);
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

/** A file listed in a verified manifest, fetched and checked against its hash. */
async function fetchGuideFile(
  entry: GuideEntry,
  manifest: GuideManifest,
  path: string,
): Promise<Uint8Array> {
  const response = await fetch(new URL(path, entry.url));
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!(await checkGuideFile(manifest, path, bytes))) {
    throw new Error(`${path} doesn't match the signed guide`);
  }
  return bytes;
}

/** Guides whose election matches and whose area contains the subject's. */
export function guidesFor(entries: GuideEntry[], subject: Subject): GuideEntry[] {
  return entries.filter(
    (g) =>
      g.election === subject.election &&
      (subject.jurisdiction === g.jurisdiction ||
        subject.jurisdiction?.startsWith(`${g.jurisdiction}/`) === true),
  );
}

export interface GuideForSubject {
  entry: GuideEntry;
  manifest: GuideManifest;
  item: GuideItem;
}

/**
 * The voter guide's item for a subject, if any guide in the default catalog
 * covers it. `status` separates "nothing to show" from "couldn't load".
 */
export function useGuideItem(subject: Subject | undefined): {
  guide?: GuideForSubject;
  status: "none" | "loading" | "ready" | "error";
  error?: Error;
} {
  const list = useQuery(guideListQueryOptions(DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG));
  const candidates = useMemo(
    () => (subject && list.data ? guidesFor(list.data, subject) : []),
    [list.data, subject],
  );
  // One guide per election and area in practice; the first that lists the subject wins.
  const entry = candidates[0];
  const manifest = useQuery(guideManifestQueryOptions(entry));
  const key = subject ? subjectKey(subject) : undefined;
  const listed = manifest.data?.items.find((i) => subjectKey(i.subject) === key);
  const item = useQuery({
    queryKey: ["guide-item", entry?.url, listed?.file, manifest.data?.files[listed?.file ?? ""]],
    enabled: entry !== undefined && manifest.data !== undefined && listed !== undefined,
    queryFn: async (): Promise<GuideItem> => {
      if (!entry || !manifest.data || !listed) throw new Error("no guide item");
      return parseGuideItem(await fetchGuideFile(entry, manifest.data, listed.file));
    },
    staleTime: HOUR,
  });

  const error = (list.error ?? manifest.error ?? item.error) as Error | null;
  if (error) return { status: "error", error };
  if (list.isPending || (entry && manifest.isPending) || (listed && item.isPending)) {
    return { status: subject ? "loading" : "none" };
  }
  if (entry && manifest.data && item.data) {
    return { status: "ready", guide: { entry, manifest: manifest.data, item: item.data } };
  }
  return { status: "none" };
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
    staleTime: HOUR,
  });
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
