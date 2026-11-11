/**
 * A count as the app shows it, whoever published it: a state's election
 * office, a county's own results page. Each source's module turns its wire
 * format into these (`regions/us-ca/sos.ts`, `regions/us-ca/countyResults.ts`).
 * Pure; unit-tested with the sources that produce them.
 */

export interface Reporting {
  /** As the source words it: "12.3% (2,935 of 23,860) precincts reporting". */
  text: string;
  /** Percent reporting, when the text says. */
  percent?: number;
  /** What `percent` is of, when it isn't precincts: a state's site counts "counties". */
  units?: string;
  /** When the count was last updated, as the source words it ("November 3, 2026, 8:15 p.m."). */
  time?: string;
  /** When the source last changed its count, ms since epoch, when it says (a county's file time). */
  changedAt?: number;
  /**
   * `changedAt` is when OpenSlate first saw this count, not a time the source
   * gave (Los Angeles publishes none): the count changed by then.
   */
  changedSeen?: boolean;
}

export interface CandidateResult {
  name: string;
  party?: string;
  votes: number;
  percent: number;
  incumbent: boolean;
}

export interface MeasureResult {
  number: string;
  name: string;
  yes: number;
  no: number;
  yesPercent: number;
  noPercent: number;
  /** The yes share it needs, when more than a majority: local taxes and bonds often need 55% or two-thirds. */
  threshold?: "55%" | "2/3";
}

/** The yes share a measure's title says it needs: "2/3rds (66.67%) Vote Required", "55 Percent Approval". */
export function measureThreshold(title: string): MeasureResult["threshold"] {
  if (/2\s*\/\s*3|two[\s-]*thirds|66\.67?\s*%/i.test(title)) return "2/3";
  if (/\b55\s*(%|percent)/i.test(title)) return "55%";
  return undefined;
}

/** Whether a measure is passing on the count so far: a majority, 55%, or two-thirds of yes and no. */
export function measurePasses(m: Pick<MeasureResult, "yes" | "no" | "threshold">): boolean {
  const total = m.yes + m.no;
  if (total === 0) return false;
  if (m.threshold === "2/3") return m.yes * 3 >= total * 2;
  if (m.threshold === "55%") return m.yes * 100 >= total * 55;
  return m.yes * 2 > total;
}

export type ContestResult =
  | { kind: "candidates"; title: string; reporting: Reporting; candidates: CandidateResult[] }
  | { kind: "measure"; title: string; reporting: Reporting; measure: MeasureResult }
  | { kind: "measures"; title: string; reporting: Reporting; measures: MeasureResult[] };

/** "1,234" → 1234; anything unreadable → 0. */
export function num(raw: string | number | undefined): number {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : 0;
  if (!raw) return 0;
  const n = Number(raw.replace(/[,%\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function parseReporting(text: string | undefined, time: string | undefined): Reporting {
  const out: Reporting = { text: text ?? "" };
  const pct = text?.match(/([\d.]+)%/);
  if (pct?.[1]) out.percent = Number(pct[1]);
  if (time) out.time = time;
  return out;
}

/** The contest isn't on this election's ballot (California's API answers 500 with nothing). */
export class NotOnBallot extends Error {
  constructor() {
    super("Not on this election's ballot");
    this.name = "NotOnBallot";
  }
}

/** How often a live count is asked for again. */
export const LIVE_REFRESH_MS = 60_000;
