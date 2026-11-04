/**
 * Format an RFC 3339 / ISO 8601 timestamp as a `YYYY-MM-DD` string in the
 * viewer's local timezone. `2026-06-01T00:00:00Z` viewed from Pacific Time
 * renders as `2026-05-31`. Falls back to the ISO date prefix if the string
 * isn't parseable.
 */
export function formatLocalDate(iso: string | undefined | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Built once: `toLocaleDateString` with options builds a new formatter on every
 * call, and a page listing a few hundred slates spent ~100 ms doing just that.
 */
let electionDateFormat: Intl.DateTimeFormat | undefined;

/** A `YYYY-MM-DD` election date as "Nov 3, 2026" in the viewer's locale (no timezone shift). */
export function formatElectionDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m || !d) return date;
  electionDateFormat ??= new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return electionDateFormat.format(new Date(y, m - 1, d));
}
