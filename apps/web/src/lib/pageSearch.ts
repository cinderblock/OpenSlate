import { useNavigate, useSearch } from "@tanstack/react-router";
import { useDeferredValue, useMemo, useState } from "react";
import { searchTerms } from "./search";

/**
 * The search box at the top of a page, kept in its `?q=` so going to a race
 * and back finds the same list. The URL is the hash (never sent anywhere), and
 * typing replaces it rather than adding history.
 *
 * `query` is what's in the box; `terms` lag it a little (`useDeferredValue`),
 * so a keystroke on a 600-race ballot never waits for the list to redraw.
 */
export function usePageSearch(from: "/" | "/sources") {
  const navigate = useNavigate();
  const { q = "" } = useSearch({ from });
  // The box owns its text: the URL updates after the keystroke, and a
  // controlled input that waited on it would jump its cursor.
  const [query, setQueryState] = useState(q);
  const deferred = useDeferredValue(query);
  const terms = useMemo(() => searchTerms(deferred), [deferred]);

  function setQuery(next: string) {
    setQueryState(next);
    navigate({ to: from, search: next ? { q: next } : {}, replace: true });
  }

  return { query, setQuery, terms, searching: terms.length > 0 };
}
