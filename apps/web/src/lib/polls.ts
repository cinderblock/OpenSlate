import type { Subject } from "@openslate/core";

export interface PollAnswer {
  choice: string;
  pct: number;
}

export interface Poll {
  id: string;
  poll_type: string;
  pollster: string;
  sample_size?: number;
  population?: string;
  url?: string;
  created_at?: string;
  start_date?: string;
  end_date?: string;
  seat_name?: string;
  subject?: string;
  sponsors?: string[];
  internal?: boolean;
  partisan?: string | null;
  answers: PollAnswer[];
}

// Configured at build time. Empty string = use the dev proxy / same-origin server.
// In production builds that target the standalone web app + Worker, set this to the
// Worker's URL (e.g. `https://polls.openslate.dev`) so /api/polls hits the Worker.
const BASE = (import.meta.env.VITE_POLLS_BASE ?? "").replace(/\/+$/, "");

function pollsUrl(path: string, params?: Record<string, string>): string {
  const search = params ? `?${new URLSearchParams(params).toString()}` : "";
  return `${BASE}${path}${search}`;
}

// Lowercase, non-alphanumerics → hyphens, strip edges. Mirrors how VoteHub appears
// to slugify subjects on their side ("Donald Trump" → "donald-trump").
function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Best-effort: derive a VoteHub `subject` slug from an OpenSlate Subject. */
export function subjectToVoteHubKey(subject: Subject): string {
  return slug(subject.title);
}

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

/** Polls filtered by VoteHub subject key. */
export function pollsBySubjectQueryOptions(subjectKey: string) {
  return {
    queryKey: ["polls", "by-subject", subjectKey] as const,
    queryFn: async (): Promise<Poll[]> => {
      const response = await fetch(pollsUrl("/api/polls", { subject: subjectKey }));
      if (!response.ok) throw new Error(`Polls lookup failed: HTTP ${response.status}`);
      return (await response.json()) as Poll[];
    },
    enabled: subjectKey.length > 0,
    staleTime: 1000 * 60 * 15,
  };
}
