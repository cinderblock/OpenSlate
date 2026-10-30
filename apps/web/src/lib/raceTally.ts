import { ballotChoices, isYesNo } from "./ballotView";
import {
  type ChoiceGroup,
  type Race,
  type RacePosition,
  type StanceTone,
  stanceTone,
} from "./collate";
import { foldText, matchesSearch } from "./search";
import type { Source } from "./sources";

/**
 * Who stands where on a race, across every slate on it rather than only the
 * sources a voter follows: the counts that lead *All slates* and *All races*,
 * and the kinds of source they're broken down by. Pure; unit-tested in
 * test/raceTally.test.ts.
 *
 * Unlike `ChoiceGroup.support` and `opposition`, these count every position
 * and take no account of how the voter takes the source: a source you disagree
 * with is still for what it says it's for.
 */

/** A kind of source, for grouping a long list of them. */
export const SOURCE_GROUPS = [
  { id: "party", label: "Parties" },
  { id: "labor", label: "Labor" },
  { id: "business", label: "Business" },
  { id: "club", label: "Political clubs" },
  { id: "news", label: "News" },
  { id: "person", label: "People" },
  { id: "other", label: "Other groups" },
] as const;

export type SourceGroup = (typeof SOURCE_GROUPS)[number]["id"];

const KIND_GROUP: Record<string, SourceGroup> = {
  party: "party",
  editorial_board: "news",
  news_organization: "news",
  individual: "person",
  candidate: "person",
};

/**
 * Most of the catalog's sources are filed as plain `organization`, county
 * parties and some editorial boards among them, so a name has to say what the
 * kind doesn't. These only ever sort a list: nothing is counted differently.
 * Each pattern is deliberately narrow, since a broad one is wrong in public:
 * `union` would catch the San Diego Union-Tribune and Union City's Chamber of
 * Commerce, and `club` would catch Sierra Club and Club for Growth.
 */
const NAME_GROUPS: Array<[SourceGroup, RegExp]> = [
  ["news", /\beditorial board\b/i],
  ["party", /\b(?:party|central committee)\b/i],
  ["club", /\b(?:democratic|republican)\b.*\bclub\b/i],
  ["club", /\b(?:young (?:democrats|republicans)|lincoln club|republican assembly)\b/i],
  ["club", /\bdemocratic socialists\b|\bdsa\b/i],
  ["business", /\b(?:chambers? of commerce|chamber|realtors?|taxpayers|business|merchants)\b/i],
  ["business", /\b(?:property owners|building industry|hotel council|farm bureau)\b/i],
  ["labor", /\b(?:labor|afl-cio|seiu|teamsters|ibew|iaff|unite here|ufcw|afscme)\b/i],
  ["labor", /\b(?:building (?:and|&) construction trades|carpenters|iron workers)\b/i],
  ["labor", /\b(?:electrical|healthcare|transport) workers\b/i],
  ["labor", /\b(?:fire ?fighters?|teachers?|educators|nurses?|school employees)\b/i],
  ["labor", /\b(?:education association|faculty association)\b/i],
  ["labor", /\b(?:police|peace) officers\b|\bdeputy sheriffs\b/i],
];

export function sourceGroup(source: Pick<Source, "kind" | "name">): SourceGroup {
  const byKind = source.kind ? KIND_GROUP[source.kind] : undefined;
  if (byKind) return byKind;
  return NAME_GROUPS.find(([, pattern]) => pattern.test(source.name))?.[0] ?? "other";
}

/** One choice and how its positions fall. */
export interface ChoiceTally {
  group: ChoiceGroup;
  for: number;
  against: number;
  neutral: number;
}

export type ToneCounts = Record<StanceTone, number>;

export interface RaceTally {
  /** Most backed first; Yes then No on a yes/no question; a stance on the race as a whole last. */
  choices: ChoiceTally[];
  yesNo: boolean;
  /** Distinct sources with a position here. */
  sources: number;
  /** How many of them the voter follows, to agree or to disagree. */
  followed: number;
  /** Distinct sources in each tone. One naming two candidates can be in two. */
  tones: ToneCounts;
  /** Distinct sources of each kind. */
  groups: Partial<Record<SourceGroup, number>>;
}

function toneCounts(positions: RacePosition[]): ToneCounts {
  const counts: ToneCounts = { for: 0, against: 0, neutral: 0 };
  for (const position of positions) counts[stanceTone(position.stance)]++;
  return counts;
}

/**
 * Every choice with its positions, the way the ballot shows them, and nobody
 * left out. `ballotChoices` folds a measure onto its two bubbles and drops a
 * neutral word on the measure as a whole, having no bubble to put it by: here
 * it's kept, as a stance on the race, since that slate does reference it.
 */
function everyChoice(race: Race): ChoiceGroup[] {
  const choices = ballotChoices(race);
  if (!isYesNo(race)) return choices;
  const listed = new Set(choices.flatMap((c) => c.positions.map((p) => p.source.id)));
  const rest = race.choices
    .filter((c) => c.choice === "")
    .flatMap((c) => c.positions)
    .filter((p) => !listed.has(p.source.id));
  if (rest.length === 0) return choices;
  const overall: ChoiceGroup = {
    choice: "",
    positions: rest,
    support: 0,
    opposition: 0,
    onBallot: false,
    writeIn: false,
  };
  return [...choices, overall];
}

