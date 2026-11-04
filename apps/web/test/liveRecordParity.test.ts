import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  countyEntries,
  parseClaritySummary,
  parseLaVote,
  parseLvtCsv,
  parseResultsApi,
  SOS_DISTRICT_PATHS,
  SOS_STATEWIDE_OFFICE_IDS,
  sosEntries,
  sosReportTime,
} from "@openslate/core";
import { countyContestResult } from "../src/lib/countyCa";
import { choicesOf } from "../src/lib/raceHistory";
import { DISTRICT_FAMILIES, normalizeContest, STATEWIDE_OFFICES } from "../src/lib/sosCa";
import { parseSosTime } from "../src/lib/sosResults";

/**
 * The relay's recorder (packages/core liveRecord) and this browser's history
 * log (raceHistory) must read a report the same way, or the two histories
 * won't merge point for point.
 */

const fixtures = join(import.meta.dir, "../../../packages/core/test/fixtures");
const text = (name: string) => readFileSync(join(fixtures, name), "utf8");

describe("the recorder reads reports as this browser does", () => {
  test("the same statewide offices and districts", () => {
    expect([...SOS_STATEWIDE_OFFICE_IDS]).toEqual(STATEWIDE_OFFICES.map((o) => o.id));
    expect(SOS_DISTRICT_PATHS.map((f) => [f.path, f.count])).toEqual(
      DISTRICT_FAMILIES.map((f) => [f.path, f.count]),
    );
  });

  test("the state's documents", () => {
    const governor = JSON.parse(text("sos-governor.json"));
    const [entry] = sosEntries("governor", governor);
    const result = normalizeContest(governor);
    expect(entry?.choices).toEqual(choicesOf(result));
    expect(entry?.p).toBe(result.reporting.percent);
    expect(entry?.at).toBe(Date.parse(parseSosTime(result.reporting.time) ?? ""));
    expect(sosReportTime(result.reporting.time)).toBe(entry?.at);

    const measures = JSON.parse(text("sos-ballot-measures.json"));
    for (const e of sosEntries("ballot-measures", measures))
      expect(e.choices).toEqual(choicesOf(normalizeContest(measures, e.id.split("/")[1])));
  });

  test("every county format", () => {
    const counts = [
      parseClaritySummary(JSON.parse(text("clarity-summary-santa-clara.json"))),
      parseLvtCsv(text("lvt-summary-orange.csv")),
      parseResultsApi(JSON.parse(text("results-api-sacramento.json"))).contests,
      parseLaVote(JSON.parse(text("lavote-los-angeles.json"))).contests,
    ];
    for (const contests of counts) {
      const entries = countyEntries("x", contests, 1_000);
      contests.forEach((c, i) => {
        const result = countyContestResult(c, 1_000);
        expect(entries[i]?.choices).toEqual(choicesOf(result));
        expect(entries[i]?.p).toBe(result.reporting.percent);
      });
    }
  });
});
