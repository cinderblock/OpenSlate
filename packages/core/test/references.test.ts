import { describe, expect, test } from "bun:test";
import {
  type GuideItem,
  guideReferences,
  guideReferencesSchema,
  isStatewideGuide,
  measureMentions,
  measureNumber,
  parseGuideReferences,
} from "../src/index";

const source = "https://example.gov/guide";
const passage = (text: string) => ({ blocks: [{ type: "p" as const, text: [text] }], source });

function measure(n: string, extra: Partial<GuideItem> = {}): GuideItem {
  return {
    v: 1,
    subject: { title: `California — Proposition ${n} (Something)`, kind: "measure" },
    retrieved_at: "2026-10-01T00:00:00Z",
    ...extra,
  };
}

function race(title: string, choice: string, statement: string): GuideItem {
  return {
    v: 1,
    subject: { title, kind: "race" },
    retrieved_at: "2026-10-01T00:00:00Z",
    candidates: [{ choice, statement: passage(statement) }],
  };
}

const numbers = (text: string) => measureMentions(text).map((m) => m.number);

describe("measureNumber", () => {
  test("from the heading, never from the description", () => {
    expect(measureNumber(measure("43").subject)).toBe("43");
    expect(
      measureNumber({ title: "Measure A (Repeals Prop 13)", kind: "measure" }),
    ).toBeUndefined();
  });

  test("a letter or a race has none", () => {
    expect(
      measureNumber({ title: "San Francisco — Proposition C", kind: "measure" }),
    ).toBeUndefined();
    expect(measureNumber({ title: "Proposition 5 Oversight Board", kind: "race" })).toBeUndefined();
  });
});

describe("measureMentions", () => {
  test("the ways a guide writes one", () => {
    expect(numbers("Proposition 40")).toEqual(["40"]);
    expect(numbers("Prop. 40 and Prop 41")).toEqual(["40", "41"]);
    expect(numbers("PROP. 41 WOULD")).toEqual(["41"]);
  });

  test("a list links each number on its own", () => {
    const text = "If Proposition 41 or 42 passes";
    expect(measureMentions(text).map((m) => text.slice(m.start, m.end))).toEqual([
      "Proposition 41",
      "42",
    ]);
    expect(numbers("Props 41, 42 and 43")).toEqual(["41", "42", "43"]);
  });

  test("one dated to another year isn't the one on this ballot", () => {
    expect(numbers("voters approved Proposition 30 in 2012")).toEqual([]);
    expect(numbers("November 2018 Proposition 3")).toEqual([]);
    expect(numbers("2024's Prop 1")).toEqual([]);
    expect(numbers("Prop 1 (2024)")).toEqual([]);
    expect(numbers("Prop 1 of 2024")).toEqual([]);
  });

  test("a letter, or a word that starts the same, is no mention", () => {
    expect(numbers("Proposition C and property 41")).toEqual([]);
  });

  test("a year after a list isn't read as a number in it", () => {
    expect(numbers("Prop 41, 2026 ballot")).toEqual([]);
  });
});

describe("guideReferences", () => {
  test("a mention, with the parts it's in, one way only", () => {
    const refs = guideReferences([
      measure("40"),
      measure("41", {
        analysis: passage("Proposition 40 could be stopped."),
        arguments: [
          {
            side: "No",
            rebuttal: false,
            blocks: [{ type: "p", text: [{ strong: ["Undoes Prop. 40."] }] }],
            signers: [],
            source,
          },
        ],
      }),
    ]);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.from.title).toContain("41");
    expect(refs[0]?.to.title).toContain("40");
    expect(refs[0]?.where).toEqual([{ part: "analysis" }, { part: "argument", choice: "No" }]);
  });

  test("a figure's alt text counts, and a measure's own number doesn't", () => {
    const refs = guideReferences([
      measure("40", {
        analysis: {
          blocks: [{ type: "img", file: "a.jpg", alt: "If Proposition 41 or Proposition 40" }],
          source,
        },
      }),
      measure("41"),
    ]);
    expect(refs.map((r) => r.to.title)).toEqual([measure("41").subject.title]);
  });

  test("a number that isn't on this ballot goes nowhere", () => {
    expect(guideReferences([measure("3", { about: passage("Like Proposition 13.") })])).toEqual([]);
  });

  test("a candidate's whole name, as printed, in another item", () => {
    const refs = guideReferences([
      race("Treasurer", "Fiona Ma", "A statement."),
      race("Controller", "Sam Lee", "Endorsed by Fiona Ma."),
      race("Assessor", "Pat Doe", "Endorsed by Fiona Mason."),
    ]);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.to.title).toBe("Treasurer");
    expect(refs[0]?.choice).toBe("Fiona Ma");
    expect(refs[0]?.where).toEqual([{ part: "statement", choice: "Sam Lee" }]);
  });

  test("an argument's signer counts, and a race never references itself", () => {
    const refs = guideReferences([
      race("Treasurer", "Fiona Ma", "I, Fiona Ma, am running."),
      measure("37", {
        arguments: [
          {
            side: "Yes",
            rebuttal: false,
            blocks: [],
            signers: [{ name: "Fiona Ma" }],
            source,
          },
        ],
      }),
    ]);
    expect(refs).toHaveLength(1);
    expect(refs[0]?.where).toEqual([{ part: "signer", choice: "Yes" }]);
  });

  test("names can be left out, for a guide whose races repeat them", () => {
    const items = [race("A", "Alex Padilla", "x"), race("B", "Sam Lee", "Backed by Alex Padilla.")];
    expect(guideReferences(items, { names: false })).toEqual([]);
  });
});

test("only a state's own guide is statewide", () => {
  expect(isStatewideGuide("us/ca")).toBe(true);
  expect(isStatewideGuide("us/ca/alameda")).toBe(false);
  expect(isStatewideGuide(undefined)).toBe(false);
});

test("what's written parses back", () => {
  const references = guideReferences([
    measure("40"),
    measure("41", { analysis: passage("Proposition 40") }),
  ]);
  const bytes = new TextEncoder().encode(JSON.stringify({ v: 1, references }));
  expect(parseGuideReferences(bytes).references).toEqual(references);
  expect(guideReferencesSchema.safeParse({ v: 1, references: [{}] }).success).toBe(false);
});
