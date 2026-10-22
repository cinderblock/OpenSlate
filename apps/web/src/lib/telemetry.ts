/**
 * Where usage statistics go: our own telemetry-collector, through its SDK
 * (plans/usage-analytics.md). `usage.ts` decides *what* may be sent; this only
 * delivers what it hands over, already sanitized.
 *
 * Only the SDK's usage path is used. Nothing here calls its error capture,
 * breadcrumbs, feedback, user or tags: an error report can carry slate text,
 * and private feedback posts to the collector directly (`feedback.ts`).
 *
 * What one request carries: `{ events: [{ event, dims }], release,
 * environment }`. No user, device or session id, no URL.
 *
 * Batching lives here rather than in the SDK. The SDK holds usage events for a
 * few seconds and has no way to drop what it's holding, so switching stats off
 * would still send the last batch. Here a batch is checked against the switch
 * when it goes out, and switching off discards it at once.
 */

import { Client } from "telemetry-collector";
import { APP_VERSION, privateFeedbackConfig } from "./feedback";
import { type UsageSink, setUsageSink, usageEnabled } from "./usage";

/** How long events wait to share one request. */
export const USAGE_BATCH_MS = 5_000;

/** The part of the SDK's client this uses. */
export interface UsageTransport {
  track(event: string, options?: { dims?: Record<string, string> }): void;
  flushUsage(): Promise<void>;
}

export interface BatchingSink extends UsageSink {
  /** Send what's waiting now, if stats are still on. */
  flush(): void;
  /** Drop what's waiting, unsent. */
  discard(): void;
}

export function batchingSink(
  transport: UsageTransport,
  options: { isEnabled?: () => boolean; batchMs?: number } = {},
): BatchingSink {
  const isEnabled = options.isEnabled ?? usageEnabled;
  const batchMs = options.batchMs ?? USAGE_BATCH_MS;
  let pending: Array<{ name: string; dims?: Record<string, string> }> = [];
  let timer: ReturnType<typeof setTimeout> | undefined;

  function discard(): void {
    pending = [];
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function flush(): void {
    const batch = pending;
    discard();
    // Re-checked here, not only in `track`: another tab may have switched it off.
    if (batch.length === 0 || !isEnabled()) return;
    for (const { name, dims } of batch) transport.track(name, dims ? { dims } : {});
    void transport.flushUsage();
  }

  return {
    track(name, dims) {
      pending.push(dims ? { name, dims } : { name });
      timer ??= setTimeout(flush, batchMs);
    },
    flush,
    discard,
  };
}

/**
 * Connect usage statistics to the collector, if this build has one (the
 * endpoint and ingest key from vite.config.ts and .env.production). Sends
 * nothing by itself: events only flow once the user turns stats on.
 */
export function installUsageSink(): void {
  const config = privateFeedbackConfig();
  if (!config) return;

  const client = new Client({
    endpoint: config.endpoint,
    ingestKey: config.ingestKey,
    release: APP_VERSION,
    environment: import.meta.env?.DEV ? "development" : "production",
    // The SDK's own timer never fires first: batchingSink flushes each batch
    // as soon as it has handed it over.
    usageFlushMs: 60 * 60_000,
  });
  const sink = batchingSink(client);
  setUsageSink(sink);

  // A page being closed or put away is when a waiting batch would be lost.
  addEventListener("pagehide", sink.flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") sink.flush();
  });
}
