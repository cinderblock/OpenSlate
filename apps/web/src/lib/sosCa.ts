import { samePerson } from "@openslate/core";
import { baseUrlFor } from "./routing";

/**
 * California Secretary of State election-night results
 * (`api.sos.ca.gov/returns/…`): every statewide, congressional, legislative and
 * Board of Equalization contest, and the statewide measures, statewide and per
 * county. No key; CORS open. Fetched through the project's relay (a minute's
 * cache) unless the user chose their own connection in Settings.
 *
 * A contest id is its path under `/returns`: `governor`,
 * `us-rep/district/16`, or `prop/37` for one statewide measure (the API serves
 * them all together, at `ballot-measures`), or `supreme-court/<justice>` for
 * one Supreme Court justice's retention vote (all of them at `supreme-court`).
 *
 * Normalizers are pure; unit-tested in test/sosCa.test.ts.
 */

const PROVIDER = "sos-ca";

/** Statewide offices on the 2026 general ballot, in ballot order. */
export const STATEWIDE_OFFICES: { id: string; label: string }[] = [
  { id: "governor", label: "Governor" },
  { id: "lieutenant-governor", label: "Lieutenant Governor" },
  { id: "secretary-of-state", label: "Secretary of State" },
  { id: "controller", label: "Controller" },
  { id: "treasurer", label: "Treasurer" },
  { id: "attorney-general", label: "Attorney General" },
  { id: "insurance-commissioner", label: "Insurance Commissioner" },
  { id: "superintendent-of-public-instruction", label: "Superintendent of Public Instruction" },
];

/** District families: the area's family key, the API's path, how many, and what to call one. */
export const DISTRICT_FAMILIES = [
  { family: "cd", path: "us-rep", count: 52, label: "U.S. House District" },
  { family: "sd", path: "state-senate", count: 40, label: "State Senate District" },
  { family: "ad", path: "state-assembly", count: 80, label: "State Assembly District" },
  {
    family: "boe",
    path: "board-of-equalization",
    count: 4,
    label: "Board of Equalization District",
  },
] as const;

export type DistrictFamily = (typeof DISTRICT_FAMILIES)[number]["family"];

export function districtContest(family: DistrictFamily, number: string | number): string {
  const f = DISTRICT_FAMILIES.find((d) => d.family === family);
  if (!f) throw new Error(`unknown family ${family}`);
  return `${f.path}/district/${Number(number)}`;
}

export function propContest(number: string | number): string {
  return `prop/${Number(number)}`;
}

/** One Supreme Court justice's retention vote, by the justice's name ("Joshua Groban"). */
export function justiceContest(name: string): string {
  return `supreme-court/${countySlug(name)}`;
}

/** A readable name for a contest id, without fetching it. */
export function contestLabel(id: string): string {
  const office = STATEWIDE_OFFICES.find((o) => o.id === id);
  if (office) return office.label;
  const prop = id.match(/^prop\/(\d+)$/);
  if (prop) return `Proposition ${prop[1]}`;
  const justice = id.match(/^supreme-court\/([a-z-]+)$/);
  if (justice?.[1]) return `Supreme Court: retain ${justiceName(justice[1])}`;
  const district = id.match(/^([a-z-]+)\/district\/(\d+)$/);
  if (district) {
    const f = DISTRICT_FAMILIES.find((d) => d.path === district[1]);
    if (f) return `${f.label} ${district[2]}`;
  }
  return id;
}

/** County names as the API spells them in paths (`santa-clara`). */
export function countySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+county$/, "")
    .trim()
    .replace(/[^a-z]+/g, "-")
    .replace(/^-|-$/g, "");
}

// ---- Wire shapes -------------------------------------------------------------

interface WireCandidate {
  Name: string;
  Party?: string;
  Votes?: string;
  Percent?: string;
  incumbent?: boolean;
}

interface WireMeasure {
  Name: string;
  Number: string;
  yesVotes?: string;
  yesPercent?: string;
  noVotes?: string;
  noPercent?: string;
}

interface WireContest {
  raceTitle?: string;
  Reporting?: string;
  ReportingTime?: string;
  candidates?: WireCandidate[];
  "ballot-measures"?: WireMeasure[];
  /** Each justice up for retention: a yes/no vote, named for the justice. */
  "supreme-court"?: WireMeasure[];
}

// ---- Normalized shapes -------------------------------------------------------

