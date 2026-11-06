import { expandAdoptions } from "./adoptions";
import { type AttachedArticle, articlesByRace } from "./articles";
import { translateSlates } from "./ballotCheck";
import { gatherSlates } from "./catalogCopy";
import {
  collateRaces,
  type DecodedSlate,
  type ElectionSummary,
  electionsOf,
  type Race,
} from "./collate";
import { withNicknames } from "./nicknames";
import { raceSearchFields, raceSearchText } from "./search";
import type { Follows } from "./sources";

/**
 * Every slate there is, the public catalog's and the voter's own, lined up
 * into races. Over the whole catalog this takes seconds on a phone, so the page
 * hands it to a worker (lineUp.worker.ts) and stays responsive. Nothing here
 * may reach React, the database or localStorage, none of which a worker has:
 * test/lineUp.test.ts checks what it imports.
 */

export interface LineUpInput {
  /** The voter's imported slates, decoded. */
  imported: DecodedSlate[];
  /** The catalog copy's slates, decoded. */
  catalog: DecodedSlate[];
  follows: Follows;
  contacts: Parameters<typeof withNicknames>[1];
  /** Catalog entries that couldn't be used. */
  rejected: number;
  generatedAt: string;
}

/** `AllRaces` (allSlates.ts) without `byKey`, which the page builds on its side. */
export interface LinedUp {
  /**
   * The articles slates attach to each race (SPEC §3.15), by race key. The
   * slates themselves stay in the worker: copying them back cost more than
   * anything the page did with them.
   */
  articles: Map<string, AttachedArticle[]>;
  /** The voter's follows, with 0 for every catalog source they haven't imported. */
  follows: Follows;
  /** Every race, in ballot order. */
  races: Race[];
  /**
   * What each race is found by, by race key (search.ts `raceSearchText` and
   * `raceSearchFields`): worked out here with the races rather than on the
   * page, where it took as long as a render.
   */
  search: Map<string, RaceSearch>;
  elections: ElectionSummary[];
  /** Catalog entries that couldn't be used. */
  rejected: number;
  generatedAt: string;
}

export interface RaceSearch {
  text: string;
  fields: string[];
}

export function lineUp({
  imported,
  catalog,
  follows,
  contacts,
  rejected,
  generatedAt,
}: LineUpInput): LinedUp {
  const gathered = gatherSlates(imported, catalog, follows);
  const slates = withNicknames(translateSlates(expandAdoptions(gathered.slates)), contacts);
  const races = collateRaces(slates, { follows: gathered.follows, includeUnfollowed: true });
  return {
    articles: articlesByRace(slates, gathered.follows),
    follows: gathered.follows,
    races,
    search: new Map(
      races.map((race) => [
        race.key,
        { text: raceSearchText(race), fields: raceSearchFields(race) },
      ]),
    ),
    elections: electionsOf(slates, gathered.follows),
    rejected,
    generatedAt,
  };
}
