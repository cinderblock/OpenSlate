import type { Race, RaceCandidate, RaceSummary, Subject } from "@openslate/core";
import { parseJurisdiction } from "./jurisdictions";
import {
  type ContestResult,
  DISTRICT_FAMILIES,
  districtContest,
  propContest,
  STATEWIDE_OFFICES,
} from "./sosCa";

/**
 * The California Secretary of State as the results source for the races it
 * counts: this election's statewide offices, measures, and congressional,
 * legislative and Board of Equalization races. civicAPI stays the source for
 * everything else (past elections, and anything this can't place), so it's
 * only asked about what the state doesn't answer.
 *
 * Races from the state get ids `sos:<contest>` (`sos:governor`), so the
 * results code can tell them from civicAPI's numeric ids. Pure; unit-tested in
 * test/sosResults.test.ts.
 */

/** The election the state's results API is serving. Its API has no other. */
export const SOS_ELECTION = "2026-11-03";

const SOS_PREFIX = "sos:";

export function isSosRaceId(id: string | number | undefined): id is string {
  return typeof id === "string" && id.startsWith(SOS_PREFIX);
}

export function sosRaceId(contest: string): string {
  return `${SOS_PREFIX}${contest}`;
}

export function contestOfSosRaceId(id: string): string {
  return id.slice(SOS_PREFIX.length);
}

/** Statewide office titles, most specific first ("Lieutenant Governor" before "Governor"). */
const OFFICE_PATTERNS: { id: string; pattern: RegExp }[] = [
  { id: "lieutenant-governor", pattern: /\blieutenant governor\b/ },
  { id: "governor", pattern: /\bgovernor\b/ },
  { id: "secretary-of-state", pattern: /\bsecretary of state\b/ },
  { id: "controller", pattern: /\bcontroller\b/ },
  { id: "treasurer", pattern: /\btreasurer\b/ },
  { id: "attorney-general", pattern: /\battorney general\b/ },
  { id: "insurance-commissioner", pattern: /\binsurance commissioner\b/ },
  {
    id: "superintendent-of-public-instruction",
    pattern: /\bsuperintendent of public instruction\b/,
  },
];

/** The state's contest for a subject, or undefined when it doesn't count that race. */
export function sosContestForSubject(subject: Subject): string | undefined {
  if (subject.election !== SOS_ELECTION) return undefined;
  const where = parseJurisdiction(subject.jurisdiction);
  if (where.kind === "district" && where.state === "us/ca") {
    const family = DISTRICT_FAMILIES.find((f) => f.family === where.family);
    return family ? districtContest(family.family, where.number) : undefined;
  }
  if (where.kind !== "state" || where.path !== "us/ca") return undefined;
  const title = subject.title.toLowerCase();
  const prop = title.match(/\bprop(?:osition)?\.?\s*(\d+)\b/);
  if (prop?.[1]) return propContest(prop[1]);
  const boe = title.match(/board of equalization(?: member)?,? district (\d+)/);
  if (boe?.[1]) return districtContest("boe", boe[1]);
  const office = OFFICE_PATTERNS.find((o) => o.pattern.test(title));
  return office && STATEWIDE_OFFICES.some((o) => o.id === office.id) ? office.id : undefined;
}

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

/**
 * "November 3, 2026, 8:15 p.m." (Pacific time, as the state writes it) → an
 * ISO instant. Undefined when it doesn't read that way.
 */
export function parseSosTime(text: string | undefined): string | undefined {
  const m = text?.match(
    /([a-z]+)\s+(\d{1,2}),\s*(\d{4}),?\s+(\d{1,2}):(\d{2})\s*([ap])\.?\s*m\.?/i,
  );
  if (!m) return undefined;
  const month = MONTHS.indexOf((m[1] ?? "").toLowerCase());
  if (month < 0) return undefined;
  const hour12 = Number(m[4]) % 12;
  const hour = (m[6] ?? "").toLowerCase() === "p" ? hour12 + 12 : hour12;
  const wall = Date.UTC(Number(m[3]), month, Number(m[2]), hour, Number(m[5]));
  // Pacific is UTC-8 (PST) or UTC-7 (PDT): take the one that reads back as that wall time.
  const hourIn = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    hourCycle: "h23",
  });
  for (const offset of [8, 7]) {
    const instant = new Date(wall + offset * 3_600_000);
    if (Number(hourIn.format(instant)) === hour) return instant.toISOString();
  }
  return new Date(wall + 8 * 3_600_000).toISOString();
}

const PARTY_COLORS: Record<string, string> = {
  Dem: "#2563eb",
  Rep: "#dc2626",
  Grn: "#3f9a4a",
  Lib: "#d9a326",
  PF: "#9b4fb5",
  AI: "#8a6d3b",
};

/** The state's count, in the shape the results pages already show (civicAPI's). */
export function contestToRace(contest: string, result: ContestResult): Race {
  let candidates: RaceCandidate[];
  if (result.kind === "candidates") {
    candidates = result.candidates.map((c) => ({
      name: c.name,
      ...(c.party ? { party: c.party } : {}),
      color: (c.party && PARTY_COLORS[c.party]) || "#8a93a1",
      votes: c.votes,
      percent: c.percent,
      incumbent: c.incumbent,
    }));
  } else if (result.kind === "measure") {
    const m = result.measure;
    candidates = [
      { name: "Yes", color: "#18794a", votes: m.yes, percent: m.yesPercent },
      { name: "No", color: "#c52a2a", votes: m.no, percent: m.noPercent },
    ];
  } else {
    candidates = [];
  }
  const updated = parseSosTime(result.reporting.time);
  return {
    id: sosRaceId(contest),
    type: result.kind === "candidates" ? "Race" : "Referendum",
    country: "US",
    province: "CA",
    election_name: result.title.replace(/\s+-\s+(Statewide|Districtwide) Results$/, ""),
    election_date: `${SOS_ELECTION}T08:00:00.000Z`,
    has_breakdown: false,
    has_map: false,
    ...(result.reporting.percent !== undefined
      ? { percent_reporting: result.reporting.percent }
      : {}),
    ...(updated ? { last_updated: updated } : {}),
    candidates,
  };
}

/** A search answer naming the state's contest, without asking civicAPI. */
export function sosSearchSummary(contest: string, subject: Subject): RaceSummary {
  return {
    id: sosRaceId(contest),
    country: "US",
    province: "CA",
    election_name: subject.title,
    election_date: `${SOS_ELECTION}T08:00:00.000Z`,
    has_map: false,
    candidates: [],
  };
}
