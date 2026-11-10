import type { BallotContest, Subject } from "@openslate/core";
import { httpHref } from "./httpHref";
import { jurisdictionLabel } from "./jurisdictions";
import { regionFor } from "./regions";
import { CA_LINKS } from "./regions/us-ca/links";

/**
 * Where to read up on a race or a candidate: links to Ballotpedia, official
 * and nonpartisan voter guides, and a news search. Built here from the
 * subject's title, place and date; nothing is fetched, and nothing leaves the
 * browser until the user follows a link. Pure; unit-tested in
 * test/researchLinks.test.ts.
 */

export interface ResearchLink {
  /** Short name of the site, shown as the link text. */
  label: string;
  href: string;
  /** What's behind the link, shown beside it where there's room (the race page). */
  description: string;
}

interface RaceLike {
  subject: Subject;
  jurisdiction?: string;
  election?: string;
  /** How the ballot prints it (a listing's, from collate), when known. */
  ballot?: BallotContest;
}

/** The League of Women Voters' guide. Address-based, so one link for the whole ballot. */
export const VOTE411: ResearchLink = {
  label: "VOTE411",
  href: "https://www.vote411.org/ballot",
  description:
    "The League of Women Voters' nonpartisan guide: enter your address for your ballot, with candidates' own answers",
};

/** One region's own places to read up on a race, beside the ones every region gets. */
export interface RegionLinks {
  /**
   * The election authority's own guide for a race, when its site has one for
   * it. `number`: a measure's, as the ballot heads it.
   */
  official?: (
    race: { jurisdiction: string | undefined; election: string; measure: boolean; number?: string },
    today: string,
  ) => ResearchLink | undefined;
  /** Newsrooms that cover the region's elections, as searches for the race. */
  news?: (query: string) => ResearchLink[];
}

const REGION_LINKS: Record<string, RegionLinks> = {
  "us/ca": CA_LINKS,
};

function regionLinks(jurisdiction: string | undefined): RegionLinks | undefined {
  const region = regionFor(jurisdiction);
  return region ? REGION_LINKS[region.path] : undefined;
}

function yearOf(election: string | undefined): string {
  return /^\d{4}/.exec(election ?? "")?.[0] ?? "";
}

/**
 * Search words for a race, plus the year. A measure the ballot heads with a
 * number goes by its place and heading ("California Proposition 43"), which is
 * what news and Ballotpedia call it; anything else by its title.
 */
export function raceQuery(race: RaceLike): string {
  const ballot = race.ballot ?? race.subject.ballot;
  const jurisdiction = race.jurisdiction ?? race.subject.jurisdiction;
  const name =
    race.subject.kind === "measure" && ballot?.heading && ballot.number && jurisdiction
      ? `${jurisdictionLabel(jurisdiction)} ${ballot.heading}`
      : race.subject.title;
  const words = name.replace(/[–—,]/g, " ").replace(/\s+/g, " ").trim();
  return [words, yearOf(race.election ?? race.subject.election)].filter(Boolean).join(" ");
}

function ballotpediaSearch(query: string, jump: boolean): string {
  const params = new URLSearchParams({ search: query, title: "Special:Search" });
  // `go` jumps straight to a page with exactly that title (a candidate's page).
  if (jump) params.set("go", "Go");
  return `https://ballotpedia.org/wiki/index.php?${params}`;
}

function newsSearch(query: string): string {
  return `https://news.google.com/search?${new URLSearchParams({ q: query, hl: "en-US", gl: "US", ceid: "US:en" })}`;
}

/** Links for a race or measure as a whole, most authoritative first. */
export function raceLinks(race: RaceLike, today: string): ResearchLink[] {
  const links: ResearchLink[] = [];
  const query = raceQuery(race);
  const election = race.election ?? race.subject.election ?? "";
  const jurisdiction = race.jurisdiction ?? race.subject.jurisdiction;
  const measure = race.subject.kind === "measure";

  const more = httpHref(race.subject.uri);
  if (more) {
    links.push({
      label: "More info",
      href: more,
      description: "Linked by the slate itself",
    });
  }
  const region = regionLinks(jurisdiction);
  const number = measure ? (race.ballot?.number ?? race.subject.ballot?.number) : undefined;
  const official = region?.official?.(
    { jurisdiction, election, measure, ...(number ? { number } : {}) },
    today,
  );
  if (official) links.push(official);
  links.push({
    label: "Ballotpedia",
    href: ballotpediaSearch(query, false),
    description: `Search Ballotpedia for “${query}”`,
  });
  links.push(...(region?.news?.(query) ?? []));
  links.push({ label: "News", href: newsSearch(query), description: `Google News: “${query}”` });
  return links;
}

/** Links about one candidate in a race. Not for measures' Yes / No. */
export function candidateLinks(race: RaceLike, candidate: string): ResearchLink[] {
  if (race.subject.kind === "measure" || !candidate) return [];
  const office = raceQuery(race);
  return [
    {
      label: "Ballotpedia",
      href: ballotpediaSearch(candidate, true),
      description: `${candidate} on Ballotpedia`,
    },
    {
      label: "News",
      href: newsSearch(`"${candidate}" ${office}`),
      description: `Google News: ${candidate}, ${office}`,
    },
  ];
}
