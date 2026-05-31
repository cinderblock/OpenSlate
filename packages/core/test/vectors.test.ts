import { expect, test } from "bun:test";
import { runCheck } from "../scripts/vectors-check";

test("conformance vectors round-trip and verify", () => {
  const report = runCheck();
  if (report.failed.length > 0) {
    const detail = report.failed.map((f) => `  - ${f.vector}: ${f.reason}`).join("\n");
    throw new Error(
      `${report.failed.length} vector failure(s); ${report.passed} passed:\n${detail}\n\nRun \`bun run vectors:generate\` if a deliberate change should propagate to the stored vectors.`,
    );
  }
  expect(report.passed).toBeGreaterThan(0);
});
