/**
 * Feedback, two ways (plans/feedback.md):
 *
 * - Public: a GitHub issue, opened from one of the repo's issue forms
 *   (`.github/ISSUE_TEMPLATE/`) with the message prefilled. Nothing is sent
 *   from here; the user reviews and submits it on GitHub.
 * - Private: a report to our own telemetry-collector, with an optional email
 *   and an optional screenshot the user chose to take or attach.
 *
 * What a private report carries is exactly what the user typed or attached,
 * plus the route *template* they were on (e.g. "/results/$token", never the
 * slate in it), the build, and the feedback type. Never `location.href`: with
 * hash routing it holds whole signed slates. That's also why this posts to
 * the collector itself rather than through its SDK, which fills `url` from
 * `location.href` and swallows every failure, so the dialog couldn't say a
 * report didn't arrive.
 */

import { useSyncExternalStore } from "react";
import type { RouteTemplate } from "./usage";

export const REPO_URL = "https://github.com/cinderblock/openslate";
export const TAKEDOWN_URL = `${REPO_URL}/issues/new?template=takedown.yml`;

/** The short commit this build came from (vite.config.ts), or "dev". */
export const APP_VERSION: string = (import.meta.env?.VITE_COMMIT as string | undefined) ?? "dev";

export type FeedbackKind = "problem" | "wrong-info" | "idea";

export const FEEDBACK_KINDS: ReadonlyArray<{
  id: FeedbackKind;
  label: string;
  /** Issue form under `.github/ISSUE_TEMPLATE/`. */
  template: string;
  placeholder: string;
}> = [
  {
    id: "problem",
    label: "Something's broken",
    template: "problem.yml",
    placeholder: "What you did, what you expected, and what happened instead",
  },
  {
    id: "wrong-info",
    label: "Wrong information",
    template: "wrong-info.yml",
    placeholder: "What OpenSlate shows, and what it should show instead",
  },
  {
    id: "idea",
    label: "Idea",
    template: "idea.yml",
    placeholder: "What you'd like OpenSlate to do",
  },
];

function kindInfo(kind: FeedbackKind) {
  const info = FEEDBACK_KINDS.find((k) => k.id === kind);
  if (!info) throw new Error(`unknown feedback kind: ${kind}`);
  return info;
}

// ---------------------------------------------------------------------------
// Public: GitHub issue
// ---------------------------------------------------------------------------

/** GitHub refuses very long URLs; leave the message room under ~8 KB encoded. */
const MAX_ISSUE_URL = 7500;
const TITLE_LENGTH = 80;

/** First non-blank line of the message, cut to a title's length. */
export function issueTitle(message: string): string {
  const line =
    message
      .split(/\r?\n/)
      .find((l) => l.trim() !== "")
      ?.trim() ?? "";
  return line.length <= TITLE_LENGTH ? line : `${line.slice(0, TITLE_LENGTH - 1).trimEnd()}…`;
}

/**
 * A "new issue" link that opens the issue form for `kind` with the message,
 * page and version filled in (issue forms prefill a field from the query
 * parameter named by its `id`). A message too long for a URL is cut short,
 * with a note saying so; the user still has the full text in the dialog.
 */
export function githubIssueUrl(input: {
  kind: FeedbackKind;
  message: string;
  route?: RouteTemplate | null;
  version?: string;
}): string {
  const version = input.version ?? APP_VERSION;
  const build = (description: string) => {
    const params = new URLSearchParams({ template: kindInfo(input.kind).template });
    const title = issueTitle(input.message);
    if (title) params.set("title", title);
    if (description) params.set("description", description);
    if (input.route) params.set("page", input.route);
    params.set("version", version);
    return `${REPO_URL}/issues/new?${params}`;
  };

  const message = input.message.trim();
  let url = build(message);
  if (url.length <= MAX_ISSUE_URL) return url;

  const note = "\n\n(Cut short to fit in a link. Paste the rest here.)";
  let keep = message.length;
  while (keep > 0 && url.length > MAX_ISSUE_URL) {
    keep = Math.floor(keep * 0.9);
    url = build(`${message.slice(0, keep).trimEnd()}${note}`);
  }
  return url;
}

// ---------------------------------------------------------------------------
// Private: telemetry-collector
// ---------------------------------------------------------------------------

export interface PrivateFeedbackConfig {
  /** The collector's base URL, e.g. https://telemetry.tomsawyerlabs.com */
  endpoint: string;
  /** Public per-app ingest key. Not a secret: it ships in the bundle. */
  ingestKey: string;
}

/**
 * Where private feedback goes, from the build's environment, or null when this
 * build has nowhere to send it (then only the GitHub route is offered).
 */
