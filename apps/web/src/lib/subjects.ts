import { type Subject, verifySlate } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { slatesCollection } from "./collections";
import { type BallotContest, ballotQueryOptions } from "./query";

export interface KnownSubject {
  key: string;
  subject: Subject;
  /** Number of distinct issuers who have a position on this subject (0 if unknown). */
  endorserCount: number;
}

/** Same key the Collate view uses, so picker selections align with grouping. */
export function subjectKey(subject: Subject): string {
  return (
    subject.id ?? `t:${subject.title}|j:${subject.jurisdiction ?? ""}|e:${subject.election ?? ""}`
  );
}

export function useImportedSubjects(): KnownSubject[] {
  const { data: slates } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  return useMemo(() => {
    const seen = new Map<string, { subject: Subject; issuers: Set<string> }>();
    for (const { token } of slates) {
      const result = verifySlate(token);
      if (!result.payload) continue;
      const issuer = result.payload.issuer.key;
      for (const position of result.payload.positions) {
        const key = subjectKey(position.subject);
        const entry = seen.get(key);
        if (entry) entry.issuers.add(issuer);
        else seen.set(key, { subject: position.subject, issuers: new Set([issuer]) });
      }
    }
    return [...seen.entries()]
      .map(
        ([key, value]): KnownSubject => ({
          key,
          subject: value.subject,
          endorserCount: value.issuers.size,
        }),
      )
      .sort((a, b) => a.subject.title.localeCompare(b.subject.title));
  }, [slates]);
}

/** Raw ballot contests + candidates from the server proxy. Drives the BallotComposer. */
export function useBallotContests(
  address: string,
  electionId?: string,
): {
  contests: BallotContest[];
  isLoading: boolean;
  error: Error | null;
  enabled: boolean;
} {
  const query = useQuery(ballotQueryOptions(address, electionId));
  return {
    contests: query.data ?? [],
    isLoading: query.isFetching && query.fetchStatus !== "idle",
    error: query.error ?? null,
    enabled: address.trim().length > 0,
  };
}

/**
 * Synthesize ballot contests from already-imported slates for a given election
 * day. Used as a fallback when Civic Info has no contests for the user's
 * address/election (a common case — VIP coverage is spotty). For each subject
 * with `subject.election === electionDay` (or unset), candidate list is the
 * set of distinct non-empty `position.choice` values observed across imports.
 *
 * voteFor is left unset (Civic Info would give "vote for N"; imported data
 * doesn't carry it), so the composer defaults to "vote for one".
 */
export function useImportedBallotContests(electionDay: string): BallotContest[] {
  const { data: slates } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  return useMemo(() => {
    if (!electionDay) return [];
    interface Bucket {
      subject: Subject;
      choices: Set<string>;
    }
    const grouped = new Map<string, Bucket>();
    for (const { token } of slates) {
      const result = verifySlate(token);
      if (!result.payload) continue;
      for (const position of result.payload.positions) {
        const e = position.subject.election;
        if (e && e !== electionDay) continue;
        const key = subjectKey(position.subject);
        let bucket = grouped.get(key);
        if (!bucket) {
          bucket = { subject: position.subject, choices: new Set() };
          grouped.set(key, bucket);
        }
        if (position.choice) bucket.choices.add(position.choice);
      }
    }
    return [...grouped.values()]
      .map(
        ({ subject, choices }): BallotContest => ({
          subject,
          candidates: [...choices].sort().map((name) => ({ name })),
        }),
      )
      .sort((a, b) => a.subject.title.localeCompare(b.subject.title));
  }, [slates, electionDay]);
}
