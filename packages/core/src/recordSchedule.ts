/**
 * When the relay's recorder checks a source next (plans/live-recorder.md):
 *
 * - Election night, from polls closing until 2 AM: every minute.
 * - After that, every minute for an hour after the source last changed, then
 *   the gap doubles each quiet hour, up to hourly: a source that reports through
 *   the night is followed closely, and one that's gone quiet is checked hourly
 *   by morning. A new report brings it back to every minute.
 * - Around a release time a county announced: every 15 s from 5 minutes before
 *   until 20 minutes after, or until the new report lands (cheap checks only:
 *   Clarity's version pointer, or a conditional GET).
 * - Until the count is certified. "100% of precincts" is not the end in
 *   California: mail and provisional ballots are counted for weeks after.
 */

export interface ElectionClock {
  /** Polls close: the first results follow. */
  pollsClose: number;
  /** Election night's every-minute checks end. */
  nightEnd: number;
  /** The count is certified: checks stop. */
  stop: number;
}

/** The 2026-11-03 California general (Pacific Standard Time after Nov 1). */
export const CA_2026_GENERAL: ElectionClock = {
  // 8:00 PM PST Nov 3 (04:00Z Nov 4).
  pollsClose: Date.parse("2026-11-04T04:00:00Z"),
  // 2:00 AM PST Nov 4 (10:00Z).
  nightEnd: Date.parse("2026-11-04T10:00:00Z"),
  // The Secretary of State certifies by the 38th day, Dec 11; stop at the end of it (Dec 12 08:00Z).
  stop: Date.parse("2026-12-12T08:00:00Z"),
};

/**
 * Release times counties announced ("next update: Friday 5 PM"), by feed
 * (`sos-ca` or a county slug), ms since epoch. Hand-kept: add one when a county
 * posts its schedule. See plans/live-recorder.md for sources.
 */
export const RELEASE_TIMES: Record<string, string[]> = {
  // "Updates every Tuesday and Friday until certification", each "by 4:15 pm",
  // the first Friday Nov 6, and one Monday Nov 16 (time not given: taken as the
  // same). Checked 2026-11-04 on
  // elections.saccounty.gov/…/november-3--2026--general-election-results-schedule.html.
  // Listed at 4:05 PM PST (00:05Z next day), so the window spans 4:00–4:25.
  sacramento: [
    "2026-11-07T00:05:00Z",
    "2026-11-11T00:05:00Z",
    "2026-11-14T00:05:00Z",
    "2026-11-17T00:05:00Z",
    "2026-11-18T00:05:00Z",
    "2026-11-21T00:05:00Z",
    "2026-11-25T00:05:00Z",
    "2026-11-28T00:05:00Z",
    "2026-12-02T00:05:00Z",
  ],
  // 6 PM Thu Nov 5 and Fri Nov 6, then "by 6 p.m." Mon Nov 9 (Times of San
  // Diego's report of the Registrar's schedule, 2026-11-03; sdvote.com posts
  // none). Listed at 5:55 PM PST (01:55Z next day): window 5:50–6:15.
  "san-diego": ["2026-11-06T01:55:00Z", "2026-11-07T01:55:00Z", "2026-11-10T01:55:00Z"],
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const QUICK_CHECK_MS = 15_000;
const WINDOW_BEFORE = 5 * MINUTE;
const WINDOW_AFTER = 20 * MINUTE;

export interface CheckPlan {
  /** When to check, ms since epoch. */
  at: number;
  /** Only the cheap check (a release window): the version pointer, or a conditional GET. */
  quick: boolean;
}

/** Announced release times for a feed, parsed. */
export function releaseTimes(feed: string, times = RELEASE_TIMES): number[] {
  return (times[feed] ?? []).map((t) => Date.parse(t)).filter(Number.isFinite);
}

/**
 * The next check, given when the source last changed (`lastChangeAt`, its new
 * report seen by the recorder), or null once the count is done.
 */
export function nextCheck(
  now: number,
  lastChangeAt: number | undefined,
  releases: readonly number[],
  clock: ElectionClock,
): CheckPlan | null {
  if (now >= clock.stop) return null;
  // In a release window, until the report it promised lands.
  for (const r of releases) {
    if (
      now >= r - WINDOW_BEFORE &&
      now < r + WINDOW_AFTER &&
      !(lastChangeAt && lastChangeAt >= r - WINDOW_BEFORE)
    )
      return { at: now + QUICK_CHECK_MS, quick: true };
  }
  let gap: number;
  if (now < clock.pollsClose) gap = Math.min(HOUR, Math.max(MINUTE, clock.pollsClose - now));
  else if (now < clock.nightEnd) gap = MINUTE;
  else {
    const quiet = now - Math.max(lastChangeAt ?? clock.pollsClose, clock.pollsClose);
    gap = quiet < HOUR ? MINUTE : Math.min(HOUR, MINUTE * 2 ** Math.floor(quiet / HOUR));
  }
  let at = Math.min(now + gap, clock.stop);
  // Don't sleep through the start of a release window.
  for (const r of releases)
    if (r - WINDOW_BEFORE > now && r - WINDOW_BEFORE < at) at = r - WINDOW_BEFORE;
  return { at, quick: false };
}
