import type { Stance, Subject } from "@openslate/core";
import { useCallback } from "react";
import { createLocalStore, useLocalStore } from "./localStore";
import { subjectKey } from "./subjects";

export interface DraftRow {
  /** `${electionId}|${subjectKey}|${choice ?? ""}` */
  id: string;
  electionId: string;
  subject: Subject;
  /** The candidate or option name; absent for measure-style subjects. */
  choice?: string;
  /** A name the user wrote in: not printed on the ballot (SPEC §3.12). */
  writeIn?: true;
  /** Public stance — included in generated slates. */
  stance?: Stance;
  /** Public statement — included in generated slates. */
  statement?: string;
  /** Private note — kept entirely on the user's device, never signed or shared. */
  privateNote?: string;
  updatedAt: string;
}

export type DraftMap = Record<string, DraftRow>;
type RankingMap = Record<string, string[]>;

const KEY = "openslate.ballotDraft.v1";
const RANK_KEY = "openslate.ballotRanking.v1";

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw);
}

function parseDraft(raw: unknown): DraftMap | undefined {
  if (!isRecord(raw)) return undefined;
  const ok = Object.values(raw).every(
    (row) => isRecord(row) && typeof row.id === "string" && isRecord(row.subject),
  );
  return ok ? (raw as DraftMap) : undefined;
}

function parseRankings(raw: unknown): RankingMap | undefined {
  if (!isRecord(raw)) return undefined;
  const ok = Object.values(raw).every(
    (order) => Array.isArray(order) && order.every((name) => typeof name === "string"),
  );
  return ok ? (raw as RankingMap) : undefined;
}

/**
 * Every mark, statement and note, shared by every reader: a change from one
 * panel, a browser agent's tool (`webmcp.ts`) or another tab shows everywhere.
 */
export const ballotDraftStore = createLocalStore<DraftMap>(KEY, {}, parseDraft);

const rankingStore = createLocalStore<RankingMap>(RANK_KEY, {}, parseRankings);

/** The `choice` of a race's private-note row; no candidate can be named this. */
export const NOTE_CHOICE = "\u0000note";

export function rowIdFor(electionId: string, subject: Subject, choice: string | undefined): string {
  return `${electionId}|${subjectKey(subject)}|${choice ?? ""}`;
}

function rankingKeyFor(electionId: string, subject: Subject): string {
  return `${electionId}|${subjectKey(subject)}`;
}

/**
 * Reconcile a saved ranking with the live candidate list: keep saved order for
 * candidates that still exist, then append any new candidates in their natural
 * order. Drops names that no longer exist.
 */
export function effectiveOrder(saved: string[] | undefined, current: string[]): string[] {
  if (!saved || saved.length === 0) return current;
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const name of saved) {
    if (current.includes(name) && !seen.has(name)) {
      ordered.push(name);
      seen.add(name);
    }
  }
  for (const name of current) {
    if (!seen.has(name)) ordered.push(name);
  }
  return ordered;
}

/**
 * Marks and notes on races the catalog has since re-filed, moved to the race as
 * it's filed now. A race's jurisdiction is part of its identity, so when San
 * Diego County's races moved from `us/ca/san-diego` to `us/ca/san-diego-county`
 * every mark on them was left on a race that no longer exists. A row moves when
 * its race is none of `subjects` (every imported race) and exactly one of them
 * has its election, title and kind; a mark already on that race wins.
 * Undefined when no row moves.
 */
export function refiledRows(rows: DraftMap, subjects: readonly Subject[]): DraftMap | undefined {
  const keys = new Set(subjects.map(subjectKey));
  const byTitle = new Map<string, Map<string, Subject>>();
  for (const subject of subjects) {
    const at = `${subject.election ?? ""}|${subject.title}`;
    const same = byTitle.get(at) ?? new Map<string, Subject>();
    same.set(subjectKey(subject), subject);
    byTitle.set(at, same);
  }
  let next: DraftMap | undefined;
  for (const row of Object.values(rows)) {
    if (keys.has(subjectKey(row.subject))) continue;
    const same = [
      ...(byTitle.get(`${row.subject.election ?? ""}|${row.subject.title}`)?.values() ?? []),
    ].filter((s) => !row.subject.kind || !s.kind || s.kind === row.subject.kind);
    const subject = same.length === 1 ? same[0] : undefined;
    if (!subject) continue;
    const id = rowIdFor(row.electionId, subject, row.choice);
    next ??= { ...rows };
    delete next[row.id];
    next[id] ??= { ...row, id, subject };
  }
  return next;
}

