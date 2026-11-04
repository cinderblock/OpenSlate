/**
 * The recorder: one Durable Object per results feed (`sos-ca`, the California
 * Secretary of State, and one per county in `CA_COUNTY_FEEDS`). It checks its
 * source on a schedule (`nextCheck`: every minute on election night, slowing
 * to hourly as the source goes quiet, every 15 s around an announced release,
 * until the count is certified), and for each new report:
 *
 * 1. keeps an exact copy of every file in R2 (`REPORTS`, the audit trail),
 * 2. records each race's numbers as a history point (the same points a browser
 *    logs, `@openslate/core/liveRecord`), in its SQLite storage,
 * 3. tells every open page subscribed to the feed over a WebSocket.
 *
 * The relay then answers browsers from the recorder's copy, so a crowd costs a
 * source nothing more than the recorder's own checks. Public results only: it
 * keeps nothing about visitors. See plans/live-recorder.md.
 */

import { DurableObject } from "cloudflare:workers";
import {
  type FeedFile,
  type FileValidators,
  readCountyReport,
  textHash,
} from "@openslate/core/countyReport";
import { CA_COUNTY_FEEDS, COUNTY_RESULTS_USER_AGENT } from "@openslate/core/countyResults";
import {
  countyEntries,
  type RecordEntry,
  SOS_SENTINEL_PATH,
  sosEntries,
  sosRecordedPaths,
} from "@openslate/core/liveRecord";
import { samePerson } from "@openslate/core/names";
import { appendChoices, type RaceHistory } from "@openslate/core/raceHistory";
import { CA_2026_GENERAL, nextCheck, releaseTimes } from "@openslate/core/recordSchedule";
import { SOS_CA_UPSTREAM } from "./sosCa";

export interface RecorderEnv {
  RECORDER: DurableObjectNamespace<Recorder>;
  REPORTS: R2Bucket;
}

export const SOS_FEED = "sos-ca";

/** Every feed the recorder follows. */
export function recordedFeeds(): string[] {
  return [SOS_FEED, ...Object.keys(CA_COUNTY_FEEDS)];
}

export function isRecordedFeed(feed: string): boolean {
  return feed === SOS_FEED || Object.hasOwn(CA_COUNTY_FEEDS, feed);
}

/** The recorder's newest copy of a file, and what the relay says about it. */
export interface Latest {
  r2Key: string;
  contentType: string;
  /** The source's `Last-Modified`, ms since epoch. */
  lastModified?: number;
  /** The feed's report: when the recorder last saw anything in it change (ms since epoch). */
  version: number;
  /** When the recorder last checked the source. */
  checkedAt?: number;
  /** When the next check's report will be in (its start, plus time to fetch it). */
  readyBy?: number;
}

/** What a page hears over the feed's WebSocket. */
export type LiveMessage = {
  type: "hello" | "report" | "checked";
  feed: string;
  version: number;
  checkedAt?: number;
  readyBy?: number;
};

/** How long a check takes to fetch, beyond its start: the state's ~220 files take a while. */
function fetchAllowance(feed: string): number {
  return feed === SOS_FEED ? 20_000 : 5_000;
}

/** Checks of the state after its report moves: its files don't all move at once. */
const SOS_SETTLE_CHECKS = 2;
/** A district not on this ballot (an empty 500) is asked about again after a day. */
const ABSENT_RECHECK_MS = 24 * 60 * 60 * 1000;
/** Requests to a source at once during a check. */
const CONCURRENCY = 6;
/** When a check fails: try again in this long (the schedule picks up after). */
const RETRY_MS = 2 * 60 * 1000;

type FileRow = {
  path: string;
  hash: string;
  r2_key: string;
  content_type: string;
  last_modified: number | null;
  etag: string | null;
  absent_until: number | null;
};

