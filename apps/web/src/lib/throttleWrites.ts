/**
 * `write`, at most once every `ms`: the last value asked for is the one
 * written, `ms` after the first ask (trailing, as TanStack's own async
 * persister does). For caches kept whole in IndexedDB, where each write
 * copies everything (query.ts's query cache, decodedSlates.ts's verified
 * slates): many small changes in a moment cost one copy, not one each.
 */
export function throttleWrites<T>(
  write: (value: T) => Promise<unknown>,
  ms: number,
  // Called, not passed: a browser's setTimeout called as a method throws "Illegal invocation".
  timer: { set: (fn: () => void, ms: number) => unknown } = {
    set: (fn, ms) => setTimeout(fn, ms),
  },
): (value: T) => void {
  let pending: { value: T } | undefined;
  return (value) => {
    const waiting = pending !== undefined;
    pending = { value };
    if (waiting) return;
    timer.set(() => {
      const next = pending;
      pending = undefined;
      // A cache: one that didn't save is worked out again next visit.
      if (next) void write(next.value).catch(() => undefined);
    }, ms);
  };
}
