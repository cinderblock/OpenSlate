import {
  type ContestOffice,
  type CountyContest,
  claritySummaryPath,
  contestOffice,
  isStatewideMeasureTitle,
  parseClarityVersion,
  parseStateFeed,
  parseStateFiles,
  STATE_FEEDS,
  type StateFeed,
  type Subject,
  seatOf,
  stateFeed,
  stateFeedUrl,
} from "@openslate/core";
import { type Area, parseJurisdiction } from "./jurisdictions";
import { LIVE_REFRESH_MS } from "./liveCount";
import { regionProfile } from "./regions";
import { getRoutingMode, PROVIDERS } from "./routing";

/**
 * Other states' own counts (`@openslate/core/stateResults` lists the states
 * and parses their feeds): one document per state holding every contest its
 * election office reports. Fetched through the project's relay (a minute's
 * cache; most of these answer no browser directly) unless the state allows
 * it and the user chose their own connection in Settings.
 *
 * What a contest is (the Senate, House district 7, a statewide measure) is
 * read from its title by core's `contestOffice`, the same for every state.
 * Pure helpers unit-tested in test/stateFeeds.test.ts.
 */

const PROVIDER = "state-feeds";

/** The states whose own count is read, as region paths (`us/va`), by name. */
export function stateFeedRegions(): string[] {
  return Object.entries(STATE_FEEDS)
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .map(([code]) => `us/${code}`);
}

/** A region's feed: `us/va`, or a path inside it. */
export function feedOfRegion(region: string | undefined): { code: string; feed: StateFeed } | null {
  const code = /^us\/([a-z]{2})(?:\/|$)/.exec(region ?? "")?.[1];
  const feed = stateFeed(code);
  return code && feed ? { code, feed } : null;
}

export interface StateResults {
  /** Postal code, lower case. */
  state: string;
  /** The feed's own version, so an unchanged count isn't parsed twice. */
  version: string;
  /** When the state published this count, ms since epoch, when it says. */
  updated?: number;
  /** When OpenSlate first read this version, ms since epoch. */
  seenAt: number;
  /** The state calls the count official, when it says either way. */
  official?: boolean;
  contests: CountyContest[];
}

/** A feed without CORS can only be read through the relay, whatever Settings say. */
function baseFor(code: string, feed: StateFeed): string {
  return feed.cors && getRoutingMode(PROVIDER) === "direct"
    ? feed.base
    : `${PROVIDERS[PROVIDER]?.proxyUrl ?? ""}/${code}`;
}

function modifiedOf(res: Response): number | undefined {
  const modified = Date.parse(res.headers.get("Last-Modified") ?? "");
  return Number.isFinite(modified) ? modified : undefined;
}

/** The last count read per state: a version seen before isn't parsed again. */
const lastRead = new Map<string, StateResults>();
/** One request per state at a time, shared by every contest asking. */
const inFlight = new Map<string, Promise<StateResults>>();

/** FNV-1a over a string: tells one count from the next, nothing more. */
function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

/**
 * A feed that is several named files (`StateFeed.files`): all of them, then
 * one count. Its version is the numbers themselves: these exports stamp every
 * row with the server's clock, so the text differs each minute when nothing
 * was counted.
 */
async function readFiles(
  code: string,
  feed: StateFeed,
  previous: StateResults | undefined,
): Promise<StateResults> {
  const direct = feed.cors && getRoutingMode(PROVIDER) === "direct";
  const base = baseFor(code, feed);
  const texts: Record<string, string> = {};
  let modified: number | undefined;
  await Promise.all(
    Object.keys(feed.files ?? {}).map(async (name) => {
      const res = await fetch(direct ? stateFeedUrl(feed, name) : `${base}/${name}`);
      if (!res.ok) throw new Error(`${feed.name}'s results site answered ${res.status}`);
      texts[name] = await res.text();
      const at = feed.lastModified ? modifiedOf(res) : undefined;
      if (at !== undefined && (modified === undefined || at > modified)) modified = at;
    }),
  );
  const count = parseStateFiles(feed, texts);
  const updated = count.asOf ?? modified;
  const version = hashOf(
    count.contests
      .map(
        (c) =>
          `${c.key}:${c.precincts?.reporting ?? ""}:${c.choices.map((x) => x.votes).join(",")}`,
      )
      .join("|"),
  );
  if (previous?.version === version) return previous;
  const out: StateResults = {
    state: code,
    version,
    ...(updated !== undefined ? { updated } : {}),
    seenAt: Date.now(),
    ...(count.official !== undefined ? { official: count.official } : {}),
    contests: count.contests,
  };
  lastRead.set(code, out);
  return out;
}

