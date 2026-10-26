import { describe, expect, test } from "bun:test";
import { type Article, createSlate, generateKeyPair } from "@openslate/core";
import { articleDate, articlesByRace } from "../src/lib/articles";
import { decodeSlates } from "../src/lib/collate";
import { subjectKey } from "../src/lib/subjects";

const prop = { title: "Prop 1", kind: "measure", jurisdiction: "us/ca", election: "2026-11-03" };
const KEY = subjectKey(prop);

function slate(name: string, articles: Article[], issuedAt = "2026-10-01T00:00:00Z") {
  return {
    token: createSlate({
      keyPair: generateKeyPair(),
      issuer: { name },
      issuedAt,
      articles,
    }).token,
    importedAt: "2026-10-02T00:00:00Z",
  };
}

const explainer: Article = {
  subject: prop,
  uri: "https://news.example/prop-1",
  title: "Prop 1, explained",
  publisher: "Example News",
  published_at: "2026-09-30",
  kind: "explainer",
};

describe("articlesByRace", () => {
  test("collated with the race they're attached to, one entry per link", () => {
    const slates = decodeSlates([
      slate("Example News", [explainer]),
      slate("A Voter", [{ ...explainer, title: "their own headline for it" }]),
    ]);
    const [entry, ...rest] = articlesByRace(slates, {}).get(KEY) ?? [];
    expect(rest).toEqual([]);
    expect(entry?.title).toBe("Prop 1, explained");
    expect(entry?.attachedBy.map((a) => a.source.name)).toEqual(["A Voter", "Example News"]);
  });

  test("followed sources listed first among who attached it", () => {
    const slates = decodeSlates([slate("Zed", [explainer]), slate("Amy", [explainer])]);
    const amy = slates.find((s) => s.source.name === "Amy")?.source.id ?? "";
    const [entry] = articlesByRace(slates, { [amy]: "off" }).get(KEY) ?? [];
    expect(entry?.attachedBy.map((a) => [a.source.name, a.standing])).toEqual([
      ["Zed", "follow"],
      ["Amy", "off"],
    ]);
  });

  test("newest first, undated last; the choices an article is about", () => {
    const slates = decodeSlates([
      slate("News", [
        { subject: prop, uri: "https://n.example/old", title: "Old", published_at: "2026-08-01" },
        { subject: prop, uri: "https://n.example/undated", title: "Undated" },
        {
          subject: prop,
          choice: "Yes",
          uri: "https://n.example/new",
          title: "New",
          published_at: "2026-10-20T09:00:00-07:00",
        },
      ]),
    ]);
    const list = articlesByRace(slates, {}).get(KEY) ?? [];
    expect(list.map((a) => [a.title, a.choices])).toEqual([
      ["New", ["Yes"]],
      ["Old", []],
      ["Undated", []],
    ]);
  });

  test("only a source's newest slate speaks for it", () => {
    const slates = decodeSlates([
      slate("News", [explainer], "2026-09-01T00:00:00Z"),
      slate(
        "News",
        [{ ...explainer, uri: "https://news.example/prop-1-update", title: "Update" }],
        "2026-10-01T00:00:00Z",
      ),
    ]);
    // Two key pairs, so two sources: both stand. Same key pair: only the newer.
    expect(articlesByRace(slates, {}).get(KEY)?.length).toBe(2);
    const keyPair = generateKeyPair();
    const same = (articles: Article[], issuedAt: string) => ({
      token: createSlate({ keyPair, issuer: { name: "News" }, issuedAt, articles }).token,
      importedAt: "2026-10-02T00:00:00Z",
    });
    const reissued = decodeSlates([
      same([explainer], "2026-09-01T00:00:00Z"),
      same(
        [{ ...explainer, uri: "https://news.example/u", title: "Update" }],
        "2026-10-01T00:00:00Z",
      ),
    ]);
    expect(
      articlesByRace(reissued, {})
        .get(KEY)
        ?.map((a) => a.title),
    ).toEqual(["Update"]);
  });

  test("articles aren't positions: they make no race", () => {
    const slates = decodeSlates([slate("News", [explainer])]);
    expect(slates[0]?.payload.positions).toEqual([]);
  });
});

test("articleDate: a bare date as written, a date-time in local time", () => {
  expect(articleDate("2026-09-30")).toBe(formatted(2026, 9, 30));
  expect(articleDate(undefined)).toBe("");
});

function formatted(y: number, m: number, d: number): string {
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
