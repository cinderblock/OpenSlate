import { type SlatePayload, type Stance, verifySlate } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { useMemo } from "react";
import { publishedCollection } from "./collections";
import type { PublishedSlate } from "./db";
import { subjectKey } from "./subjects";

/**
 * Slates the user signed in this browser, so My vote can show what they've
 * already put their name to on each race. Pure parts are unit-tested in
 * test/published.test.ts.
 */

export interface MyPublishedSlate extends PublishedSlate {
  payload: SlatePayload;
}

/** Decode stored rows, newest first. Unparseable tokens are dropped. */
export function decodePublished(rows: Iterable<PublishedSlate>): MyPublishedSlate[] {
  const out: MyPublishedSlate[] = [];
  for (const row of rows) {
    const result = verifySlate(row.token);
    if (!result.payload) continue;
    out.push({ ...row, payload: result.payload });
  }
  return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export interface MyPosition {
  issuerKey: string;
  issuerName?: string;
  stance: Stance;
  choice?: string;
  statement?: string;
  publishedAt: string;
  token: string;
}

/**
 * Race key → the user's positions on it. Only the newest slate per identity
 * counts for a race (that's how collation reads everyone's slates too), so a
 * re-sign replaces rather than piles up.
 */
export function myPositionsByRace(slates: MyPublishedSlate[]): Map<string, MyPosition[]> {
  const newest = [...slates].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
  const speaks = new Map<string, string>(); // `${race}\0${issuer}` → token that speaks
  const out = new Map<string, MyPosition[]>();
  for (const slate of newest) {
    const issuerKey = slate.payload.issuer.key;
    for (const position of slate.payload.positions) {
      const race = subjectKey(position.subject);
      const id = `${race}\u0000${issuerKey}`;
      const current = speaks.get(id);
      if (current && current !== slate.token) continue;
      speaks.set(id, slate.token);
      const list = out.get(race) ?? [];
      list.push({
        issuerKey,
        ...(slate.payload.issuer.name ? { issuerName: slate.payload.issuer.name } : {}),
        stance: position.stance,
        ...(position.choice ? { choice: position.choice } : {}),
        ...(position.statement ? { statement: position.statement } : {}),
        publishedAt: slate.publishedAt,
        token: slate.token,
      });
      out.set(race, list);
    }
  }
  return out;
}

export function usePublishedSlates(): { slates: MyPublishedSlate[]; isReady: boolean } {
  const { data, isReady } = useLiveQuery((q) => q.from({ published: publishedCollection }));
  const slates = useMemo(() => decodePublished(data), [data]);
  return { slates, isReady };
}

export function useMyPositionsByRace(): Map<string, MyPosition[]> {
  const { slates } = usePublishedSlates();
  return useMemo(() => myPositionsByRace(slates), [slates]);
}