async function readState(code: string, feed: StateFeed): Promise<StateResults> {
  const base = baseFor(code, feed);
  const previous = lastRead.get(code);
  if (feed.files) return readFiles(code, feed, previous);
  let version: string;
  let res: Response;
  if (feed.kind === "clarity") {
    const pointer = await fetch(`${base}/current_ver.txt`);
    if (!pointer.ok) throw new Error(`${feed.name}'s results site answered ${pointer.status}`);
    const named = parseClarityVersion(await pointer.text());
    if (!named) throw new Error(`${feed.name} hasn't published results yet`);
    if (previous?.version === named) return previous;
    version = named;
    res = await fetch(`${base}/${claritySummaryPath(named)}`, {
      headers: { accept: "application/json" },
    });
  } else {
    res = await fetch(`${base}/data`, { headers: { accept: "application/json" } });
    version = "";
  }
  if (!res.ok) throw new Error(`${feed.name}'s results site answered ${res.status}`);
  const text = await res.text();
  const count = parseStateFeed(feed, JSON.parse(text));
  const updated = count.asOf ?? modifiedOf(res);
  version ||= `${updated ?? ""}:${text.length}`;
  if (previous?.version === version) return previous;
  const out: StateResults = {
    state: code,
    version,
    ...(updated !== undefined ? { updated } : {}),
    seenAt: Date.now(),
    ...(count.official !== undefined ? { official: count.official } : {}),
    contests: count.contests,
  };
  lastRead.set(code, out);
  return out;
}

/**
 * A state's whole count. Through the route the user chose (Settings → Data
 * routing); no automatic switch on failure, so a relay outage doesn't turn
 * every open page into traffic on a state's servers.
 */
export function fetchStateResults(code: string): Promise<StateResults> {
  const feed = stateFeed(code);
  if (!feed) return Promise.reject(new Error(`No results feed for ${code}`));
  const pending = inFlight.get(code);
  if (pending) return pending;
  const request = readState(code, feed).finally(() => inFlight.delete(code));
  inFlight.set(code, request);
  return request;
}

export function stateFeedQueryOptions(code: string) {
  return {
    queryKey: ["state-feed", code] as const,
    queryFn: () => fetchStateResults(code),
    staleTime: LIVE_REFRESH_MS / 2,
    refetchInterval: LIVE_REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: (count: number) => count < 2,
  };
}

/** Tests only. */
export function clearStateFeedCache(): void {
  lastRead.clear();
  inFlight.clear();
}

// ---- What each contest is ------------------------------------------------------

/** A contest with the office its title names. */
export interface StateContest {
  contest: CountyContest;
  office: ContestOffice;
  /** The whole state votes on it. */
  statewide: boolean;
}

/**
 * Each contest with its office, and whether the whole state votes on it: the
 * Senate, the governor and the other statewide offices by their titles, and
 * anything else (a measure, a justice, a commission seat elected at large)
 * when every one of the state's counties counts it, or, where the feed
 * doesn't say, when it's a measure worded as a statewide one.
 */
export function readContests(feed: StateFeed, contests: readonly CountyContest[]): StateContest[] {
  const most = Math.max(0, ...contests.map((c) => c.precincts?.total ?? 0));
  return contests.map((contest) => {
    const office: ContestOffice = contest.measure
      ? { kind: "other" }
      : contestOffice(contest.title, {
          ...(feed.bareHouseIsCongress ? { bareHouseIsCongress: true } : {}),
        });
    const everywhere = most >= 3 && contest.precincts?.total === most;
    const statewide =
      office.kind === "us-senate" ||
      office.kind === "governor" ||
      office.kind === "statewide-office" ||
      (office.kind === "other" &&
        (everywhere ||
          // The feed files it with what the whole state votes on (Texas's justices).
          /^statewide\b/i.test(contest.category ?? "") ||
          (contest.measure && most < 3 && isStatewideMeasureTitle(contest.title)) ||
          (contest.measure && /^(?:state|federal)\b/i.test(contest.category ?? ""))));
    return { contest, office, statewide };
  });
}

