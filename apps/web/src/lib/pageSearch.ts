import { useNavigate, useSearch } from "@tanstack/react-router";
import { useDeferredValue, useMemo, useState } from "react";
import { searchTerms } from "./search";

/** The pages with a search box at the top, each keeping it in its `?q=`. */
export type SearchablePage =
  | "/"
  | "/sources"
  | "/results"
  | "/results/$token"
  | "/publish"
  | "/publish/elections";

export interface PageSearchState {
  /** What's in the box. */
  query: string;
  setQuery: (next: string) => void;
  /** The query's words (`searchTerms`), a little behind `query`. */
  terms: string[];
  searching: boolean;
}

/**
 * A search box's state, without a URL: for one inside a dialog.
 *
 * `terms` lag `query` a little (`useDeferredValue`), so a keystroke on a
 * 600-race ballot never waits for the list to redraw.
 */
export function useSearchBox(initial = "", onChange?: (next: string) => void): PageSearchState {
  const [query, setQueryState] = useState(initial);
  const deferred = useDeferredValue(query);
  const terms = useMemo(() => searchTerms(deferred), [deferred]);

  function setQuery(next: string) {
    setQueryState(next);
    onChange?.(next);
  }

  return { query, setQuery, terms, searching: terms.length > 0 };
}

/**
 * The search box at the top of a page, kept in its `?q=` so going to a race
 * and back finds the same list. The URL is the hash (never sent anywhere), and
 * typing replaces it rather than adding history.
 */
export function usePageSearch(from: SearchablePage): PageSearchState {
  const navigate = useNavigate({ from });
  const { q = "" } = useSearch({ from });
  // The box owns its text: the URL updates after the keystroke, and a
  // controlled input that waited on it would jump its cursor.
  return useSearchBox(q, (next) => {
    navigate({ search: next ? { q: next } : {}, replace: true });
  });
}