export function privateFeedbackConfig(
  env: Record<string, unknown> = (import.meta.env as Record<string, unknown> | undefined) ?? {},
): PrivateFeedbackConfig | null {
  const endpoint =
    typeof env.VITE_TELEMETRY_ENDPOINT === "string" ? env.VITE_TELEMETRY_ENDPOINT : "";
  const ingestKey = typeof env.VITE_TELEMETRY_KEY === "string" ? env.VITE_TELEMETRY_KEY : "";
  if (!endpoint.trim() || !ingestKey.trim()) return null;
  try {
    if (new URL(endpoint).protocol !== "https:" && !import.meta.env?.DEV) return null;
  } catch {
    return null;
  }
  return { endpoint: endpoint.trim().replace(/\/+$/, ""), ingestKey: ingestKey.trim() };
}

/** The collector's default attachment cap is 3 MB; stay well under it. */
export const MAX_SCREENSHOT_BYTES = 2.5 * 1024 * 1024;

/** Message length the dialog allows; the collector's body cap is 256 KB. */
export const MAX_MESSAGE_LENGTH = 20_000;

/** telemetry-collector's native report body. Every field here is deliberate. */
export interface FeedbackReport {
  kind: "feedback";
  level: "info";
  message: string;
  /** The route template, never the URL. */
  url?: RouteTemplate;
  tags: { type: FeedbackKind };
  user?: { email: string };
  release: string;
  environment: "production" | "development";
  timestamp: number;
}

export function buildFeedbackReport(input: {
  kind: FeedbackKind;
  message: string;
  email?: string;
  route?: RouteTemplate | null;
  version?: string;
  now?: Date;
}): FeedbackReport {
  const report: FeedbackReport = {
    kind: "feedback",
    level: "info",
    message: input.message.trim().slice(0, MAX_MESSAGE_LENGTH),
    tags: { type: input.kind },
    release: input.version ?? APP_VERSION,
    environment: import.meta.env?.DEV ? "development" : "production",
    timestamp: Math.floor((input.now ?? new Date()).getTime() / 1000),
  };
  if (input.route) report.url = input.route;
  const email = input.email?.trim();
  if (email) report.user = { email };
  return report;
}

export type SendResult = { ok: true } | { ok: false; error: string };

/**
 * Posts one report. Resolves (never throws) with whether the collector
 * actually kept it, and if not, a sentence the dialog can show.
 */
export async function sendPrivateFeedback(
  config: PrivateFeedbackConfig,
  report: FeedbackReport,
  screenshot?: Blob | null,
  fetchImpl: typeof fetch = fetch,
): Promise<SendResult> {
  const url = `${config.endpoint}/i/${encodeURIComponent(config.ingestKey)}`;
  const body = JSON.stringify(report);

  let response: Response;
  try {
    if (screenshot) {
      const form = new FormData();
      form.set("report", body);
      const ext = screenshot.type === "image/jpeg" ? "jpg" : "png";
      form.set("screenshot", screenshot, `screenshot.${ext}`);
      response = await fetchImpl(url, { method: "POST", body: form });
    } else {
      response = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
    }
  } catch {
    return { ok: false, error: "Couldn't reach the feedback server. Check your connection." };
  }

  if (response.ok) {
    // 202 with `stored: "full"` means the message was kept. Under heavy load
    // the collector may only count a report; then the words are gone.
    const result = (await response.json().catch(() => null)) as { stored?: string } | null;
    if (result?.stored === undefined || result.stored === "full") return { ok: true };
    return { ok: false, error: "The feedback server is too busy to keep messages right now." };
  }
  switch (response.status) {
    case 413:
      return { ok: false, error: "That's too big to send. Try a smaller screenshot, or none." };
    case 429:
      return { ok: false, error: "The feedback server is getting too much right now." };
    default:
      return { ok: false, error: `The feedback server said no (HTTP ${response.status}).` };
  }
}

// ---------------------------------------------------------------------------
// Dialog open state
// ---------------------------------------------------------------------------

/** Whether the feedback dialog is open. Page state, not persisted. */
let open = false;
const listeners = new Set<() => void>();

function setOpen(next: boolean): void {
  open = next;
  for (const listener of listeners) listener();
}

/** Text a "Report this" link wants in the dialog while it's open. */
let prefill: { kind: FeedbackKind; message: string } | null = null;

export const openFeedback = (): void => {
  prefill = null;
  setOpen(true);
};

export const closeFeedback = (): void => {
  prefill = null;
  setOpen(false);
};

/** Open the dialog with a report already written (the user still reviews and sends it). */
export function reportFeedback(kind: FeedbackKind, message: string): void {
  prefill = { kind, message };
  setOpen(true);
}

/** The prefilled report the dialog was opened with, if any. */
export function feedbackPrefill(): { kind: FeedbackKind; message: string } | null {
  return prefill;
}

export function useFeedbackOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => open,
  );
}
