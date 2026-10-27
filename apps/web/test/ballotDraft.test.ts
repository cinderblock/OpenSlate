import { expect, test } from "bun:test";
import type { Subject } from "@openslate/core";
import {
  type DraftRow,
  applyPatch,
  ballotDraftStore,
  refiledRows,
  rowIdFor,
} from "../src/lib/ballotDraft";

const E = "2026-11-03";
const race = (title: string, jurisdiction: string): Subject => ({
  title,
  kind: "race",
  jurisdiction,
  election: E,
});
const row = (subject: Subject, choice: string, stance: DraftRow["stance"]): DraftRow => ({
  id: rowIdFor(E, subject, choice),
  electionId: E,
  subject,
  choice,
  stance,
  updatedAt: "2026-10-20T00:00:00Z",
});

test("marks follow a race the catalog re-filed", () => {
  const before = race("Alpine Union School District Board", "us/ca/san-diego");
  const after = race("Alpine Union School District Board", "us/ca/san-diego-county");
  const mark = row(before, "Darlene Cossio", "endorse");
  const moved = refiledRows({ [mark.id]: mark }, [after]);
  expect(moved).toEqual({
    [rowIdFor(E, after, "Darlene Cossio")]: {
      ...mark,
      id: rowIdFor(E, after, "Darlene Cossio"),
      subject: after,
    },
  });
});

test("marks stay when their race is still there, or can't be told apart", () => {
  const council = race("San Diego City Council, District 2", "us/ca/san-diego");
  const mark = row(council, "Someone", "endorse");
  expect(refiledRows({ [mark.id]: mark }, [council])).toBeUndefined();

  // Two races of that title now: no telling which.
  const gone = row(race("Mayor", "us/ca/somewhere"), "Someone", "endorse");
  expect(
    refiledRows({ [gone.id]: gone }, [race("Mayor", "us/ca/here"), race("Mayor", "us/ca/there")]),
  ).toBeUndefined();
});

test("a mark already on the re-filed race wins", () => {
  const before = race("Helix Water District Board, Division 2", "us/ca/san-diego");
  const after = race("Helix Water District Board, Division 2", "us/ca/san-diego-county");
  const old = row(before, "A", "endorse");
  const fresh = row(after, "A", "oppose");
  expect(refiledRows({ [old.id]: old, [fresh.id]: fresh }, [after])).toEqual({ [fresh.id]: fresh });
});

test("a write through the shared store is what every reader gets", () => {
  const subject = race("Mayor", "us/ca/san-jose");
  ballotDraftStore.set((rows) => applyPatch(rows, E, subject, "Ana", { stance: "endorse" }));
  expect(ballotDraftStore.get()[rowIdFor(E, subject, "Ana")]?.stance).toBe("endorse");
  // Clearing the only field drops the row rather than keeping an empty one.
  ballotDraftStore.set((rows) => applyPatch(rows, E, subject, "Ana", { stance: undefined }));
  expect(ballotDraftStore.get()).toEqual({});
});