export class Recorder extends DurableObject<RecorderEnv> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: RecorderEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS files (
        path TEXT PRIMARY KEY, hash TEXT NOT NULL, r2_key TEXT NOT NULL,
        content_type TEXT NOT NULL, last_modified INTEGER, etag TEXT,
        seen_at INTEGER NOT NULL, absent_until INTEGER
      );
      CREATE TABLE IF NOT EXISTS races (id TEXT PRIMARY KEY, names TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS points (
        id TEXT NOT NULL, at INTEGER NOT NULL, p REAL, v TEXT NOT NULL, PRIMARY KEY (id, at)
      );
    `);
    // Answered without waking the object: a page's heartbeat.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ---- State --------------------------------------------------------------------

  private meta(k: string): string | undefined {
    const row = this.sql.exec<{ v: string }>("SELECT v FROM meta WHERE k = ?", k).toArray()[0];
    return row?.v;
  }

  private metaNum(k: string): number | undefined {
    const v = this.meta(k);
    return v === undefined ? undefined : Number(v);
  }

  private setMeta(k: string, v: string | number): void {
    this.sql.exec("INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)", k, String(v));
  }

  private feed(): string {
    const feed = this.meta("feed");
    if (!feed) throw new Error("recorder not started");
    return feed;
  }

  private file(path: string): FileRow | undefined {
    return this.sql.exec<FileRow>("SELECT * FROM files WHERE path = ?", path).toArray()[0] as
      | FileRow
      | undefined;
  }

  private version(): number {
    return this.metaNum("changedAt") ?? 0;
  }

  private readyBy(): number | undefined {
    const next = this.metaNum("nextCheck");
    return next === undefined ? undefined : next + fetchAllowance(this.feed());
  }

  // ---- RPC from the worker ------------------------------------------------------

  /** Follow `feed`, if not already: called by the worker's cron, so a lost alarm is found within minutes. */
  async start(feed: string): Promise<void> {
    if (!isRecordedFeed(feed)) throw new Error(`not a feed: ${feed}`);
    if (!this.meta("feed")) this.setMeta("feed", feed);
    if ((await this.ctx.storage.getAlarm()) === null) {
      const plan = nextCheck(Date.now(), this.metaNum("changedAt"), [], CA_2026_GENERAL);
      if (plan) await this.ctx.storage.setAlarm(Date.now());
    }
  }

  /** Where the recorder stands, for `/api/recorder` (public: nothing here is about visitors). */
  async status(): Promise<Record<string, string | number | null>> {
    const files = this.sql
      .exec<{ kept: number; absent: number }>(
        "SELECT SUM(absent_until IS NULL) AS kept, SUM(absent_until IS NOT NULL) AS absent FROM files",
      )
      .toArray()[0];
    const races = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM races").toArray()[0];
    const points = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM points").toArray()[0];
    const iso = (k: string) => {
      const v = this.metaNum(k);
      return v === undefined ? null : new Date(v).toISOString();
    };
    return {
      feed: this.meta("feed") ?? null,
      checkedAt: iso("checkedAt"),
      changedAt: iso("changedAt"),
      nextCheck: iso("nextCheck"),
      quick: this.meta("quick") === "1" ? 1 : 0,
      files: files?.kept ?? 0,
      absent: files?.absent ?? 0,
      races: races?.n ?? 0,
      points: points?.n ?? 0,
      sockets: this.ctx.getWebSockets().length,
      error: this.meta("error") ?? null,
    };
  }

  /** The recorder's newest copy of `path`, or null when it keeps none (the relay passes it through). */
  async latest(path: string): Promise<Latest | null> {
    if (!this.meta("feed")) return null;
    const row = this.file(path);
    if (!row || row.absent_until !== null) return null;
    const checkedAt = this.metaNum("checkedAt");
    const readyBy = this.readyBy();
    return {
      r2Key: row.r2_key,
      contentType: row.content_type,
      ...(row.last_modified !== null ? { lastModified: row.last_modified } : {}),
      version: this.version(),
      ...(checkedAt !== undefined ? { checkedAt } : {}),
      ...(readyBy !== undefined ? { readyBy } : {}),
    };
  }

  /** A race's history as recorded, in the browser's shape; undefined when the recorder has none. */
  async history(id: string): Promise<RaceHistory | null> {
    let race = this.sql
      .exec<{ id: string; names: string }>("SELECT id, names FROM races WHERE id = ?", id)
      .toArray()[0];
    // A justice's id comes from the catalog's spelling of the name; the state's may differ ("Kelli M. Evans").
    if (!race && id.startsWith("supreme-court/")) {
      const want = id.slice("supreme-court/".length).replace(/-/g, " ");
      race = this.sql
        .exec<{ id: string; names: string }>(
          "SELECT id, names FROM races WHERE id LIKE 'supreme-court/%'",
        )
        .toArray()
        .find((r) => samePerson(r.id.slice("supreme-court/".length).replace(/-/g, " "), want));
    }
    if (!race) return null;
    const names = JSON.parse(race.names) as string[];
    const points = this.sql
      .exec<{ at: number; p: number | null; v: string }>(
        "SELECT at, p, v FROM points WHERE id = ? ORDER BY at",
        race.id,
      )
      .toArray()
      .map((row) => {
        const v = JSON.parse(row.v) as number[];
        return {
          at: row.at,
          ...(row.p !== null ? { p: row.p } : {}),
          v: [...v, ...Array(Math.max(0, names.length - v.length)).fill(0)],
        };
      });
    return { names, points };
  }

  // ---- WebSockets ----------------------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket")
      return new Response("Expected a WebSocket", { status: 426 });
    const [client, server] = Object.values(new WebSocketPair()) as [WebSocket, WebSocket];
    this.ctx.acceptWebSocket(server);
    if (this.meta("feed")) server.send(JSON.stringify(this.message("hello")));
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(): Promise<void> {
    // Pages send nothing but the heartbeat, which the auto-response answers.
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    try {
      ws.close(code === 1005 ? 1000 : code, "closing");
    } catch {
      // Already closed.
    }
  }

  private message(type: LiveMessage["type"]): LiveMessage {
    const checkedAt = this.metaNum("checkedAt");
    const readyBy = this.readyBy();
    return {
      type,
      feed: this.feed(),
      version: this.version(),
      ...(checkedAt !== undefined ? { checkedAt } : {}),
      ...(readyBy !== undefined ? { readyBy } : {}),
    };
  }

  private broadcast(message: LiveMessage): void {
    const text = JSON.stringify(message);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(text);
      } catch {
        // A socket closing as we send: the page reconnects.
      }
    }
  }

  // ---- Checks --------------------------------------------------------------------

  override async alarm(): Promise<void> {
    const feed = this.meta("feed");
    if (!feed) return;
    const now = Date.now();
    const quick = this.meta("quick") === "1";
    let changed = false;
    let failed = false;
    try {
      changed = feed === SOS_FEED ? await this.checkSos(quick) : await this.checkCounty(feed);
      this.setMeta("checkedAt", Date.now());
      if (changed) this.setMeta("changedAt", Date.now());
      this.sql.exec("DELETE FROM meta WHERE k = 'error'");
    } catch (e) {
      failed = true;
      this.setMeta("error", `${new Date(now).toISOString()} ${String(e)}`);
    }
    const plan = nextCheck(
      Date.now(),
      this.metaNum("changedAt"),
      releaseTimes(feed),
      CA_2026_GENERAL,
    );
    if (plan) {
      const at = failed ? Math.max(plan.at, Date.now() + RETRY_MS) : plan.at;
      this.setMeta("nextCheck", at);
      this.setMeta("quick", plan.quick && !failed ? "1" : "0");
      await this.ctx.storage.setAlarm(at);
    } else {
      this.sql.exec("DELETE FROM meta WHERE k IN ('nextCheck', 'quick')");
    }
    this.broadcast(this.message(changed ? "report" : "checked"));
  }

  private async get(url: string, path: string, validators?: FileValidators): Promise<FeedFile> {
    const headers: Record<string, string> = { "User-Agent": COUNTY_RESULTS_USER_AGENT };
    if (validators?.etag) headers["If-None-Match"] = validators.etag;
    if (validators?.lastModified !== undefined)
      headers["If-Modified-Since"] = new Date(validators.lastModified).toUTCString();
    // Past every cache: the recorder is what the relay's answers come from.
    const res = await fetch(url, { headers, cache: "no-store" });
    const modified = Date.parse(res.headers.get("Last-Modified") ?? "");
    const etag = res.headers.get("ETag");
    return {
      path,
      status: res.status,
      contentType: res.headers.get("Content-Type") ?? "application/octet-stream",
      ...(Number.isFinite(modified) ? { lastModified: modified } : {}),
      ...(etag ? { etag } : {}),
      text: res.status === 304 ? "" : await res.text(),
    };
  }

  /** Keep a new copy of a file (R2 and the index); false when it's the copy already kept. */
  private async keep(feed: string, file: FeedFile, seenAt: number): Promise<boolean> {
    const hash = textHash(file.text);
    const row = this.file(file.path);
    if (row && row.hash === hash && row.absent_until === null) {
      // The same file: only its validators may have moved.
      this.sql.exec(
        "UPDATE files SET last_modified = ?, etag = ? WHERE path = ?",
        file.lastModified ?? null,
        file.etag ?? null,
        file.path,
      );
      return false;
    }
    const stamp = new Date(seenAt).toISOString().replace(/[:.]/g, "-");
    const r2Key = `${feed}/${file.path}/${stamp}-${hash}`;
    await this.env.REPORTS.put(r2Key, file.text, {
      httpMetadata: { contentType: file.contentType },
      customMetadata: {
        fetchedAt: new Date(seenAt).toISOString(),
        ...(file.lastModified !== undefined
          ? { lastModified: new Date(file.lastModified).toISOString() }
          : {}),
        ...(file.etag ? { etag: file.etag } : {}),
      },
    });
    this.sql.exec(
      `INSERT OR REPLACE INTO files (path, hash, r2_key, content_type, last_modified, etag, seen_at, absent_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      file.path,
      hash,
      r2Key,
      file.contentType,
      file.lastModified ?? null,
      file.etag ?? null,
      seenAt,
    );
    return true;
  }

  /** Add each race's numbers as a history point, unless they're what it last said. */
  private record(entries: readonly RecordEntry[], fallbackAt: number): void {
    for (const e of entries) {
      const race = this.sql
        .exec<{ names: string }>("SELECT names FROM races WHERE id = ?", e.id)
        .toArray()[0];
      const last = this.sql
        .exec<{ at: number; p: number | null; v: string }>(
          "SELECT at, p, v FROM points WHERE id = ? ORDER BY at DESC LIMIT 1",
          e.id,
        )
        .toArray()[0];
      const names = race ? (JSON.parse(race.names) as string[]) : [];
      const before: RaceHistory | undefined = race
        ? {
            names,
            points: last
              ? [
                  {
                    at: last.at,
                    ...(last.p !== null ? { p: last.p } : {}),
                    v: [
                      ...(JSON.parse(last.v) as number[]),
                      ...Array(
                        Math.max(0, names.length - (JSON.parse(last.v) as number[]).length),
                      ).fill(0),
                    ],
                  },
                ]
              : [],
          }
        : undefined;
      const after = appendChoices(before, e.choices, e.p, e.at ?? fallbackAt);
      if (after === before) continue;
      const point = after.points.at(-1);
      if (!point) continue;
      if (!race || after.names.length !== names.length)
        this.sql.exec(
          "INSERT OR REPLACE INTO races (id, names) VALUES (?, ?)",
          e.id,
          JSON.stringify(after.names),
        );
      this.sql.exec(
        "INSERT OR REPLACE INTO points (id, at, p, v) VALUES (?, ?, ?, ?)",
        e.id,
        point.at,
        point.p ?? null,
        JSON.stringify(point.v),
      );
    }
  }

  private async checkCounty(slug: string): Promise<boolean> {
    const feed = CA_COUNTY_FEEDS[slug];
    if (!feed) throw new Error(`no feed ${slug}`);
    const version = this.meta("countVersion");
    const count = version
      ? this.sql
          .exec<FileRow>("SELECT * FROM files WHERE path = ?", this.meta("countPath") ?? "")
          .toArray()[0]
      : undefined;
    const report = await readCountyReport(
      feed,
      (path, validators) => this.get(`${feed.base}/${path}${feed.query ?? ""}`, path, validators),
      version
        ? {
            version,
            ...(count?.last_modified != null ? { lastModified: count.last_modified } : {}),
            ...(count?.etag ? { etag: count.etag } : {}),
          }
        : undefined,
    );
    if (report === "unchanged") return false;
    const seenAt = Date.now();
    let kept = false;
    for (const file of report.files) kept = (await this.keep(slug, file, seenAt)) || kept;
    this.setMeta("countVersion", report.version);
    const countFile = report.files.at(-1);
    if (countFile) this.setMeta("countPath", countFile.path);
    this.record(countyEntries(slug, report.contests, report.updated), seenAt);
    return kept;
  }

  private async checkSos(quick: boolean): Promise<boolean> {
    const now = Date.now();
    const sentinel = await this.get(`${SOS_CA_UPSTREAM}/${SOS_SENTINEL_PATH}`, SOS_SENTINEL_PATH);
    if (sentinel.status !== 200) throw new Error(`Secretary of State answered ${sentinel.status}`);
    const moved = this.file(SOS_SENTINEL_PATH)?.hash !== textHash(sentinel.text);
    let settle = this.metaNum("settle") ?? 0;
    if (moved) settle = SOS_SETTLE_CHECKS;
    else if (quick || settle === 0) {
      // Nothing new: only districts due a recheck, if any.
      const due = this.sql
        .exec<{ n: number }>(
          "SELECT COUNT(*) AS n FROM files WHERE absent_until IS NOT NULL AND absent_until <= ?",
          now,
        )
        .toArray()[0]?.n;
      const known = this.sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM files").toArray()[0]?.n;
      if (!due && known === sosRecordedPaths().length) return false;
    } else settle -= 1;
    this.setMeta("settle", settle);

    let kept = false;
    const paths = sosRecordedPaths().filter((p) => {
      const row = this.file(p);
      return !(row?.absent_until && row.absent_until > now);
    });
    const queue = [...paths];
    const work = async () => {
      for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
        const file =
          path === SOS_SENTINEL_PATH
            ? sentinel
            : await this.get(`${SOS_CA_UPSTREAM}/${path}`, path);
        if (file.status === 500 && !file.text.trim()) {
          // Not on this ballot (an odd-numbered State Senate seat in 2026).
          this.sql.exec(
            `INSERT OR REPLACE INTO files (path, hash, r2_key, content_type, seen_at, absent_until)
             VALUES (?, '', '', '', ?, ?)`,
            path,
            now,
            now + ABSENT_RECHECK_MS,
          );
          continue;
        }
        if (file.status !== 200) continue;
        if (!(await this.keep(SOS_FEED, file, now))) continue;
        kept = true;
        try {
          this.record(sosEntries(path, JSON.parse(file.text)), now);
        } catch {
          // Kept in R2 as sent; a file that doesn't parse has no races to record.
        }
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, work));
    return kept;
  }
}
