import {
  type Poll,
  type PollsLookup,
  type PollsSource,
  type Subject,
  US_STATE_NAMES,
  inferMeasureNumber,
  inferOfficeFromTitle,
  inferUsHouseDistrict,
  inferUsStateCode,
  inferYear,
  isUsStatewide,
} from "@openslate/core";
import { baseUrlFor } from "./routing";

export type { Poll, PollAnswer } from "@openslate/core";

// VoteHub doesn't permit browser-direct (no permissive CORS headers), so the
// routing layer pins this provider to "proxy". The proxy URL flows from
// VITE_API_BASE (apiBase); an empty string means same-origin (Vite dev proxy or a
// sibling deployment).
function pollsUrl(path: string, params?: Record<string, string>): string {
  const search = params ? `?${new URLSearchParams(params).toString()}` : "";
  return `${baseUrlFor("votehub")}${path}${search}`;
}

// ---- VoteHub adapter --------------------------------------------------------

/**
 * VoteHub's subject taxonomy is `<year> <state-name>` (e.g. "2026 California",
 * "2025 New Jersey") for statewide races, with the office encoded in
 * `poll_type` ("governor", "us-senator", "attorney-general", "proposition-50",
 * etc.). House districts are `<year> <STATE-DD>` ("2026 CA-22"), mayors are
 * keyed by city ("2025 New York City"), and primaries append the party
 * ("2026 Texas Democratic").
 *
 * The mapper picks the one key the race's polls would be under:
 * 1. A House race → "<year> <STATE-DD>"
 * 2. A mayor → "<year> <city>", the city read from the title
 * 3. A statewide race VoteHub has a `poll_type` for → "<year> <state-name>"
 *
 * Anything else (a city council seat, a school board, a state legislative
 * district, a statewide office VoteHub doesn't poll) gets no keys. The state
 * rollup can't be filtered down to such a race, and polls about another race
 * read as data about this one.
 */
function voteHubLookup(subject: Subject): PollsLookup {
  const office = inferOfficeFromTitle(subject);
  const year = inferYear(subject);
  const measure = office === "measure" ? inferMeasureNumber(subject) : undefined;

  const keys: string[] = [];
  if (year) {
    if (office === "representative") {
      const district = inferUsHouseDistrict(subject);
      if (district) keys.push(`${year} ${district}`);
    } else if (office === "mayor") {
      const city = mayorCity(subject.title);
      if (city) keys.push(`${year} ${city}`);
    } else if (office && office !== "other" && isUsStatewide(subject)) {
      const stateCode = inferUsStateCode(subject);
      const state = stateCode ? US_STATE_NAMES[stateCode] : undefined;
      if (state && (office !== "measure" || measure)) keys.push(`${year} ${state}`);
    }
  }

  return {
    subjectKeys: keys,
    office,
    ...(year ? { year } : {}),
    ...(measure ? { measure } : {}),
  };
}

/** A House district subject key, as `voteHubLookup` builds it: "2026 CA-22". */
const HOUSE_DISTRICT_KEY = /^\d{4} [A-Z]{2}-\d{2,3}$/;

/** "Oakland Mayor", "Mayor of San Francisco" → the city. */
function mayorCity(title: string): string | undefined {
  const m = /^(?:mayor\s+of\s+(?:the\s+city\s+of\s+)?(.+)|(?:city\s+of\s+)?(.+?)\s+mayor)$/i.exec(
    title.trim(),
  );
  return (m?.[1] ?? m?.[2])?.trim() || undefined;
}

function voteHubMatches(poll: Poll, lookup: PollsLookup): boolean {
  // VoteHub subjects lead with the election year; a poll from another cycle
  // isn't about this race.
  const pollYear = /^(\d{4})\b/.exec(poll.subject ?? "")?.[1];
  if (lookup.year && pollYear && pollYear !== lookup.year) return false;
  return voteHubMatchesOffice(poll, lookup);
}

/** Map our office taxonomy to VoteHub's `poll_type` values. */
function voteHubMatchesOffice(poll: Poll, { office, measure }: PollsLookup): boolean {
  switch (office) {
    case undefined:
    case "other":
      return false;
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
      // VoteHub's poll_type names the measure ("proposition-50"); only its own
      // polls match.
      return measure !== undefined && poll.poll_type === measure.replace(" ", "-");
  }
}

export function createVoteHubSource(): PollsSource {
  return {
    name: "VoteHub",
    url: "https://votehub.com",
    license: "CC BY 4.0",
    lookup: voteHubLookup,
    async pollsForKey(key) {
      // VoteHub's `subject` filter returns nothing for a House district
      // ("2026 CA-22"), though the polls carry that subject. Ask for every
      // House poll instead (one response, HTTP-cached across House pages) and
      // keep the district's.
      const district = HOUSE_DISTRICT_KEY.test(key);
      const params: Record<string, string> = district
        ? { poll_type: "us-representative" }
        : { subject: key };
      const res = await fetch(pollsUrl("/api/polls", params));
      if (!res.ok) throw new Error(`polls lookup failed: HTTP ${res.status}`);
      const polls = (await res.json()) as Poll[];
      return district ? polls.filter((p) => p.subject === key) : polls;
    },
    matches: voteHubMatches,
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
