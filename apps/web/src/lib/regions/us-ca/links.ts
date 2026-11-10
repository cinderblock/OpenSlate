import type { RegionLinks } from "../../researchLinks";

/**
 * Where to read up on a California race, beyond what every state gets
 * (`researchLinks.ts`): the Secretary of State's Official Voter Information
 * Guide and CalMatters.
 */
export const CA_LINKS: RegionLinks = {
  // The Secretary of State's site only hosts the current election's guide,
  // and only covers what the whole state votes on.
  official({ jurisdiction, election, measure, number }, today) {
    if (jurisdiction !== "us/ca" || election < today) return undefined;
    if (number) {
      return {
        label: "Official guide",
        href: `https://voterguide.sos.ca.gov/propositions/${encodeURIComponent(number)}/`,
        description:
          "California's Official Voter Information Guide: the Legislative Analyst's summary and the arguments for and against",
      };
    }
    if (measure) return undefined;
    return {
      label: "Official guide",
      href: "https://voterguide.sos.ca.gov/candidates/",
      description: "California's Official Voter Information Guide: candidates' own statements",
    };
  },
  news: (query) => [
    {
      label: "CalMatters",
      href: `https://calmatters.org/?${new URLSearchParams({ s: query })}`,
      description: `CalMatters' nonprofit reporting on “${query}”`,
    },
  ],
};
