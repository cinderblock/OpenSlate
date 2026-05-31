import type { Stance, Subject } from "@openslate/core";
import { useCallback, useEffect, useState } from "react";
import { subjectKey } from "./subjects";

export interface DraftRow {
  /** `${electionId}|${subjectKey}|${choice ?? ""}` */
  id: string;
  electionId: string;
  subject: Subject;
  /** The candidate or option name; absent for measure-style subjects. */
  choice?: string;
  /** Public stance — included in generated slates. */
  stance?: Stance;
  /** Public statement — included in generated slates. */
  statement?: string;
  /** Private note — kept entirely on the user's device, never signed or shared. */
  privateNote?: string;
  updatedAt: string;
}

type DraftMap = Record<string, DraftRow>;
type RankingMap = Record<string, string[]>;

const KEY = "openslate.ballotDraft.v1";
const RANK_KEY = "openslate.ballotRanking.v1";

function load(): DraftMap {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as DraftMap) : {};
  } catch {
    return {};
  }
}

function persist(map: DraftMap): void {
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    // private mode etc. — in-memory only.
  }
}

function loadRankings(): RankingMap {
  try {
    const raw = localStorage.getItem(RANK_KEY);
    return raw ? (JSON.parse(raw) as RankingMap) : {};
  } catch {
    return {};
  }
}

function persistRankings(map: RankingMap): void {
  try {
    if (Object.keys(map).length === 0) localStorage.removeItem(RANK_KEY);
    else localStorage.setItem(RANK_KEY, JSON.stringify(map));
  } catch {
    // private mode etc.
  }
}

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

function isEmpty(row: DraftRow): boolean {
  return !row.stance && !row.statement?.trim() && !row.privateNote?.trim();
}

interface RowFields {
  stance?: Stance;
  statement?: string;
  privateNote?: string;
}

export function useBallotDraft(): {
  rows: DraftMap;
  patch: (
    electionId: string,
    subject: Subject,
    choice: string | undefined,
    fields: RowFields,
  ) => void;
  clearRow: (id: string) => void;
  clearElection: (electionId: string) => void;
  clearAll: () => void;
} {
  const [rows, setRows] = useState<DraftMap>(load);

  // Auto-persist on any change.
  useEffect(() => {
    persist(rows);
  }, [rows]);

  const patch = useCallback(
    (electionId: string, subject: Subject, choice: string | undefined, fields: RowFields) => {
      setRows((current) => {
        const id = rowIdFor(electionId, subject, choice);
        const existing = current[id];
        const merged: DraftRow = {
          id,
          electionId,
          subject,
          choice,
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
      });
    },
    [],
  );

  const clearRow = useCallback((id: string) => {
    setRows((current) => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }, []);

  const clearElection = useCallback((electionId: string) => {
    setRows((current) => {
      const next: DraftMap = {};
      for (const [k, v] of Object.entries(current)) {
        if (v.electionId !== electionId) next[k] = v;
      }
      return next;
    });
  }, []);

  const clearAll = useCallback(() => setRows({}), []);

  return { rows, patch, clearRow, clearElection, clearAll };
}

/** Per-contest ranking: ordered list of candidate names (most preferred first). */
export function useBallotRanking(): {
  rankings: RankingMap;
  setRanking: (electionId: string, subject: Subject, order: string[]) => void;
  clearRanking: (electionId: string, subject: Subject) => void;
} {
  const [rankings, setRankings] = useState<RankingMap>(loadRankings);

  useEffect(() => {
    persistRankings(rankings);
  }, [rankings]);

  const setRanking = useCallback((electionId: string, subject: Subject, order: string[]) => {
    setRankings((current) => ({ ...current, [rankingKeyFor(electionId, subject)]: order }));
  }, []);

  const clearRanking = useCallback((electionId: string, subject: Subject) => {
    setRankings((current) => {
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
