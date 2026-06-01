import {
  type OfficeKind,
  type Poll,
  type PollsLookup,
  type PollsSource,
  type Subject,
  US_STATE_NAMES,
  inferOfficeFromTitle,
  inferUsHouseDistrict,
  inferUsStateCode,
  inferYear,
} from "@openslate/core";

export type { Poll, PollAnswer } from "@openslate/core";

// Configured at build time. Empty string = use the dev proxy / same-origin server.
const BASE = (import.meta.env.VITE_POLLS_BASE ?? "").replace(/\/+$/, "");

function pollsUrl(path: string, params?: Record<string, string>): string {
  const search = params ? `?${new URLSearchParams(params).toString()}` : "";
  return `${BASE}${path}${search}`;
}

// ---- VoteHub adapter --------------------------------------------------------

/**
 * VoteHub's subject taxonomy is `<year> <state-name>` (e.g. "2026 California",
 * "2025 New Jersey") with the office encoded in `poll_type` ("governor",
 * "us-senator", "us-representative", "attorney-general", "mayor",
 * "proposition-50", etc.). For House districts they use `<year> <STATE-DD>`
 * (e.g. "2026 CA-22"). Primary races append the party: "2026 Texas Democratic".
 *
 * The mapper:
 * 1. Detects a House district pattern in the title → "<year> <STATE-DD>"
 * 2. Builds "<year> <state-name>" from jurisdiction + election year
 * 3. Falls back to bare "<state-name>" so multi-cycle subjects ("California"
 *    has 11 polls of various years) still surface anything
 * 4. As a last resort tries the literal title slug — preserves the legacy
 *    behaviour for subjects that happen to match VoteHub keys verbatim
 *
 * Office filtering is done by the caller via `matchesOffice` so the panel
 * doesn't show Prop 50 polls under a Governor subject.
 */
function voteHubLookup(subject: Subject): PollsLookup {
  const office = inferOfficeFromTitle(subject);
  const year = inferYear(subject);
  const stateCode = inferUsStateCode(subject);
  const state = stateCode ? US_STATE_NAMES[stateCode] : undefined;
  const district = inferUsHouseDistrict(subject);

  const keys: string[] = [];
  if (year && district) keys.push(`${year} ${district}`);
  if (year && state) keys.push(`${year} ${state}`);
  if (state) keys.push(state);
  // Legacy fallback: literal slug. Won't usually match but doesn't hurt.
  const titleSlug = slug(subject.title);
  if (titleSlug && !keys.includes(titleSlug)) keys.push(titleSlug);

  return { subjectKeys: keys, office };
}

/** Map our office taxonomy to VoteHub's `poll_type` values. */
function voteHubMatchesOffice(poll: Poll, office: OfficeKind | undefined): boolean {
  if (!office || office === "other") return true;
  switch (office) {
    case "governor":
      return poll.poll_type === "governor";
    case "senator":
      return poll.poll_type === "us-senator";
    case "representative":
      return poll.poll_type === "us-representative";
    case "attorney_general":
      return poll.poll_type === "attorney-general";
    case "secretary_of_state":
      return poll.poll_type === "secretary-of-state";
    case "treasurer":
      return poll.poll_type === "treasurer";
    case "mayor":
      return poll.poll_type === "mayor";
    case "president":
      return poll.poll_type === "president" || poll.poll_type === "presidential-primary";
    case "measure":
      // VoteHub keys measures by their popular name ("proposition-50",
      // "amendment-1"). Match the prefix family.
      return /^(?:proposition|amendment|measure|referendum)/.test(poll.poll_type);
  }
}

export function createVoteHubSource(): PollsSource {
  return {
    name: "VoteHub",
    url: "https://votehub.com",
    license: "CC BY 4.0",
    lookup: voteHubLookup,
    async pollsForKey(key) {
      const res = await fetch(pollsUrl("/api/polls", { subject: key }));
      if (!res.ok) throw new Error(`polls lookup failed: HTTP ${res.status}`);
      return (await res.json()) as Poll[];
    },
    matchesOffice: voteHubMatchesOffice,
  };
}

export const pollsSource: PollsSource = createVoteHubSource();

// ---- Slug helper ------------------------------------------------------------

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ---- Legacy export (for any caller still using the old key shape) ----------

/**
 * Best-effort: derive a VoteHub `subject` slug from an OpenSlate Subject.
 * Kept for back-compat; new code SHOULD call `pollsSource.lookup(subject)`.
 */
export function subjectToVoteHubKey(subject: Subject): string {
  return pollsSource.lookup(subject).subjectKeys[0] ?? slug(subject.title);
}

// ---- TanStack-Query options ------------------------------------------------

export function subjectsQueryOptions() {
  return {
    queryKey: ["polls", "subjects"] as const,
    queryFn: async (): Promise<string[]> => {
      const response = await fetch(pollsUrl("/api/subjects"));
      if (!response.ok) throw new Error(`Subjects lookup failed: HTTP ${response.status}`);
      return (await response.json()) as string[];
    },
    staleTime: 1000 * 60 * 15,
  };
}

export function pollTypesQueryOptions() {
  return {
    queryKey: ["polls", "types"] as const,
    queryFn: async (): Promise<string[]> => {
      const response = await fetch(pollsUrl("/api/poll-types"));
      if (!response.ok) throw new Error(`Poll types lookup failed: HTTP ${response.status}`);
      return (await response.json()) as string[];
    },
    staleTime: 1000 * 60 * 60,
  };
}

/** Polls filtered by a single provider subject key. */
export function pollsBySubjectQueryOptions(subjectKey: string) {
  return {
    queryKey: ["polls", "by-subject", subjectKey] as const,
    queryFn: async (): Promise<Poll[]> => pollsSource.pollsForKey(subjectKey),
    enabled: subjectKey.length > 0,
    staleTime: 1000 * 60 * 15,
  };
}
