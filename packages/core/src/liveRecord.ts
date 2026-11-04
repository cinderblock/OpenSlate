/**
 * What the relay's recorder keeps from each report: for every race in it, the
 * choices' votes, the precincts reporting and the source's time, under the same
 * id the web app watches the race by (`governor`, `prop/50`,
 * `county-ca/santa-clara/<key>`). A browser logs the same thing from the same
 * numbers (apps/web/src/lib/raceHistory.ts); test/liveRecord.test.ts and the web
 * app's parity test keep the two alike. See plans/live-recorder.md.
 */

import { type CountyContest, californiaTime } from "./countyResults";
import type { HistoryChoice } from "./raceHistory";

/** One race's numbers in one report. */
export interface RecordEntry {
  /** The race's id on the Results page. */
  id: string;
  choices: HistoryChoice[];
  /** Percent of precincts reporting, when the source says (and any report). */
  p?: number;
  /** The source's time for the report, ms since epoch; undefined when it gives none. */
  at?: number;
}

// ---- The Secretary of State --------------------------------------------------

/** Statewide offices on the 2026 general ballot (apps/web STATEWIDE_OFFICES, same order). */
export const SOS_STATEWIDE_OFFICE_IDS = [
  "governor",
  "lieutenant-governor",
  "secretary-of-state",
  "controller",
  "treasurer",
  "attorney-general",
  "insurance-commissioner",
  "superintendent-of-public-instruction",
] as const;

/** District families: the API's path and how many (apps/web DISTRICT_FAMILIES). */
export const SOS_DISTRICT_PATHS = [
  { path: "us-rep", count: 52 },
  { path: "state-senate", count: 40 },
  { path: "state-assembly", count: 80 },
  { path: "board-of-equalization", count: 4 },
] as const;

/**
 * Every whole-state document the recorder keeps: the statewide offices, every
 * district (those not on this ballot answer an empty 500 and are skipped), the
 * propositions, the Supreme Court retention votes, and the reporting status.
 */
export function sosRecordedPaths(): string[] {
  return [
    ...SOS_STATEWIDE_OFFICE_IDS,
    ...SOS_DISTRICT_PATHS.flatMap((f) =>
      Array.from({ length: f.count }, (_, i) => `${f.path}/district/${i + 1}`),
    ),
    "ballot-measures",
    "supreme-court",
    "status",
  ];
}

/**
 * The document whose report time moves whenever any county reports: a
 * statewide race sums every county. Checked alone on a quick check; the rest
 * are fetched when it moves.
 */
export const SOS_SENTINEL_PATH = "governor";

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

/** "November 3, 2026, 8:15 p.m." (California time, as the state writes it) → ms since epoch. */
export function sosReportTime(text: string | undefined): number | undefined {
  const m = text?.match(
    /([a-z]+)\s+(\d{1,2}),\s*(\d{4}),?\s+(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?/i,
  );
  if (!m) return undefined;
  const month = MONTHS.indexOf((m[1] ?? "").toLowerCase());
  if (month < 0) return undefined;
  const hour12 = Number(m[4]) % 12;
  const hour = (m[6] ?? "").toLowerCase() === "p" ? hour12 + 12 : hour12;
  const pad = (n: number) => String(n).padStart(2, "0");
  return californiaTime(
    `${m[3]}-${pad(month + 1)}-${pad(Number(m[2]))} ${pad(hour)}:${pad(Number(m[5]))}`,
  );
}

/** "1,234" → 1234; anything unreadable → 0 (as the web app reads the state's numbers). */
function num(raw: unknown): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (typeof raw !== "string" || !raw) return 0;
  const n = Number(raw.replace(/[,%\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

/** A name as a path segment, the way the web app makes a justice's id (`countySlug`). */
export function nameSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+county$/, "")
    .trim()
    .replace(/[^a-z]+/g, "-")
    .replace(/^-|-$/g, "");
}

interface WireSosMeasure {
  Name?: string;
  Number?: string;
  yesVotes?: string;
  noVotes?: string;
}

interface WireSosContest {
  Reporting?: string;
  ReportingTime?: string;
  candidates?: { Name?: string; Votes?: string }[];
  "ballot-measures"?: WireSosMeasure[];
  "supreme-court"?: WireSosMeasure[];
}

function yesNo(m: WireSosMeasure): HistoryChoice[] {
  return [
    { name: "Yes", votes: num(m.yesVotes) },
    { name: "No", votes: num(m.noVotes) },
  ];
}

/**
 * The races in one of the state's whole-state documents (`sosRecordedPaths`):
 * one for an office or district, one per proposition (`prop/<n>`), one per
 * justice (`supreme-court/<name>`). Nothing for the status document.
 */
export function sosEntries(path: string, raw: unknown): RecordEntry[] {
  const wire = (Array.isArray(raw) ? raw[0] : raw) as WireSosContest | undefined;
  if (!wire || typeof wire !== "object" || path === "status") return [];
  const pct = wire.Reporting?.match(/([\d.]+)%/)?.[1];
  const p = pct !== undefined ? Number(pct) : undefined;
  const at = sosReportTime(wire.ReportingTime);
  const base = { ...(p !== undefined ? { p } : {}), ...(at !== undefined ? { at } : {}) };
  if (path === "supreme-court")
    return (wire["supreme-court"] ?? []).map((j) => ({
      id: `supreme-court/${nameSlug(j.Name ?? "")}`,
      choices: yesNo(j),
      ...base,
    }));
  if (path === "ballot-measures")
    return (wire["ballot-measures"] ?? []).map((m) => ({
      id: `prop/${Number(m.Number)}`,
      choices: yesNo(m),
      ...base,
    }));
  if (!wire.candidates) return [];
  const choices = wire.candidates
    .map((c) => ({ name: c.Name ?? "", votes: num(c.Votes) }))
    .sort((a, b) => b.votes - a.votes);
  return [{ id: path, choices, ...base }];
}

// ---- Counties -----------------------------------------------------------------

/**
 * The races in a county's report, as the web app shows them
 * (`countyContestResult`): precincts only once one reports (mail ballots are
 * counted before any precinct does), a measure as Yes / No, candidates most
 * votes first. `at` is the county's time for the report, when it gives one.
 */
export function countyEntries(
  slug: string,
  contests: readonly CountyContest[],
  updated: number | undefined,
): RecordEntry[] {
  return contests.map((c) => {
    const pr = c.precincts;
    const p =
      pr && pr.total > 0 && pr.reporting > 0
        ? Math.round((pr.reporting / pr.total) * 1000) / 10
        : undefined;
    const choices = c.measure
      ? [
          { name: "Yes", votes: c.choices.find((x) => /yes/i.test(x.name))?.votes ?? 0 },
          { name: "No", votes: c.choices.find((x) => /no/i.test(x.name))?.votes ?? 0 },
        ]
      : c.choices.map((x) => ({ name: x.name, votes: x.votes })).sort((a, b) => b.votes - a.votes);
    return {
      id: `county-ca/${slug}/${c.key}`,
      choices,
      ...(p !== undefined ? { p } : {}),
      ...(updated !== undefined ? { at: updated } : {}),
    };
  });
}
