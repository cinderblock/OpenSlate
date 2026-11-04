/**
 * Reading a county's whole count, whatever its feed: which files to fetch, in
 * what order, and how to tell a new report from the last one. Used by the
 * relay's recorder (apps/poll-cache), which fetches with an honest User-Agent
 * and keeps every file it reads. See plans/live-recorder.md.
 */

import {
  ACVOTE_PAGE_PATH,
  type CountyContest,
  type CountyFeed,
  claritySummaryPath,
  lvtPagePath,
  lvtSummaryPath,
  parseAcvoteHtml,
  parseClaritySummary,
  parseClarityVersion,
  parseLaVote,
  parseLvtCsv,
  parseLvtHtml,
  parseResultsApi,
} from "./countyResults";

/** A file as fetched from a county. */
export interface FeedFile {
  /** The path under the feed's base (`current_ver.txt`, `summary_24.csv`). */
  path: string;
  status: number;
  contentType: string;
  /** `Last-Modified`, ms since epoch. */
  lastModified?: number;
  /** `ETag`, as sent. */
  etag?: string;
  text: string;
}

/** What a feed's last file said about itself, to ask only for a newer one. */
export interface FileValidators {
  lastModified?: number;
  etag?: string;
}

/**
 * Fetch one path under the feed's base. With validators, ask only for a newer
 * file (`If-Modified-Since`, `If-None-Match`): a 304 answer means nothing
 * changed. livevoterturnout.com and Los Angeles answer 304; Sacramento and
 * Alameda send no validators (checked 2026-11-04).
 */
export type FeedGet = (path: string, validators?: FileValidators) => Promise<FeedFile>;

export interface CountyReport {
  /** Tells this report from the next: Clarity's version, else a hash of the file. */
  version: string;
  /** The county's time for the report, when it gives one. */
  updated?: number;
  contests: CountyContest[];
  /** Every file read for it, as fetched: the pointer and the count for Clarity, else the count. */
  files: FeedFile[];
}

/** The path a feed's whole count is in (Clarity: after its version pointer). */
export function countyCountPath(feed: CountyFeed, version?: string): string {
  switch (feed.kind) {
    case "clarity":
      return version ? claritySummaryPath(version) : "current_ver.txt";
    case "lvt":
      return lvtSummaryPath(feed);
    case "lvt-html":
      return lvtPagePath(feed);
    case "acvote":
      return ACVOTE_PAGE_PATH;
    case "results-api":
      return "data";
    case "lavote":
      return "json";
  }
}

/** FNV-1a over the text, base 36: tells one file from the next, nothing more. */
export function textHash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

export class CountyAnswered extends Error {
  constructor(readonly status: number) {
    super(`The county answered ${status}`);
    this.name = "CountyAnswered";
  }
}

function ok(file: FeedFile): FeedFile {
  if (file.status < 200 || file.status >= 300) throw new CountyAnswered(file.status);
  return file;
}

function parse(
  feed: CountyFeed,
  text: string,
): { contests: CountyContest[]; asOf?: number | undefined } {
  switch (feed.kind) {
    case "clarity":
      return { contests: parseClaritySummary(JSON.parse(text)) };
    case "lvt":
      return { contests: parseLvtCsv(text) };
    case "lvt-html":
      return parseLvtHtml(text);
    case "acvote":
      return parseAcvoteHtml(text);
    case "results-api":
      return parseResultsApi(JSON.parse(text));
    case "lavote":
      return parseLaVote(JSON.parse(text));
  }
}

/**
 * The county's count now, or `"unchanged"` when it's the report `previous`
 * describes (its version, and for a single-file feed its validators, asked
 * with a conditional GET). Clarity costs one tiny request when nothing moved.
 */
export async function readCountyReport(
  feed: CountyFeed,
  get: FeedGet,
  previous?: { version: string } & FileValidators,
): Promise<CountyReport | "unchanged"> {
  if (feed.kind === "clarity") {
    const pointer = ok(await get("current_ver.txt"));
    const version = parseClarityVersion(pointer.text);
    if (!version) throw new Error("The county hasn't published results yet");
    if (previous?.version === version) return "unchanged";
    const summary = ok(await get(claritySummaryPath(version)));
    return {
      version,
      ...(summary.lastModified !== undefined ? { updated: summary.lastModified } : {}),
      contests: parse(feed, summary.text).contests,
      files: [pointer, summary],
    };
  }
  const file = await get(
    countyCountPath(feed),
    previous && {
      ...(previous.lastModified !== undefined ? { lastModified: previous.lastModified } : {}),
      ...(previous.etag !== undefined ? { etag: previous.etag } : {}),
    },
  );
  if (file.status === 304) return "unchanged";
  ok(file);
  const version = textHash(file.text);
  if (previous?.version === version) return "unchanged";
  const { contests, asOf } = parse(feed, file.text);
  const updated = asOf ?? file.lastModified;
  return {
    version,
    ...(updated !== undefined ? { updated } : {}),
    contests,
    files: [file],
  };
}
