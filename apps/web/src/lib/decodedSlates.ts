import type { SlatePayload } from "@openslate/core";
import { get, set } from "idb-keyval";
import { useEffect, useMemo, useState } from "react";
import {
  type DecodedSlate,
  decodeSlates,
  isDecoded,
  rememberVerified,
  verifyAhead,
} from "./collate";
import { throttleWrites } from "./throttleWrites";

/**
 * Verifying a slate (schema check plus an Ed25519 signature) takes a couple of
 * milliseconds, more on a phone. A few hundred of them in one render froze the
 * page, tabs and all, for seconds. This does the same work a slice at a time,
 * handing the page back between slices so it stays responsive and can show how
 * far along it is. Results land in `decodeSlates`' cache, so the next page that
 * asks gets them for free.
 */

import { yieldToPage } from "./yieldToPage";

export { yieldToPage };

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
  /** Check a few ahead at once, faster than one by one (`verifyAhead` in collate.ts). */
  verifyAhead?: (tokens: string[]) => Promise<void>;
}

/**
 * Checked ahead at once: enough in flight to be quick, few enough to fit a
 * slice. Each still parses its payload on the page, about 8 ms at 4x CPU
 * throttling, so 4 is a slice of about 30 ms.
 */
export const AHEAD = 4;

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
    verifyAhead: ahead,
  }: SliceOptions,
): Promise<DecodedSlate[] | undefined> {
  let sliceStart = now();
  let progressAt = sliceStart;
  for (let i = 0; i < rows.length; i++) {
    if (signal?.aborted) return undefined;
    // Whether this step cost anything: slates verified already don't.
    let worked = false;
    if (ahead && i % AHEAD === 0) {
      const next = rows
        .slice(i, i + AHEAD)
        .map((r) => r.token)
        .filter((t) => !isDecoded(t));
      if (next.length) {
        await ahead(next);
        worked = true;
      }
    }
    const row = rows[i];
    if (row && !isDecoded(row.token)) {
      decodeSlates([row]);
      worked = true;
    }
    // Checking ahead decodes a batch at once, so it counts as work too: only
    // counting a decode here left one long task for the lot.
    if (worked && now() - sliceStart >= budgetMs) {
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
 * The voter's slates verified on an earlier visit, so the next needn't check
 * them again: with a few hundred imported, checking them all on the page was
 * seconds of every visit's start on a phone. Browser storage is as trusted as
 * the app (catalogDeps.ts keeps the catalog's copy the same way). Only slates
 * that verified are kept; anything else is checked every time.
 */
export const KEPT_KEY = "openslate.verifiedSlates.v1";

type Kept = Array<[token: string, payload: SlatePayload]>;

let keptLoaded: Promise<void> | undefined;

/** What earlier visits verified, into `decodeSlates`' cache. Once a visit. */
export function loadKept(): Promise<void> {
  keptLoaded ??= get<Kept>(KEPT_KEY)
    .then((kept) => {
      for (const [token, payload] of kept ?? []) rememberVerified(token, payload);
    })
    .catch(() => undefined);
  return keptLoaded;
}

/** The tokens last kept, so the same set isn't written again. */
let keptTokens = "";
const keepLater = throttleWrites((kept: Kept) => set(KEPT_KEY, kept), 2000);

/** Keep these slates' verified results for the next visit, when they're new. */
function keep(slates: DecodedSlate[]): void {
  const valid = slates.filter((slate) => slate.valid && !slate.local);
  const tokens = valid.map((slate) => slate.token.slice(-24)).join();
  if (tokens === keptTokens) return;
  keptTokens = tokens;
  keepLater(valid.map((slate) => [slate.token, slate.payload]));
}

/**
 * `decodeSlates(rows)` without blocking the page: at once when they're all
 * verified already (no flash of a progress bar), otherwise a slice at a time
 * with progress. `rows` should be stable between renders, as a live query's are.
 */
export function useDecodedSlates(
  rows: Row[],
  /** These are the voter's imported slates: keep their results for the next visit. */
  { keepForNextVisit = false }: { keepForNextVisit?: boolean } = {},
): DecodedSlatesState {
  const cached = useMemo(
    () => (rows.every((row) => isDecoded(row.token)) ? decodeSlates(rows) : undefined),
    [rows],
  );
  const [result, setResult] = useState<{ rows: Row[]; slates: DecodedSlate[] }>();
  const [progress, setProgress] = useState<{ rows: Row[]; done: number }>();

  useEffect(() => {
    if (cached) return;
    const controller = new AbortController();
    void loadKept()
      .then(() =>
        decodeSlatesInSlices(rows, {
          yieldToPage,
          now: () => performance.now(),
          signal: controller.signal,
          onProgress: (done) => setProgress({ rows, done }),
          verifyAhead,
        }),
      )
      .then((slates) => {
        if (!slates) return;
        setResult({ rows, slates });
        if (keepForNextVisit) keep(slates);
      });
    return () => controller.abort();
  }, [rows, cached, keepForNextVisit]);

  // Verified already this visit (an import checks as it goes): kept all the same.
  useEffect(() => {
    if (cached && keepForNextVisit) keep(cached);
  }, [cached, keepForNextVisit]);

  const slates = cached ?? (result?.rows === rows ? result.slates : undefined);
  return {
    slates,
    done: slates ? rows.length : progress?.rows === rows ? progress.done : 0,
    total: rows.length,
  };
}
