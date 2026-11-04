/**
 * A race's count over time: one point per report that changed the race's
 * numbers, timed by the source. Kept the same way by a browser (what it saw
 * while open) and by the relay's recorder (every report it fetched), so the two
 * merge point for point. See plans/live-recorder.md.
 */

export interface HistoryPoint {
  /** The source's time for the report (ms since epoch). */
  at: number;
  /** Percent of precincts reporting, when the source says. */
  p?: number;
  /** Votes per choice, in `RaceHistory.names` order (0 for a choice not in this report). */
  v: number[];
}

export interface RaceHistory {
  /** Choices in the order first seen: a choice keeps its place (and color) for good. */
  names: string[];
  points: HistoryPoint[];
}

/** One choice's votes in a report: a candidate, or Yes / No on a measure. */
export interface HistoryChoice {
  name: string;
  votes: number;
}

/**
 * The race's history with this report added: `choices` in the order the count
 * lists them (most votes first for candidates; Yes then No for a measure).
 * Unchanged (the same object) when the report says what the last point says.
 * Capped to the newest `max` points when given.
 */
export function appendChoices(
  history: RaceHistory | undefined,
  choices: readonly HistoryChoice[],
  p: number | undefined,
  at: number,
  max?: number,
): RaceHistory {
  const names = [...(history?.names ?? [])];
  for (const c of choices) if (!names.includes(c.name)) names.push(c.name);
  const v = names.map((n) => choices.find((c) => c.name === n)?.votes ?? 0);
  const point: HistoryPoint = { at, v, ...(p !== undefined ? { p } : {}) };
  const last = history?.points.at(-1);
  if (
    history &&
    last &&
    last.p === point.p &&
    names.length === history.names.length &&
    last.v.every((n, i) => n === v[i])
  )
    return history;
  // An older point's votes for a newly seen choice: 0, as it wasn't in that report.
  const points = (history?.points ?? []).map((pt) =>
    pt.v.length === names.length
      ? pt
      : { ...pt, v: [...pt.v, ...Array(names.length - pt.v.length).fill(0)] },
  );
  // The same source time twice (a corrected report): the newer replaces it.
  if (points.at(-1)?.at === at) points.pop();
  points.push(point);
  return { names, points: max !== undefined ? points.slice(-max) : points };
}

/**
 * The relay's history of a race with this browser's own points before it: the
 * recorder's points are complete from its first one on; a browser may have seen
 * earlier reports (before the recorder ran). Names merge in first-seen order.
 */
export function mergeHistories(
  server: RaceHistory | undefined,
  local: RaceHistory | undefined,
): RaceHistory | undefined {
  if (!server || server.points.length === 0) return local;
  if (!local || local.points.length === 0) return server;
  const first = server.points[0]?.at ?? Number.POSITIVE_INFINITY;
  const earlier = local.points.filter((pt) => pt.at < first);
  if (earlier.length === 0) return server;
  const names = [...local.names];
  for (const n of server.names) if (!names.includes(n)) names.push(n);
  const remap = (h: RaceHistory) => (pt: HistoryPoint) => ({
    ...pt,
    v: names.map((n) => {
      const i = h.names.indexOf(n);
      return i >= 0 ? (pt.v[i] ?? 0) : 0;
    }),
  });
  return {
    names,
    points: [...earlier.map(remap(local)), ...server.points.map(remap(server))],
  };
}

/** Whether a value read back from storage or the network is a `RaceHistory`. */
export function isRaceHistory(raw: unknown): raw is RaceHistory {
  if (typeof raw !== "object" || raw === null) return false;
  const h = raw as RaceHistory;
  return (
    Array.isArray(h.names) &&
    h.names.every((n) => typeof n === "string") &&
    Array.isArray(h.points) &&
    h.points.every(
      (p) =>
        typeof p === "object" &&
        p !== null &&
        typeof p.at === "number" &&
        Array.isArray(p.v) &&
        p.v.every((n) => typeof n === "number") &&
        (p.p === undefined || typeof p.p === "number"),
    )
  );
}
