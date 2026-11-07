import type { Subject } from "@openslate/core";

const keys = new WeakMap<Subject, string>();

/**
 * Same key the Collate view uses, so picker selections align with grouping.
 * Remembered per subject object: collating a whole catalog asks for each
 * position's key several times, and building it again each time (then hashing
 * a new string in every Map it's looked up in) was most of what collating cost.
 * Subjects aren't changed once made, so the key can't go stale.
 */
export function subjectKey(subject: Subject): string {
  if (subject.id !== undefined) return subject.id;
  let key = keys.get(subject);
  if (key === undefined) {
    key = `t:${subject.title}|j:${subject.jurisdiction ?? ""}|e:${subject.election ?? ""}`;
    keys.set(subject, key);
  }
  return key;
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