/** The office kind a district family of a region is: its `cd` is the US House. */
function kindOfFamily(region: string, family: string): ContestOffice["kind"] | undefined {
  const layers = regionProfile(region)?.layers;
  if (!layers) return undefined;
  if (family === layers.congress) return "us-house";
  if (family === layers.upper) return "state-upper";
  if (family === layers.lower) return "state-lower";
  return undefined;
}

/** The voter's own districts in a state, by office kind: `{ "us-house": "7", "state-upper": "12" }`. */
export function districtsIn(
  region: string,
  area: Pick<Area, "districts">,
): Partial<Record<ContestOffice["kind"], string>> {
  const out: Partial<Record<ContestOffice["kind"], string>> = {};
  for (const [key, id] of Object.entries(area.districts)) {
    if (!key.startsWith(`${region}/`)) continue;
    const kind = kindOfFamily(region, key.slice(region.length + 1));
    if (kind) out[kind] = id;
  }
  return out;
}

export interface StateSections {
  /** What the whole state votes on, offices before measures. */
  statewide: StateContest[];
  /** The voter's own districts' contests: Congress, then the legislature. */
  mine: StateContest[];
  /** Every other district of Congress and the legislature. */
  districts: StateContest[];
  /** The rest: courts, counties, towns, local measures. */
  other: StateContest[];
}

const KIND_ORDER: ContestOffice["kind"][] = [
  "us-senate",
  "us-house",
  "governor",
  "statewide-office",
  "state-upper",
  "state-lower",
  "other",
];

function districtOrder(a: StateContest, b: StateContest): number {
  const kind = KIND_ORDER.indexOf(a.office.kind) - KIND_ORDER.indexOf(b.office.kind);
  if (kind !== 0) return kind;
  const [x, y] = [a.office.district ?? "", b.office.district ?? ""];
  const numeric = Number.parseInt(x, 10) - Number.parseInt(y, 10);
  if (Number.isFinite(numeric) && numeric !== 0) return numeric;
  return x.localeCompare(y) || (a.office.seat ?? "").localeCompare(b.office.seat ?? "");
}

/** A state's contests in the order its page shows them. `area`: the voter's, when it's in this state. */
export function stateSections(
  region: string,
  feed: StateFeed,
  contests: readonly CountyContest[],
  area?: Pick<Area, "districts">,
): StateSections {
  const mineBy = area ? districtsIn(region, area) : {};
  const out: StateSections = { statewide: [], mine: [], districts: [], other: [] };
  for (const item of readContests(feed, contests)) {
    const { office } = item;
    const districted =
      office.kind === "us-house" || office.kind === "state-upper" || office.kind === "state-lower";
    if (districted && office.district !== undefined && mineBy[office.kind] === office.district)
      out.mine.push(item);
    // A state's one House seat is everyone's.
    else if (item.statewide || (office.kind === "us-house" && isAtLarge(region)))
      out.statewide.push(item);
    else if (districted) out.districts.push(item);
    else out.other.push(item);
  }
  // Offices in ballot order, then measures as the state lists them.
  out.statewide.sort(
    (a, b) =>
      Number(a.contest.measure) - Number(b.contest.measure) ||
      (a.contest.measure ? 0 : districtOrder(a, b)),
  );
  out.mine.sort(districtOrder);
  out.districts.sort(districtOrder);
  return out;
}

/** Whether a state sends one member to the House. */
function isAtLarge(region: string): boolean {
  const profile = regionProfile(region);
  const congress = profile?.families.find((f) => f.key === profile.layers.congress);
  return congress?.count === 1;
}

// ---- A race from a slate, in the state's count ---------------------------------

