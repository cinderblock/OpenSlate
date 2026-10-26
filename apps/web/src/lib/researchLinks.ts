import type { Subject } from "@openslate/core";
import { splitMeasureTitle } from "./ballotView";

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
}

/** The League of Women Voters' guide. Address-based, so one link for the whole ballot. */
export const VOTE411: ResearchLink = {
  label: "VOTE411",
  href: "https://www.vote411.org/ballot",
  description:
    "The League of Women Voters' nonpartisan guide: enter your address for your ballot, with candidates' own answers",
};

function isCalifornia(jurisdiction: string | undefined): boolean {
  return jurisdiction === "us/ca" || (jurisdiction?.startsWith("us/ca/") ?? false);
}

function yearOf(election: string | undefined): string {
  return /^\d{4}/.exec(election ?? "")?.[0] ?? "";
}

/**
 * Search words for a race: the title without a measure's long ballot label
 * ("California – Proposition 43 (Limits …)" → "California Proposition 43"),
 * plus the year.
 */
export function raceQuery(race: RaceLike): string {
  const title = race.subject.title
    .replace(/\s*\(.*\)\s*$/, "")
    .replace(/[–—,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return [title, yearOf(race.election ?? race.subject.election)].filter(Boolean).join(" ");
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

  if (race.subject.uri) {
    links.push({
      label: "More info",
      href: race.subject.uri,
      description: "Linked by the slate itself",
    });
  }
  // The Secretary of State's site only hosts the current election's guide.
  if (jurisdiction === "us/ca" && election >= today) {
    const number = measure ? splitMeasureTitle(race.subject.title).number : undefined;
    if (number) {
      links.push({
        label: "Official guide",
        href: `https://voterguide.sos.ca.gov/propositions/${encodeURIComponent(number)}/`,
        description:
          "California's Official Voter Information Guide: the Legislative Analyst's summary and the arguments for and against",
      });
    } else if (!measure) {
      links.push({
        label: "Official guide",
        href: "https://voterguide.sos.ca.gov/candidates/",
        description: "California's Official Voter Information Guide: candidates' own statements",
      });
    }
  }
  links.push({
    label: "Ballotpedia",
    href: ballotpediaSearch(query, false),
    description: `Search Ballotpedia for “${query}”`,
  });
  if (isCalifornia(jurisdiction)) {
    links.push({
      label: "CalMatters",
      href: `https://calmatters.org/?${new URLSearchParams({ s: query })}`,
      description: `CalMatters' nonprofit reporting on “${query}”`,
    });
  }
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
