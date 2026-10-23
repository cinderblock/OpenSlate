import { type Subject, verifySlate } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { useMemo } from "react";
import { slatesCollection } from "./collections";

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

/**
 * The subject a `subjectKey` was made from, for the `t:|j:|e:` form, so a race
 * link names its race before any slate with it is imported. Jurisdiction and
 * election never hold a `|`, so a title that does still parses. Undefined for
 * an `id` key, which doesn't carry the subject.
 */
export function subjectFromKey(key: string): Subject | undefined {
  const m = /^t:(.+)\|j:([^|]*)\|e:([^|]*)$/s.exec(key);
  if (!m?.[1]) return undefined;
  const [, title, jurisdiction, election] = m;
  return {
    title,
    ...(jurisdiction ? { jurisdiction } : {}),
    ...(election ? { election } : {}),
  };
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
