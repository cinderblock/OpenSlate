import { useEffect, useMemo, useState } from "react";
import { type DecodedSlate, decodeSlates, isDecoded } from "./collate";

/**
 * Verifying a slate (schema check plus an Ed25519 signature) takes a couple of
 * milliseconds, more on a phone. A few hundred of them in one render froze the
 * page, tabs and all, for seconds. This does the same work a slice at a time,
 * handing the page back between slices so it stays responsive and can show how
 * far along it is. Results land in `decodeSlates`' cache, so the next page that
 * asks gets them for free.
 */

/** The next task, without `setTimeout`'s once-a-second crawl in a background tab. */
export function yieldToPage(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}

type Row = { token: string; importedAt: string };

export interface SliceOptions {
  yieldToPage: () => Promise<void>;
  now: () => number;
  /** How long one slice may run before the page gets a turn, in ms. */
  budgetMs?: number;
  signal?: AbortSignal;
  /** How many of `total` are verified so far; called between slices. */
  onProgress?: (done: number, total: number) => void;
  /** At least this long between progress reports, in ms. */
  progressMs?: number;
}

/** About half a frame: long enough to get through a few slates, short enough not to stutter. */
const SLICE_MS = 8;
/** How often progress is reported. */
const PROGRESS_MS = 250;

/**
 * `decodeSlates(rows)`, a slice at a time. Undefined when aborted. Slates
 * already verified cost nothing and don't start a slice of their own.
 */
export async function decodeSlatesInSlices(
  rows: Row[],
  {
    yieldToPage,
    now,
    budgetMs = SLICE_MS,
    signal,
    onProgress,
    progressMs = PROGRESS_MS,
  }: SliceOptions,
): Promise<DecodedSlate[] | undefined> {
  let sliceStart = now();
  let progressAt = sliceStart;
  for (let i = 0; i < rows.length; i++) {
    if (signal?.aborted) return undefined;
    const row = rows[i];
    if (!row || isDecoded(row.token)) continue;
    decodeSlates([row]);
    if (now() - sliceStart >= budgetMs) {
      // A few times a second: each report re-renders the page showing the bar.
      if (now() - progressAt >= progressMs) {
        onProgress?.(i + 1, rows.length);
        progressAt = now();
      }
      await yieldToPage();
      sliceStart = now();
    }
  }
  if (signal?.aborted) return undefined;
  // Every one is cached now: this only puts them together, in order.
  return decodeSlates(rows);
}

export interface DecodedSlatesState {
  /** Undefined until every slate is verified. */
  slates: DecodedSlate[] | undefined;
  /** How many are verified so far, of `total`. */
  done: number;
  total: number;
}

/**
 * `decodeSlates(rows)` without blocking the page: at once when they're all
 * verified already (no flash of a progress bar), otherwise a slice at a time
 * with progress. `rows` should be stable between renders, as a live query's are.
 */
export function useDecodedSlates(rows: Row[]): DecodedSlatesState {
  const cached = useMemo(
    () => (rows.every((row) => isDecoded(row.token)) ? decodeSlates(rows) : undefined),
    [rows],
  );
  const [result, setResult] = useState<{ rows: Row[]; slates: DecodedSlate[] }>();
  const [progress, setProgress] = useState<{ rows: Row[]; done: number }>();

  useEffect(() => {
    if (cached) return;
    const controller = new AbortController();
    void decodeSlatesInSlices(rows, {
      yieldToPage,
      now: () => performance.now(),
      signal: controller.signal,
      onProgress: (done) => setProgress({ rows, done }),
    }).then((slates) => {
      if (slates) setResult({ rows, slates });
    });
    return () => controller.abort();
  }, [rows, cached]);

  const slates = cached ?? (result?.rows === rows ? result.slates : undefined);
  return {
    slates,
    done: slates ? rows.length : progress?.rows === rows ? progress.done : 0,
    total: rows.length,
  };
}