function isEmpty(row: DraftRow): boolean {
  return !row.stance && !row.statement?.trim() && !row.privateNote?.trim();
}

export interface RowFields {
  writeIn?: true;
  stance?: Stance;
  statement?: string;
  privateNote?: string;
}

/** One `patch` call, for `patchMany`. */
export interface RowPatch {
  subject: Subject;
  choice: string | undefined;
  fields: RowFields;
}

export function applyPatch(
  current: DraftMap,
  electionId: string,
  subject: Subject,
  choice: string | undefined,
  fields: RowFields,
): DraftMap {
  const id = rowIdFor(electionId, subject, choice);
  const existing = current[id];
  const merged: DraftRow = {
    id,
    electionId,
    subject,
    choice,
    ...(("writeIn" in fields ? fields.writeIn : existing?.writeIn)
      ? { writeIn: true as const }
      : {}),
    stance: "stance" in fields ? fields.stance : existing?.stance,
    statement: "statement" in fields ? fields.statement : existing?.statement,
    privateNote: "privateNote" in fields ? fields.privateNote : existing?.privateNote,
    updatedAt: new Date().toISOString(),
  };
  if (isEmpty(merged)) {
    if (!existing) return current;
    const next = { ...current };
    delete next[id];
    return next;
  }
  return { ...current, [id]: merged };
}

export function useBallotDraft(): {
  rows: DraftMap;
  patch: (
    electionId: string,
    subject: Subject,
    choice: string | undefined,
    fields: RowFields,
  ) => void;
  /** Several patches as one change (a quick fill). */
  patchMany: (electionId: string, patches: RowPatch[]) => void;
  /** Put rows back as they were (undo): `undefined` removes the row. */
  restore: (previous: Record<string, DraftRow | undefined>) => void;
  clearRow: (id: string) => void;
  clearElection: (electionId: string) => void;
  clearAll: () => void;
  /** Move marks on re-filed races to the races as they're filed now (`refiledRows`). */
  refile: (subjects: readonly Subject[]) => void;
} {
  const [rows] = useLocalStore(ballotDraftStore);

  const patch = useCallback(
    (electionId: string, subject: Subject, choice: string | undefined, fields: RowFields) => {
      ballotDraftStore.set((current) => applyPatch(current, electionId, subject, choice, fields));
    },
    [],
  );

  const patchMany = useCallback((electionId: string, patches: RowPatch[]) => {
    ballotDraftStore.set((current) =>
      patches.reduce(
        (acc, { subject, choice, fields }) => applyPatch(acc, electionId, subject, choice, fields),
        current,
      ),
    );
  }, []);

  const restore = useCallback((previous: Record<string, DraftRow | undefined>) => {
    ballotDraftStore.set((current) => {
      const next = { ...current };
      for (const [id, row] of Object.entries(previous)) {
        if (row) next[id] = row;
        else delete next[id];
      }
      return next;
    });
  }, []);

  const clearRow = useCallback((id: string) => {
    ballotDraftStore.set((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const clearElection = useCallback((electionId: string) => {
    ballotDraftStore.set((current) => {
      const next: DraftMap = {};
      for (const [k, v] of Object.entries(current)) {
        if (v.electionId !== electionId) next[k] = v;
      }
      return next;
    });
  }, []);

  const clearAll = useCallback(() => ballotDraftStore.set({}), []);

  const refile = useCallback((subjects: readonly Subject[]) => {
    ballotDraftStore.set((current) => refiledRows(current, subjects) ?? current);
  }, []);

  return { rows, patch, patchMany, restore, clearRow, clearElection, clearAll, refile };
}

/** Per-contest ranking: ordered list of candidate names (most preferred first). */
export function useBallotRanking(): {
  rankings: RankingMap;
  setRanking: (electionId: string, subject: Subject, order: string[]) => void;
  clearRanking: (electionId: string, subject: Subject) => void;
} {
  const [rankings] = useLocalStore(rankingStore);

  const setRanking = useCallback((electionId: string, subject: Subject, order: string[]) => {
    rankingStore.set((current) => ({ ...current, [rankingKeyFor(electionId, subject)]: order }));
  }, []);

  const clearRanking = useCallback((electionId: string, subject: Subject) => {
    rankingStore.set((current) => {
      const key = rankingKeyFor(electionId, subject);
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  return { rankings, setRanking, clearRanking };
}

export { rankingKeyFor };
