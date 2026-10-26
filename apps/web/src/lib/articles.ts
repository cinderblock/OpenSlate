import type { Article } from "@openslate/core";
import type { DecodedSlate } from "./collate";
import { formatElectionDate, formatLocalDate } from "./dates";
import { httpHref } from "./httpHref";
import { type Source, type Standing, standingOf } from "./sources";
import { subjectKey } from "./subjects";

/**
 * Articles attached to ballot items (SPEC §3.15): news, analysis, explainers
 * that slates link to a subject. Collated by subject identity, exactly as
 * positions are, with no curation step; never counted as support or
 * opposition. Pure; unit-tested in test/articles.test.ts.
 */

export interface AttachedArticle {
  href: string;
  title: string;
  publisher?: string;
  /** As the slate gives it: a date, or a date-time. */
  publishedAt?: string;
  kind?: string;
  summary?: string;
  /** The choices it's about; empty when it's about the race as a whole. */
  choices: string[];
  /** Who attached it: followed sources first. */
  attachedBy: Array<{ source: Source; standing: Standing; valid: boolean }>;
}

const STANDING_RANK: Record<Standing, number> = { follow: 0, disagree: 1, off: 2 };

/**
 * Every race's articles, by subject key: one per link, however many slates
 * attach it. Newest first, undated last. Only a source's newest slate that
 * attaches anything to a race speaks for it there, as with positions.
 */
export function articlesByRace(
  slates: DecodedSlate[],
  follows: Record<string, Standing>,
): Map<string, AttachedArticle[]> {
  const newest = new Map<string, DecodedSlate>();
  for (const slate of slates) {
    for (const article of slate.payload.articles ?? []) {
      const id = `${subjectKey(article.subject)}\u0000${slate.source.id}`;
      const current = newest.get(id);
      if (!current || slate.payload.issued_at > current.payload.issued_at) newest.set(id, slate);
    }
  }

  const byRace = new Map<string, Map<string, AttachedArticle>>();
  for (const slate of slates) {
    for (const article of slate.payload.articles ?? []) {
      const key = subjectKey(article.subject);
      if (newest.get(`${key}\u0000${slate.source.id}`) !== slate) continue;
      const href = httpHref(article.uri);
      if (!href) continue;
      let race = byRace.get(key);
      if (!race) {
        race = new Map();
        byRace.set(key, race);
      }
      const entry = race.get(href) ?? fromArticle(article, href);
      race.set(href, entry);
      if (article.choice && !entry.choices.includes(article.choice)) {
        entry.choices.push(article.choice);
      }
      if (!entry.attachedBy.some((a) => a.source.id === slate.source.id)) {
        entry.attachedBy.push({
          source: slate.source,
          standing: standingOf(follows, slate.source.id),
          valid: slate.valid,
        });
      }
    }
  }

  const out = new Map<string, AttachedArticle[]>();
  for (const [key, race] of byRace) {
    const list = [...race.values()];
    for (const entry of list) {
      entry.attachedBy.sort(
        (a, b) =>
          STANDING_RANK[a.standing] - STANDING_RANK[b.standing] ||
          a.source.name.localeCompare(b.source.name),
      );
    }
    list.sort(
      (a, b) =>
        Number(!a.publishedAt) - Number(!b.publishedAt) ||
        (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") ||
        a.title.localeCompare(b.title),
    );
    out.set(key, list);
  }
  return out;
}

function fromArticle(article: Article, href: string): AttachedArticle {
  return {
    href,
    title: article.title,
    ...(article.publisher ? { publisher: article.publisher } : {}),
    ...(article.published_at ? { publishedAt: article.published_at } : {}),
    ...(article.kind ? { kind: article.kind } : {}),
    ...(article.summary ? { summary: article.summary } : {}),
    choices: [],
    attachedBy: [],
  };
}

/** "Sep 30, 2026", in local time for a date-time; a bare date as written. */
export function articleDate(publishedAt: string | undefined): string {
  if (!publishedAt) return "";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(publishedAt) ? publishedAt : formatLocalDate(publishedAt);
  return formatElectionDate(day);
}