/** The number or letter a measure goes by: "Proposition 141" → `141`, "Amendment A" → `a`, "Initiative Measure No. IP26-645" → `ip26-645`. */
export function measureToken(title: string): string | undefined {
  const t = title.toLowerCase().replace(/\s+/g, " ");
  const named = t.match(
    /\b(?:amendment|proposition|prop\.?|question|issue|measure|initiative|referendum|proposal|resolution|bill)\s*(?:no\.?|number|#)?\s*([a-z]{0,3}\d[\w-]*|[a-z])\b/,
  );
  if (named?.[1]) return named[1];
  return t.match(/^(\d+)\./)?.[1];
}

const MEASURE_WORDS = [
  "amendment",
  "proposition",
  "question",
  "issue",
  "initiative",
  "referendum",
  "proposal",
  "resolution",
  "advisory",
  "bond",
];

/** A measure's kind words, to tell "Amendment 1" from "Referendum 1". */
function measureWords(title: string): string[] {
  const t = title.toLowerCase().replace(/\bprop\b\.?/g, "proposition");
  return MEASURE_WORDS.filter((word) => t.includes(word));
}

/**
 * The key a subject has in a state's count, when the state counts it:
 * `us-senate`, `governor`, `us-house/7`, `state-upper/12`, `state-lower/1/a`
 * (a seat), `office/attorney-general`, `measure/141`. Undefined for another
 * election's race, a local one, or one this can't read.
 */
export function stateContestKey(subject: Subject): string | undefined {
  const where = parseJurisdiction(subject.jurisdiction);
  if (where.kind !== "state" && where.kind !== "district") return undefined;
  const region = where.kind === "state" ? where.path : where.state;
  const found = feedOfRegion(region);
  if (!found || subject.election !== found.feed.election) return undefined;
  const hints = found.feed.bareHouseIsCongress ? { bareHouseIsCongress: true } : {};
  const office = contestOffice(subject.title, hints);
  if (where.kind === "district") {
    const kind = kindOfFamily(region, where.family);
    if (!kind) return undefined;
    // The path says which district; the title, at most, which seat.
    const seat = seatOf(subject.title);
    return `${kind}/${where.number}${seat ? `/${seat}` : ""}`;
  }
  if (office.kind === "us-senate" || office.kind === "governor") return office.kind;
  if (office.kind === "us-house" && isAtLarge(region)) return "us-house/1";
  if (office.kind === "statewide-office") return `office/${officeSlug(subject.title)}`;
  if (office.kind !== "other") return undefined;
  const token = measureToken(subject.title);
  const words = measureWords(subject.title);
  return token && words.length > 0 ? `measure/${words[0]}/${token}` : undefined;
}

/** A statewide office's name as a key: "Attorney General", "For Attorney General" → `attorney-general`. */
function officeSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/^for /, "")
    .replace(/\bof state\b|\bstate\b|\bgeneral\b/g, " ")
    .replace(/\blt\.?\b/g, "lieutenant")
    .replace(/[^a-z]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The contest a key names in a state's count, if it has it. */
export function contestOfKey(
  feed: StateFeed,
  contests: readonly CountyContest[],
  key: string,
): CountyContest | undefined {
  const [kind, id, seat] = key.split("/");
  const read = readContests(feed, contests);
  if (kind === "measure") {
    const matches = read.filter(
      ({ contest, statewide }) =>
        contest.measure &&
        statewide &&
        measureToken(contest.title) === seat &&
        measureWords(contest.title).includes(id ?? ""),
    );
    return matches.length === 1 ? matches[0]?.contest : undefined;
  }
  if (kind === "office") {
    return read.find(
      ({ office, contest }) =>
        office.kind === "statewide-office" && !office.special && officeSlug(contest.title) === id,
    )?.contest;
  }
  const matches = read.filter(
    ({ office }) =>
      office.kind === kind &&
      !office.special &&
      (id === undefined || office.district === id) &&
      (seat === undefined || office.seat === seat),
  );
  // Two seats in the district and the subject names neither: not one contest.
  return matches.length === 1 ? matches[0]?.contest : undefined;
}
