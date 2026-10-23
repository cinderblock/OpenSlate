import { describe, expect, test } from "bun:test";
import type { Subject } from "@openslate/core";
import { subjectFromKey, subjectKey } from "../src/lib/subjects";

describe("subjectFromKey", () => {
  test("round-trips a subjectKey", () => {
    const subject: Subject = {
      title: "Los Angeles Community College District Board, Seat 4",
      jurisdiction: "us/ca/los-angeles",
      election: "2026-11-03",
    };
    expect(subjectFromKey(subjectKey(subject))).toEqual(subject);
  });

  test("leaves out an empty jurisdiction or election", () => {
    expect(subjectFromKey(subjectKey({ title: "Governor" }))).toEqual({ title: "Governor" });
  });

  test("a title holding the separators still parses", () => {
    const subject: Subject = { title: "A |j: B|e: C", jurisdiction: "us/ca", election: "2026" };
    expect(subjectFromKey(subjectKey(subject))).toEqual(subject);
  });

  test("an id key carries no subject", () => {
    expect(subjectFromKey(subjectKey({ title: "Governor", id: "ca-gov-2026" }))).toBeUndefined();
    expect(subjectFromKey("t:|j:us/ca|e:2026")).toBeUndefined();
  });
});
