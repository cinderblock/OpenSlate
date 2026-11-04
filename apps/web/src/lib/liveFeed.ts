import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useSyncExternalStore } from "react";
import { apiBase, getRoutingMode, PROVIDERS } from "./routing";

/**
 * New reports, as soon as OpenSlate's relay has them. The relay's recorder
 * checks each results feed (the Secretary of State, each county) on its own
 * schedule and tells pages over a WebSocket (`/api/live/<feed>`) when a new
 * report is in; a page then asks for the files again, by the report's version
 * (`?v=`), so no cache in between hands back the old one. Without a socket a
 * page asks just after the recorder's next check is due (`X-Ready-By`), not on
 * its own clock.
 *
 * Only through the relay: a page whose results come straight from the source
 * (Settings → Data routing) hears nothing from OpenSlate, and a self-hosted
 * server without a recorder is never asked. Never a fallback to the sources.
 * See plans/live-recorder.md.
 */

/** The Secretary of State's feed; a county's is its slug (`santa-clara`). */
export const SOS_FEED = "sos-ca";

interface FeedState {
  /** The feed's report: when the recorder last saw it change (ms since epoch). */
  version?: number;
  /** When the recorder's next report will be in. */
  readyBy?: number;
  /** When the recorder last checked the source. */
  checkedAt?: number;
  /** A socket is open and hearing from the recorder. */
  connected?: boolean;
}

const feeds = new Map<string, FeedState>();
const listeners = new Set<() => void>();
let snapshot = 0;

function update(feed: string, patch: Partial<FeedState>): void {
  const before = feeds.get(feed) ?? {};
  const after = { ...before, ...patch };
  if (patch.version !== undefined && before.version !== undefined && patch.version < before.version)
    after.version = before.version;
  feeds.set(feed, after);
  snapshot++;
  for (const l of listeners) l();
}

export function feedState(feed: string): FeedState {
  return feeds.get(feed) ?? {};
}

/** Which feed a results query reads: `["sos-ca", "county-ca", slug]` or `["sos-ca", id, …]`. */
export function feedOfKey(key: readonly unknown[]): string | undefined {
  if (key[0] !== "sos-ca") return undefined;
  if (key[1] === "county-ca") return typeof key[2] === "string" && key[2] ? key[2] : undefined;
  if (key[1] === "counties") return undefined;
  return SOS_FEED;
}

function providerOf(feed: string): string {
  return feed === SOS_FEED ? "sos-ca" : "county-ca";
}

/** Whether this feed's results come through OpenSlate's relay (not straight from the source). */
export function viaRelay(feed: string): boolean {
  return getRoutingMode(providerOf(feed)) !== "direct";
}