export function tallyRace(race: Race): RaceTally {
  const yesNo = isYesNo(race);
  const choices = everyChoice(race).map(
    (group): ChoiceTally => ({ group, ...toneCounts(group.positions) }),
  );
  // Yes and No keep their order; `sort` is stable, so ties keep the ballot's.
  if (!yesNo) {
    choices.sort(
      (a, b) =>
        Number(a.group.choice === "") - Number(b.group.choice === "") ||
        b.for - a.for ||
        a.against - b.against,
    );
  }
  const positions = choices.flatMap((c) => c.group.positions);
  const inTone: Record<StanceTone, Set<string>> = {
    for: new Set(),
    against: new Set(),
    neutral: new Set(),
  };
  const sources = new Map<string, RacePosition>();
  for (const position of positions) {
    inTone[stanceTone(position.stance)].add(position.source.id);
    if (!sources.has(position.source.id)) sources.set(position.source.id, position);
  }
  const groups: RaceTally["groups"] = {};
  for (const { source } of sources.values()) {
    const group = sourceGroup(source);
    groups[group] = (groups[group] ?? 0) + 1;
  }
  return {
    choices,
    yesNo,
    sources: sources.size,
    followed: [...sources.values()].filter((p) => p.standing !== "off").length,
    tones: { for: inTone.for.size, against: inTone.against.size, neutral: inTone.neutral.size },
    groups,
  };
}

/** What a race's list of slates is narrowed to. */
export interface SlateFilter {
  /** On a yes/no question, `for` is Yes and `against` is No. */
  tone: StanceTone | "all";
  group: SourceGroup | "all";
  followedOnly: boolean;
  /** Words of a name to find (`searchTerms`). */
  terms: readonly string[];
}

export const NO_SLATE_FILTER: SlateFilter = {
  tone: "all",
  group: "all",
  followedOnly: false,
  terms: [],
};

export function isFiltering(filter: SlateFilter): boolean {
  return (
    filter.tone !== "all" ||
    filter.group !== "all" ||
    filter.followedOnly ||
    filter.terms.length > 0
  );
}

function matchesTone(position: RacePosition, choice: string, yesNo: boolean, tone: StanceTone) {
  const own = stanceTone(position.stance);
  if (!yesNo || tone === "neutral") return own === tone;
  return own === "for" && choice.toLowerCase() === (tone === "for" ? "yes" : "no");
}

/** The positions on a choice that pass the filter. */
export function filterPositions(
  tally: ChoiceTally,
  yesNo: boolean,
  filter: SlateFilter,
): RacePosition[] {
  return tally.group.positions.filter(
    (position) =>
      (filter.tone === "all" || matchesTone(position, tally.group.choice, yesNo, filter.tone)) &&
      (filter.group === "all" || sourceGroup(position.source) === filter.group) &&
      (!filter.followedOnly || position.standing !== "off") &&
      (filter.terms.length === 0 || matchesSearch(foldText(position.source.name), filter.terms)),
  );
}

/** A choice's positions under one heading of the list. */
export interface PositionGroup {
  id: SourceGroup | "followed";
  label: string;
  positions: RacePosition[];
  tones: ToneCounts;
}

/**
 * Positions under headings, counts first: the sources the voter follows, then
 * each kind, with nothing left under a heading of its own twice.
 */
export function groupPositions(positions: RacePosition[]): PositionGroup[] {
  const heading = (id: PositionGroup["id"], label: string, list: RacePosition[]) => ({
    id,
    label,
    positions: list,
    tones: toneCounts(list),
  });
  const followed = positions.filter((p) => p.standing !== "off");
  const rest = positions.filter((p) => p.standing === "off");
  return [
    heading("followed", "Sources you follow", followed),
    ...SOURCE_GROUPS.map((group) =>
      heading(
        group.id,
        group.label,
        rest.filter((p) => sourceGroup(p.source) === group.id),
      ),
    ),
  ].filter((group) => group.positions.length > 0);
}

/** The choices with a name, in tally order. */
export function namedChoices(tally: RaceTally): ChoiceTally[] {
  return tally.choices.filter((c) => c.group.choice !== "");
}

/** Where a choice stands against the rest of the field, by how many back it. */
export interface FieldStanding {
  /** 1 for the most backed; choices level with one another share a place. */
  place: number;
  /** Choices named in the race. */
  of: number;
  tied: boolean;
  /** The most backed choice, when it's another. */
  leader?: ChoiceTally;
}

export function fieldStanding(tally: RaceTally, choice: string): FieldStanding | undefined {
  const field = namedChoices(tally);
  const own = field.find((c) => c.group.choice === choice);
  if (!own) return undefined;
  const leader = field.reduce((a, b) => (b.for > a.for ? b : a));
  return {
    place: 1 + field.filter((c) => c.for > own.for).length,
    of: field.length,
    tied: field.some((c) => c !== own && c.for === own.for),
    ...(leader !== own && leader.for > own.for ? { leader } : {}),
  };
}

/** The choices (or a measure's Yes and No) a one-line summary leads with. */
export function headlineChoices(tally: RaceTally, count = 3): ChoiceTally[] {
  return namedChoices(tally).slice(0, count);
}
