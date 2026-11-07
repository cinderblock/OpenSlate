/**
 * `fn`, remembering its answer for each string it's asked about. For pure
 * functions of a string that a collation asks about tens of thousands of
 * times over a few hundred distinct values (a jurisdiction path, a candidate's
 * name). Forgets everything past `limit` entries, so a long visit can't grow it
 * without bound. Answers are frozen: they're shared between every caller.
 */
export function memoByString<T>(fn: (value: string) => T, limit = 20_000): (value: string) => T {
  const known = new Map<string, T>();
  return (value) => {
    const hit = known.get(value);
    if (hit !== undefined || known.has(value)) return hit as T;
    if (known.size >= limit) known.clear();
    const answer = fn(value);
    known.set(
      value,
      typeof answer === "object" && answer !== null ? Object.freeze(answer) : answer,
    );
    return answer;
  };
}
