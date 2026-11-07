import { startTransition, useEffect, useState } from "react";
import { yieldToPage } from "./decodedSlates";

export interface GrowingOptions {
  /** How many to render at once. */
  first?: number;
  /** How many more each turn the page gets. */
  step?: number;
  /**
   * Start over at `first` when `items` is a new list (a new search, say).
   * Off for a list that's rebuilt as you work in it (marking a race on My
   * ballot): starting over there would fold away the rows under the pointer.
   */
  restart?: boolean;
}

/**
 * How many of a long list to render now: the first `first` at once, then
 * `step` more each turn the page gets, until all of them are. Hundreds of rows
 * of real controls in one render froze the page for seconds on a phone; this
 * is the same rows, the top ones first, with the page answering in between.
 */
export function useGrowingCount(
  items: readonly unknown[],
  { first = 30, step = 30, restart = true }: GrowingOptions = {},
): number {
  const [state, setState] = useState({ items, count: first });
  const count = !restart || state.items === items ? state.count : first;

  useEffect(() => {
    if (restart && state.items !== items) {
      setState({ items, count: first });
      return;
    }
    if (count >= items.length) return;
    let live = true;
    void yieldToPage().then(() => {
      if (!live) return;
      // A transition: typing or a click waits for no more of the list.
      startTransition(() =>
        setState((s) => (!restart || s.items === items ? { items, count: s.count + step } : s)),
      );
    });
    return () => {
      live = false;
    };
  }, [items, count, state.items, first, step, restart]);

  return Math.min(count, items.length);
}
