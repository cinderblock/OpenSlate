import type { Subject } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { useMemo } from "react";
import { slatesCollection } from "./collections";
import { useDecodedSlates } from "./decodedSlates";
import { subjectKey } from "./subjectKey";

export { subjectFromKey, subjectKey } from "./subjectKey";

export interface KnownSubject {
  key: string;
  subject: Subject;
  /** Number of distinct issuers who have a position on this subject (0 if unknown). */
  endorserCount: number;
}

export function useImportedSubjects(): KnownSubject[] {
  const { data: rows } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  // Checked a slice at a time through the shared cache, not all at once here.
  const { slates } = useDecodedSlates(rows);
  return useMemo(() => {
    const seen = new Map<string, { subject: Subject; issuers: Set<string> }>();
    for (const { payload } of slates ?? []) {
      const issuer = payload.issuer.key;
      for (const position of payload.positions) {
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
