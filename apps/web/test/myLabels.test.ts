import { describe, expect, test } from "bun:test";
import { applyPatch, relabeledRows } from "../src/lib/ballotDraft";
import { addLabel, labelProblem, labelsFor, moveLabel } from "../src/lib/myLabels";

const endorsed = { label: "Endorsed", description: "A 75% vote.", stance: "endorse" as const };
const recommended = { label: "Recommended", stance: "lean_for" as const };

describe("addLabel", () => {
  test("adds a trimmed label at the end, dropping an empty description", () => {
    expect(addLabel([endorsed], { label: "  Watch  ", description: " " })).toEqual([
      endorsed,
      { label: "Watch" },
    ]);
  });

  test("refuses an empty or repeated name", () => {
    expect(labelProblem([endorsed], " ")).toBe("a label needs a name");
    expect(labelProblem([endorsed], "Endorsed ")).toBe('"Endorsed" is already a label');
    expect(labelProblem([endorsed], "Endorsed", "Endorsed")).toBeUndefined();
    expect(addLabel([endorsed], { label: "Endorsed" })).toEqual([endorsed]);
  });
});

describe("moveLabel", () => {
  test("swaps with its neighbour, and stays put at either end", () => {
    expect(moveLabel([endorsed, recommended], 1, -1)).toEqual([recommended, endorsed]);
    expect(moveLabel([endorsed, recommended], 0, -1)).toEqual([endorsed, recommended]);
    expect(moveLabel([endorsed, recommended], 1, 1)).toEqual([endorsed, recommended]);
  });
});

describe("labelsFor", () => {
  test("publishes the labels in use, in the user's order, without their stance", () => {
    const labels = [endorsed, recommended, { label: "Watch" }];
    expect(labelsFor(labels, [{ label: "Recommended" }, {}, { label: "Endorsed" }])).toEqual([
      { label: "Endorsed", description: "A 75% vote." },
      { label: "Recommended" },
    ]);
  });

  test("still lists a label that's been removed since, so the slate stays valid", () => {
    expect(labelsFor([endorsed], [{ label: "Gone" }])).toEqual([{ label: "Gone" }]);
  });
});

describe("relabeledRows", () => {
  const subject = { title: "Mayor", election: "2026-11-03" };
  let rows = applyPatch({}, "2026-11-03", subject, "Ann", { stance: "lean_for", label: "Rec" });
  rows = applyPatch(rows, "2026-11-03", subject, "Bo", { stance: "endorse", label: "Endorsed" });

  test("renames a label on every row that has it", () => {
    const next = relabeledRows(rows, "Rec", "Recommended");
    expect(Object.values(next).map((r) => r.label)).toEqual(["Recommended", "Endorsed"]);
  });

  test("takes a removed label off, keeping the pick", () => {
    const ann = Object.values(relabeledRows(rows, "Rec", undefined))[0];
    expect(ann?.label).toBeUndefined();
    expect(ann?.stance).toBe("lean_for");
  });

  test("leaves the rows alone when nothing has the label", () => {
    expect(relabeledRows(rows, "Nope", "X")).toBe(rows);
  });
});
