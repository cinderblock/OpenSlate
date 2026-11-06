import type { Subject } from "@openslate/core";

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
