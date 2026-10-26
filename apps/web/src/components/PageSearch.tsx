import type { ReactNode } from "react";
import type { PageSearchState } from "../lib/pageSearch";
import { SearchField } from "./ui/TextField";

/**
 * The search box at the top of a list page, with a line under it while
 * searching: how many match (`matchCount`), or why nothing does.
 */
export function PageSearch({
  search,
  label,
  placeholder,
  children,
}: {
  search: PageSearchState;
  /** Names the box for screen readers: "Search the ballot". */
  label: string;
  placeholder: string;
  /** The line under the box, shown only while searching. */
  children?: ReactNode;
}) {
  return (
    <div className="page-search no-print">
      <SearchField
        aria-label={label}
        placeholder={placeholder}
        value={search.query}
        onChange={search.setQuery}
      />
      {search.searching && children != null && (
        <p className="hint" aria-live="polite">
          {children}
        </p>
      )}
    </div>
  );
}

/**
 * "3 of 40 slates match.", or "Nothing matches “x”." when none do. `noun` is
 * plural; a count of one drops its "s".
 */
export function matchCount(shown: number, total: number, noun: string, query: string): string {
  if (shown === 0) return `Nothing matches “${query.trim()}”.`;
  const word = total === 1 ? noun.replace(/s$/, "") : noun;
  return `${shown} of ${total} ${word} match${shown === 1 ? "es" : ""}.`;
}
