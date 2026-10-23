import { describe, expect, test } from "bun:test";
import type { Poll, Subject } from "@openslate/core";
import { pollsSource } from "../src/lib/polls";

const election = "2026-11-03";
const race = (title: string, jurisdiction: string, extra: Partial<Subject> = {}): Subject => ({
  title,
  jurisdiction,
  election,
  ...extra,
});
const poll = (poll_type: string, subject: string): Poll => ({
  id: `${subject}/${poll_type}`,
  poll_type,
  pollster: "Example",
  subject,
  answers: [],
});

/** What VoteHub returns for `2026 California` and bare `California` (2026-10-23). */
const governor = poll("governor", "2026 California");
const prop50 = poll("proposition-50", "2025 California");

/** The polls the panel would show for `subject`, given every poll VoteHub has. */
function shown(subject: Subject, polls: Poll[]): Poll[] {
  const lookup = pollsSource.lookup(subject);
  return polls.filter(
    (p) => p.subject && lookup.subjectKeys.includes(p.subject) && pollsSource.matches(p, lookup),
  );
}

describe("VoteHub lookup", () => {
  test("a statewide race uses the state rollup for its year", () => {
    const lookup = pollsSource.lookup(race("Governor of California", "us/ca"));
    expect(lookup.subjectKeys).toEqual(["2026 California"]);
    expect(shown(race("Governor of California", "us/ca"), [governor, prop50])).toEqual([governor]);
  });

  test("a local race gets no keys, so none of the state's polls", () => {
    const local = race("Los Angeles Community College District Board, Seat 4", "us/ca/los-angeles");
    expect(pollsSource.lookup(local).subjectKeys).toEqual([]);
    expect(pollsSource.matches(governor, pollsSource.lookup(local))).toBe(false);
  });

  test("a local office named like a statewide one stays local", () => {
    expect(pollsSource.lookup(race("Burbank City Treasurer", "us/ca/burbank")).subjectKeys).toEqual(
      [],
    );
  });

  test("statewide offices VoteHub doesn't poll get no keys", () => {
    for (const title of [
      "Lieutenant Governor of California",
      "California Superintendent of Public Instruction",
    ]) {
      expect(pollsSource.lookup(race(title, "us/ca")).subjectKeys).toEqual([]);
    }
  });

  test("a House race uses its district key", () => {
    const house = race("US House of Representatives, California District 22", "us/ca/cd-22");
    expect(pollsSource.lookup(house).subjectKeys).toEqual(["2026 CA-22"]);
    const own = poll("us-representative", "2026 CA-22");
    expect(shown(house, [own, governor])).toEqual([own]);
  });

  test("a mayor uses the city's key", () => {
    expect(pollsSource.lookup(race("Oakland Mayor", "us/ca/oakland")).subjectKeys).toEqual([
      "2026 Oakland",
    ]);
    expect(pollsSource.lookup(race("Mayor of San Francisco", "us/ca/sf")).subjectKeys).toEqual([
      "2026 San Francisco",
    ]);
  });
});

describe("VoteHub matching", () => {
  test("a measure only gets its own polls", () => {
    const prop1 = race("California – Proposition 1 (Authorizes Bonds)", "us/ca", {
      kind: "measure",
    });
    const own = poll("proposition-1", "2026 California");
    expect(
      shown(prop1, [own, governor, prop50, poll("proposition-12", "2026 California")]),
    ).toEqual([own]);
  });

  test("a local measure gets nothing", () => {
    const measure = race("Berkeley – Measure AA (Soda Tax Measure)", "us/ca/berkeley", {
      kind: "measure",
    });
    expect(pollsSource.lookup(measure).subjectKeys).toEqual([]);
  });

  test("a poll from another cycle is dropped", () => {
    const prop50In2026 = race("California – Proposition 50", "us/ca", { kind: "measure" });
    expect(pollsSource.matches(prop50, pollsSource.lookup(prop50In2026))).toBe(false);
    const prop50In2025 = { ...prop50In2026, election: "2025-11-04" };
    expect(pollsSource.matches(prop50, pollsSource.lookup(prop50In2025))).toBe(true);
  });
});
