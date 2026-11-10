import { type Subject, verifySlate } from "@openslate/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchCatalogSlate } from "../../catalogImport";
import { catalogQueryOptions, DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG } from "../../query";
import { candidatesByContest, SOS_ELECTION } from "./sosResults";

/** The catalog's transcription of the Secretary of State's certified candidate list. */
const SLUG = "ca-secretary-of-state";

const EMPTY: Record<string, string[]> = {};

/**
 * Who's running in each of the state's contests, so the race picker finds a
 * race by a candidate's name. One slate from the catalog (not the whole
 * catalog), fetched only while `enabled`; empty until it arrives, or when the
 * catalog doesn't have it.
 */
export function useSosCandidates(enabled: boolean): Record<string, string[]> {
  const queryClient = useQueryClient();
  const catalogUrl = DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG;
  const catalog = useQuery({ ...catalogQueryOptions(catalogUrl), enabled });
  const entry = catalog.data?.entries.find((e) => e.slug === SLUG && e.election === SOS_ELECTION);
  const names = useQuery({
    queryKey: ["sos-candidates", entry?.path ?? null] as const,
    queryFn: async (): Promise<Record<string, string[]>> => {
      if (!entry) return EMPTY;
      const result = verifySlate(await fetchCatalogSlate(entry, catalogUrl, queryClient));
      const positions = (result.valid ? result.payload?.positions : undefined) ?? [];
      // A plain object: the query cache is kept in IndexedDB between visits.
      return Object.fromEntries(
        candidatesByContest(positions as readonly { subject: Subject; choice?: string }[]),
      );
    },
    enabled: enabled && Boolean(entry),
    staleTime: 1000 * 60 * 60,
  });
  return names.data ?? EMPTY;
}
