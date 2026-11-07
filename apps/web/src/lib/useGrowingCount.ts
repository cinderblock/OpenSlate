import { startTransition, useCallback, useEffect, useState } from "react";
import { yieldToPage } from "./decodedSlates";

export interface GrowingOptions {
  /** How many to render at once. */
  first?: number;
  /** How many more each time. */
  step?: number;
  /**
   * Start over at `first` when `items` is a new list (a new search, say).
   * Off for a list that's rebuilt as you work in it (marking a race on My
   * ballot): starting over there would fold away the rows under the pointer.
   */
  restart?: boolean;
}

/**
 * Where the end of the list starts the next rows: within a screen below, or
 * anywhere above. Above counts so a jump past it (the End key, a drag of the
 * scroll bar) still does: it's only told about crossing into this area, and a
 * jump from below the screen to far above it would cross nothing smaller.
 */
const AHEAD = "1000000px 0px 100% 0px";

/**
 * How many of a long list to render: the first `first` at once, then `step`
 * more whenever the end of what's rendered comes within a screen of view.
 * Hundreds of rows of real controls froze the page for seconds on a phone,
 * and rendering them all in the background still cost seconds nobody scrolled
 * to see. Put `sentinel` on an empty element after the rows (`GrowingEnd`).
 * Where the browser can't say what's in view, the rest render in the
 * background, a step each turn the page gets.
 */
export function useGrowingCount(
  items: readonly unknown[],
  { first = 30, step = 30, restart = true }: GrowingOptions = {},
): { count: number; sentinel: (element: Element | null) => void } {
  const [state, setState] = useState({ items, count: first });
  const count = !restart || state.items === items ? state.count : first;
  const [end, setEnd] = useState<Element | null>(null);
  const sentinel = useCallback((element: Element | null) => setEnd(element), []);

  useEffect(() => {
    if (restart && state.items !== items) setState({ items, count: first });
  }, [restart, state.items, items, first]);

  // A new effect per count: observing again reports where the end is now, so
  // a list still short of the screen keeps growing.
  useEffect(() => {
    if (count >= items.length) return;
    let live = true;
    const grow = () =>
      void yieldToPage().then(() => {
        if (!live) return;
        // A transition: typing or a click waits for no more of the list.
        startTransition(() =>
          setState((s) => (!restart || s.items === items ? { items, count: s.count + step } : s)),
        );
      });
    if (typeof IntersectionObserver === "undefined") {
      grow();
      return () => {
        live = false;
      };
    }
    if (!end) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          grow();
        }
      },
      { rootMargin: AHEAD },
    );
    observer.observe(end);
    return () => {
      live = false;
      observer.disconnect();
    };
  }, [items, count, end, step, restart]);

  return { count: Math.min(count, items.length), sentinel };
}
