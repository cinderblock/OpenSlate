import { describe, expect, test } from "bun:test";
import {
  buildFeedbackReport,
  FEEDBACK_KINDS,
  githubIssueUrl,
  issueTitle,
  MAX_MESSAGE_LENGTH,
  privateFeedbackConfig,
  REPO_URL,
  sendPrivateFeedback,
} from "../src/lib/feedback";

const CONFIG = { endpoint: "https://telemetry.example", ingestKey: "openslate.prod.abc" };

describe("issueTitle", () => {
  test("first non-blank line, trimmed", () => {
    expect(issueTitle("\n\n  The map is blank  \nmore detail")).toBe("The map is blank");
  });
  test("cut to 80 characters with an ellipsis", () => {
    const title = issueTitle("x".repeat(200));
    expect(title.length).toBe(80);
    expect(title.endsWith("…")).toBe(true);
  });
  test("empty message, empty title", () => {
    expect(issueTitle("  \n ")).toBe("");
  });
});

describe("githubIssueUrl", () => {
  test("opens the kind's issue form with every field prefilled", () => {
    const url = new URL(
      githubIssueUrl({
        kind: "wrong-info",
        message: "Wrong district\nfor my address",
        route: "/race/$key",
        version: "abc1234",
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe(`${REPO_URL}/issues/new`);
    expect(url.searchParams.get("template")).toBe("wrong-info.yml");
    expect(url.searchParams.get("title")).toBe("Wrong district");
    expect(url.searchParams.get("description")).toBe("Wrong district\nfor my address");
    expect(url.searchParams.get("page")).toBe("/race/$key");
    expect(url.searchParams.get("version")).toBe("abc1234");
  });

  test("every kind names a template that exists", async () => {
    for (const kind of FEEDBACK_KINDS) {
      const file = Bun.file(
        new URL(`../../../.github/ISSUE_TEMPLATE/${kind.template}`, import.meta.url),
      );
      expect(await file.exists()).toBe(true);
      // The fields the app prefills must be ids in the form.
      const text = await file.text();
      for (const id of ["description", "page", "version"]) expect(text).toContain(`id: ${id}`);
    }
  });

  test("an empty message still opens the form, without title or description", () => {
    const url = new URL(githubIssueUrl({ kind: "idea", message: "   " }));
    expect(url.searchParams.get("template")).toBe("idea.yml");
    expect(url.searchParams.has("title")).toBe(false);
    expect(url.searchParams.has("description")).toBe(false);
  });

  test("a long message is cut to fit a URL, and says so", () => {
    const url = githubIssueUrl({ kind: "problem", message: "é".repeat(20_000) });
    expect(url.length).toBeLessThanOrEqual(7500);
    const description = new URL(url).searchParams.get("description") ?? "";
    expect(description).toContain("Cut short to fit in a link");
    expect(description.startsWith("éé")).toBe(true);
  });
});

describe("privateFeedbackConfig", () => {
  test("null unless both endpoint and key are set", () => {
    expect(privateFeedbackConfig({})).toBeNull();
    expect(privateFeedbackConfig({ VITE_TELEMETRY_ENDPOINT: "https://t.example" })).toBeNull();
    expect(privateFeedbackConfig({ VITE_TELEMETRY_KEY: "k" })).toBeNull();
    expect(
      privateFeedbackConfig({ VITE_TELEMETRY_ENDPOINT: "not a url", VITE_TELEMETRY_KEY: "k" }),
    ).toBeNull();
  });
  test("trims the key and trailing slashes", () => {
    expect(
      privateFeedbackConfig({
        VITE_TELEMETRY_ENDPOINT: "https://t.example//",
        VITE_TELEMETRY_KEY: " k ",
      }),
    ).toEqual({ endpoint: "https://t.example", ingestKey: "k" });
  });
});

describe("buildFeedbackReport", () => {
  const now = new Date("2026-10-21T20:54:00Z");

  test("carries only the message, type, route template, build and optional email", () => {
    const report = buildFeedbackReport({
      kind: "problem",
      message: "  It broke  ",
      email: " me@example.com ",
      route: "/results/$token",
      version: "abc1234",
      now,
    });
    expect(report).toEqual({
      kind: "feedback",
      level: "info",
      message: "It broke",
      url: "/results/$token",
      tags: { type: "problem" },
      user: { email: "me@example.com" },
      release: "abc1234",
      environment: report.environment,
      timestamp: Math.floor(now.getTime() / 1000),
    });
    expect(["production", "development"]).toContain(report.environment);
  });

  test("no email, no route: neither key appears", () => {
    const report = buildFeedbackReport({ kind: "idea", message: "hi", email: "  ", now });
    expect("user" in report).toBe(false);
    expect("url" in report).toBe(false);
  });

  test("the message is capped", () => {
    const report = buildFeedbackReport({ kind: "idea", message: "a".repeat(30_000), now });
    expect(report.message.length).toBe(MAX_MESSAGE_LENGTH);
  });
});

/** A fetch stand-in that records each request and answers with `respond`. */
function fakeFetch(respond: () => Response | Promise<Response>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return respond();
  }) as typeof fetch;
  return { calls, impl };
}

const accepted = (stored = "full") =>
  new Response(JSON.stringify({ ok: true, stored }), { status: 202 });

describe("sendPrivateFeedback", () => {
  const report = buildFeedbackReport({ kind: "problem", message: "hello", route: "/" });

  test("without a screenshot: one JSON POST to the ingest URL", async () => {
    const { calls, impl } = fakeFetch(() => accepted());
    expect(await sendPrivateFeedback(CONFIG, report, null, impl)).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://telemetry.example/i/openslate.prod.abc");
    expect(calls[0]?.init.method).toBe("POST");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(JSON.parse(JSON.stringify(report)));
  });

  test("with a screenshot: multipart with exactly `report` and `screenshot`", async () => {
    const { calls, impl } = fakeFetch(() => accepted());
    const shot = new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" });
    expect(await sendPrivateFeedback(CONFIG, report, shot, impl)).toEqual({ ok: true });
    const form = calls[0]?.init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect([...form.keys()].sort()).toEqual(["report", "screenshot"]);
    expect(JSON.parse(String(form.get("report")))).toEqual(JSON.parse(JSON.stringify(report)));
    const file = form.get("screenshot") as File;
    expect(file.name).toBe("screenshot.png");
    expect(file.size).toBe(4);
  });

  test("a report the server only counted is not a success", async () => {
    const { impl } = fakeFetch(() => accepted("counted"));
    const result = await sendPrivateFeedback(CONFIG, report, null, impl);
    expect(result.ok).toBe(false);
  });

  test("errors come back as sentences, never throws", async () => {
    for (const status of [400, 413, 429, 500]) {
      const { impl } = fakeFetch(() => new Response("{}", { status }));
      const result = await sendPrivateFeedback(CONFIG, report, null, impl);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.length).toBeGreaterThan(10);
    }
    const { impl } = fakeFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const result = await sendPrivateFeedback(CONFIG, report, null, impl);
    expect(result).toEqual({
      ok: false,
      error: "Couldn't reach the feedback server. Check your connection.",
    });
  });
});