export interface Reporting {
  /** As the API words it: "12.3% (2,935 of 23,860) precincts reporting". */
  text: string;
  /** Percent reporting, when the text says. */
  percent?: number;
  /** When the count was last updated, as the API words it ("November 3, 2026, 8:15 p.m."). */
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

function measureOf(m: WireMeasure): MeasureResult {
  return {
    number: String(Number(m.Number)),
    name: m.Name,
    yes: num(m.yesVotes),
    no: num(m.noVotes),
    yesPercent: num(m.yesPercent),
    noPercent: num(m.noPercent),
  };
}

/** One contest's response (or the first of a county response, which is an array). */
export function normalizeContest(raw: unknown, prop?: string, justice?: string): ContestResult {
  const wire = (Array.isArray(raw) ? raw[0] : raw) as WireContest | undefined;
  if (!wire || typeof wire !== "object")
    throw new Error("Unexpected answer from the Secretary of State");
  const reporting = parseReporting(wire.Reporting, wire.ReportingTime);
  const title = wire.raceTitle ?? "";
  const justices = wire["supreme-court"];
  if (justices) {
    const name = justice ? justiceName(justice) : "";
    const hit = justices.find((j) => samePerson(j.Name, name));
    if (!hit) throw new NotOnBallot();
    return { kind: "measure", title, reporting, measure: { ...measureOf(hit), number: "" } };
  }
  const measures = wire["ballot-measures"];
  if (measures) {
    const all = measures.map(measureOf);
    if (prop !== undefined) {
      const measure = all.find((m) => m.number === String(Number(prop)));
      if (!measure) throw new NotOnBallot();
      return { kind: "measure", title, reporting, measure };
    }
    return { kind: "measures", title, reporting, measures: all };
  }
  const candidates = (wire.candidates ?? [])
    .map((c) => ({
      name: c.Name,
      ...(c.Party ? { party: c.Party } : {}),
      votes: num(c.Votes),
      percent: num(c.Percent),
      incumbent: Boolean(c.incumbent),
    }))
    .sort((a, b) => b.votes - a.votes);
  return { kind: "candidates", title, reporting, candidates };
}

/** The contest isn't on this election's ballot (the API answers 500 with nothing). */
export class NotOnBallot extends Error {
  constructor() {
    super("Not on this election's ballot");
    this.name = "NotOnBallot";
  }
}

/** The API path for a contest id, statewide or for one county. */
export function contestPath(
  id: string,
  county?: string,
): { path: string; prop?: string; justice?: string } {
  const prop = id.match(/^prop\/(\d+)$/)?.[1];
  const justice = id.match(/^supreme-court\/([a-z-]+)$/)?.[1];
  const base = prop ? "ballot-measures" : justice ? "supreme-court" : id;
  const path = county ? `${base}/county/${countySlug(county)}` : base;
  return prop ? { path, prop } : justice ? { path, justice } : { path };
}

/** "joshua-groban" → "Joshua Groban". */
function justiceName(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

async function getJson(base: string, path: string): Promise<unknown> {
  const res = await fetch(`${base}/returns/${path}`, { headers: { accept: "application/json" } });
  if (res.status === 500) {
    const body = await res.text().catch(() => "");
    // The API's way of saying "no such contest": a 500 with nothing in it.
    if (!body.trim()) throw new NotOnBallot();
    throw new Error(`Secretary of State answered 500`);
  }
  if (!res.ok) throw new Error(`Secretary of State answered ${res.status}`);
  return res.json();
}

/** Fetch one contest: through the preferred route, then the other when that fails outright. */
export async function fetchContest(id: string, county?: string): Promise<ContestResult> {
  const { path, prop, justice } = contestPath(id, county);
  return normalizeContest(await fetchPath(path), prop, justice);
}

/**
 * Every proposition is one document (`ballot-measures`), every justice one
 * more (`supreme-court`): the cards asking for
 * it at the same moment share one request, and its answer for a few seconds.
 */
const recent = new Map<string, { at: number; raw: Promise<unknown> }>();
const SHARE_MS = 10_000;

function fetchPath(path: string): Promise<unknown> {
  const now = Date.now();
  const hit = recent.get(path);
  if (hit && now - hit.at < SHARE_MS) return hit.raw;
  const raw = fetchPathOnce(path);
  recent.set(path, { at: now, raw });
  raw.catch(() => recent.delete(path));
  return raw;
}

/**
 * Through the route the user chose (Settings → Data routing: OpenSlate's relay
 * by default, or their own connection). No automatic switch to the other one
 * on failure: a relay outage must not turn every open page into direct traffic
 * on the state's servers.
 */
function fetchPathOnce(path: string): Promise<unknown> {
  return getJson(baseUrlFor(PROVIDER), path);
}

/** Every county's name, from the state's reporting status. */
export async function fetchCounties(): Promise<string[]> {
  const data = (await fetchPath("status")) as Record<string, { countyName?: string }>;
  return Object.values(data)
    .map((c) => c.countyName)
    .filter((n): n is string => Boolean(n))
    .sort();
}

export const LIVE_REFRESH_MS = 60_000;

export function contestQueryOptions(id: string, county?: string) {
  return {
    queryKey: ["sos-ca", id, county ?? null] as const,
    queryFn: () => fetchContest(id, county),
    staleTime: LIVE_REFRESH_MS / 2,
    refetchInterval: LIVE_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: (count: number, error: Error) => !(error instanceof NotOnBallot) && count < 2,
  };
}