/** `url` asking for the feed's newest report by version, when known and through the relay. */
export function withVersion(url: string, feed: string): string {
  const v = feedState(feed).version;
  if (
    v === undefined ||
    !viaRelay(feed) ||
    !url.startsWith(PROVIDERS[providerOf(feed)]?.proxyUrl ?? "\0")
  )
    return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${v}`;
}

/** Note what the relay said about the feed's report (headers on a recorded answer). */
export function noteAnswer(feed: string, res: Response): void {
  const n = (h: string) => {
    const v = Number(res.headers.get(h) ?? "");
    return Number.isFinite(v) && v > 0 ? v : undefined;
  };
  const version = n("X-Report-Version");
  const readyBy = n("X-Ready-By");
  const checkedAt = n("X-Checked-At");
  if (version === undefined && readyBy === undefined) return;
  update(feed, {
    ...(version !== undefined ? { version } : {}),
    ...(readyBy !== undefined ? { readyBy } : {}),
    ...(checkedAt !== undefined ? { checkedAt } : {}),
  });
}

/** Re-render when any feed's state moves. */
export function useFeedStates(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshot,
    () => snapshot,
  );
}

// ---- Polling, lined up with the recorder ---------------------------------------

/** Every minute when nothing better is known: the page's old rhythm. */
const FALLBACK_MS = 60_000;
/** Never sooner than this after the last ask. */
const MIN_MS = 5_000;

/**
 * When a results query should ask again: a minute while a socket brings new
 * reports; otherwise just after the recorder's next report is due (a second
 * or few later, spread so a crowd doesn't arrive at once), else every minute.
 */
export function refetchDelay(feed: string | undefined, now: number, jitter: number): number {
  if (!feed) return FALLBACK_MS;
  const s = feedState(feed);
  if (s.connected || s.readyBy === undefined) return FALLBACK_MS;
  const wait = s.readyBy - now + 1_000 + jitter * 3_000;
  // Long overdue: the recorder is behind, so back to the minute rather than asking it every few seconds.
  if (wait < -FALLBACK_MS) return FALLBACK_MS;
  return Math.min(FALLBACK_MS, Math.max(MIN_MS, wait));
}

/** `refetchInterval` for a results query: lined up with its feed's recorder. */
export function liveRefetchInterval(query: { queryKey: readonly unknown[] }): number {
  return refetchDelay(feedOfKey(query.queryKey), Date.now(), Math.random());
}

// ---- The WebSocket ---------------------------------------------------------------

interface LiveMessage {
  type: "hello" | "report" | "checked";
  feed: string;
  version: number;
  checkedAt?: number;
  readyBy?: number;
}

function liveUrl(feed: string): string {
  const base = apiBase() || location.origin;
  return `${base.replace(/^http/, "ws")}/api/live/${feed}`;
}

/** Ask a feed's queries again, each after a moment's random wait (a crowd mustn't arrive at once). */
function refetchFeed(client: QueryClient, feed: string): void {
  for (const query of client.getQueryCache().findAll({ queryKey: ["sos-ca"], type: "active" })) {
    if (feedOfKey(query.queryKey) !== feed) continue;
    setTimeout(
      () => void client.refetchQueries({ queryKey: query.queryKey, exact: true }),
      Math.random() * 2_000,
    );
  }
}

const HEARTBEAT_MS = 30_000;
const MAX_BACKOFF_MS = 5 * 60_000;

/** One feed's socket while the page is in view; reconnects with backoff, quiet while hidden. */
function openFeed(feed: string, client: QueryClient): () => void {
  let ws: WebSocket | undefined;
  let closed = false;
  let backoff = 2_000;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let beat: ReturnType<typeof setInterval> | undefined;
  let lastHeard = 0;

  const stop = () => {
    clearTimeout(retry);
    clearInterval(beat);
    if (ws) {
      ws.onclose = null;
      ws.close();
      ws = undefined;
    }
    update(feed, { connected: false });
  };

  const connect = () => {
    if (closed || document.visibilityState !== "visible" || ws) return;
    const socket = new WebSocket(liveUrl(feed));
    ws = socket;
    socket.onopen = () => {
      backoff = 2_000;
      lastHeard = Date.now();
      beat = setInterval(() => {
        // No answer to the last heartbeat: the connection died quietly (a phone's network changed).
        if (Date.now() - lastHeard > 2 * HEARTBEAT_MS + 5_000) {
          stop();
          connect();
          return;
        }
        socket.send("ping");
      }, HEARTBEAT_MS);
    };
    socket.onmessage = (e) => {
      lastHeard = Date.now();
      if (e.data === "pong") return;
      let m: LiveMessage;
      try {
        m = JSON.parse(String(e.data)) as LiveMessage;
      } catch {
        return;
      }
      const before = feedState(feed).version;
      update(feed, {
        connected: true,
        version: m.version,
        ...(m.readyBy !== undefined ? { readyBy: m.readyBy } : {}),
        ...(m.checkedAt !== undefined ? { checkedAt: m.checkedAt } : {}),
      });
      // A report newer than what the page has: ask for it (also after reconnecting).
      if (before !== undefined ? m.version > before : m.type === "report")
        refetchFeed(client, feed);
    };
    socket.onclose = () => {
      clearInterval(beat);
      ws = undefined;
      update(feed, { connected: false });
      if (closed) return;
      retry = setTimeout(connect, backoff * (0.5 + Math.random()));
      backoff = Math.min(MAX_BACKOFF_MS, backoff * 2);
    };
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible") connect();
    else stop();
  };
  document.addEventListener("visibilitychange", onVisibility);
  connect();
  return () => {
    closed = true;
    document.removeEventListener("visibilitychange", onVisibility);
    stop();
  };
}

/** Whether OpenSlate's relay has a recorder (the public worker; not a self-hosted server). */
export function useRecorder(): boolean {
  const query = useQuery({
    queryKey: ["relay-health"],
    queryFn: async () => {
      const res = await fetch(`${apiBase()}/api/health`);
      if (!res.ok) return false;
      const body = (await res.json()) as { recorder?: boolean };
      return body.recorder === true;
    },
    staleTime: 60 * 60_000,
    retry: false,
  });
  return query.data === true;
}

/**
 * Hear new reports for these feeds while this page is open and in view (those
 * read through the relay, when it has a recorder).
 */
export function useLiveFeeds(feedNames: readonly string[]): void {
  const client = useQueryClient();
  const recorder = useRecorder();
  const key = [...new Set(feedNames)].filter(viaRelay).sort().join(",");
  useEffect(() => {
    if (!recorder || !key || typeof WebSocket === "undefined") return;
    const stops = key.split(",").map((feed) => openFeed(feed, client));
    return () => {
      for (const s of stops) s();
    };
  }, [recorder, key, client]);
}
