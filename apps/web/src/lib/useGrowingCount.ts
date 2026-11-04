import { startTransition, useEffect, useState } from "react";
import { yieldToPage } from "./decodedSlates";

/**
 * How many of a long list to render now: the first `first` at once, then
 * `step` more each turn the page gets, until all of them are. Hundreds of rows
 * of real controls in one render froze the page for seconds on a phone; this
 * is the same rows, the top ones first, with the page answering in between.
 * Starts over when `items` is a new list (a new search, say).
 */
export function useGrowingCount(items: readonly unknown[], first = 30, step = 30): number {
  const [state, setState] = useState({ items, count: first });
  const count = state.items === items ? state.count : first;

  useEffect(() => {
    if (state.items !== items) {
      setState({ items, count: first });
      return;
    }
    if (count >= items.length) return;
    let live = true;
    void yieldToPage().then(() => {
      if (!live) return;
      // A transition: typing or a click waits for no more of the list.
      startTransition(() =>
        setState((s) => (s.items === items ? { items, count: s.count + step } : s)),
      );
    });
    return () => {
      live = false;
    };
  }, [items, count, state.items, first, step]);

  return Math.min(count, items.length);
}
