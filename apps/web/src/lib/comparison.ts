import { useDeferredValue, useMemo } from "react";
import {
  type Alignment,
  type AlignmentGroups,
  type Comparison,
  compareBallot,
  groupAlignments,
} from "./alignment";
import type { AllRaces } from "./allSlates";
import { ballotDraftStore, useRankings } from "./ballotDraft";
import { collateRaces, type DecodedSlate, defaultElection, electionsOf } from "./collate";
import { useMyIdentities } from "./identities";
import { useLocalStore } from "./localStore";
import { localToday, useArea, useFollows, useMyElection } from "./myVote";
import { standingOf } from "./sources";

/**
 * My ballot's marks against everyone there's data for. The scoring is
 * alignment.ts; this feeds it the voter's marks as they change. A pick goes
 * nowhere: the catalog comes from `useAllRaces` (the same public file for every
 * visitor) and everything here happens on the page.
 */

/** The election My ballot shows, chosen or by default. */
export function useBallotElection(slates: DecodedSlate[]): string | undefined {
  const [follows] = useFollows();
  const [chosen] = useMyElection();
  const elections = useMemo(() => electionsOf(slates, follows), [slates, follows]);
  return elections.some((e) => e.date === chosen)
    ? chosen
    : defaultElection(elections, localToday());
}

export interface BallotComparison {
  comparison: Comparison;
  groups: AlignmentGroups;
  /** `catalog`: everyone. `imported`: only the slates in this browser, for now or for good. */
  scope: "catalog" | "imported";
}

const NO_FOLLOWS = {};

/**
 * The voter's marks against `all` (the whole catalog), or, without it and with
 * `fallback`, against what's imported. Deferred: a mark paints first, and the
 * comparison catches up. `only` narrows it to some sources.
 */
export function useBallotComparison(
  election: string | undefined,
  slates: DecodedSlate[],
  all: AllRaces | undefined,
  { only, fallback = true }: { only?: (a: Alignment) => boolean; fallback?: boolean } = {},
): BallotComparison | undefined {
  const [rows] = useLocalStore(ballotDraftStore);
  const rankings = useRankings();
  const [area] = useArea();
  const [follows] = useFollows();
  const identities = useMyIdentities();
  const deferredRows = useDeferredValue(rows);
  const deferredRankings = useDeferredValue(rankings);

  const imported = useMemo(
    () =>
      election && !all && fallback
        ? collateRaces(slates, { follows: NO_FOLLOWS, election, includeUnfollowed: true })
        : undefined,
    [slates, election, all, fallback],
  );
  // `all` is every election's races: another election's are nobody's "open" races.
  const races = useMemo(
    () => imported ?? all?.races.filter((race) => race.election === election) ?? [],
    [imported, all, election],
  );
  const skip = useMemo(
    () => new Set(identities.map((identity) => `key:${identity.publicKey}`)),
    [identities],
  );
  const importedIds = useMemo(() => new Set(slates.map((slate) => slate.source.id)), [slates]);

  return useMemo(() => {
    if (!election || races.length === 0) return undefined;
    const comparison = compareBallot({
      races,
      rows: deferredRows,
      election,
      rankings: deferredRankings,
      area,
      skip,
    });
    const alignments = only ? comparison.alignments.filter(only) : comparison.alignments;
    const groups = groupAlignments(
      { alignments, matched: comparison.matched },
      (a) => importedIds.has(a.source.id) && standingOf(follows, a.source.id) === "follow",
    );
    return { comparison, groups, scope: all ? "catalog" : "imported" };
  }, [
    races,
    deferredRows,
    deferredRankings,
    election,
    area,
    skip,
    only,
    importedIds,
    follows,
    all,
  ]);
}
