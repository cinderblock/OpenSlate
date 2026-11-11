import { type CountyContest, measureSide } from "@openslate/core";
import { type ContestResult, measureThreshold } from "./liveCount";

/**
 * A contest from an election office's feed (`@openslate/core/countyResults`,
 * `stateResults`) in the shape the results pages show. The same for a
 * county's feed and a state's; only what "reporting" counts differs. Pure;
 * unit-tested in test/countyCa.test.ts and test/stateFeeds.test.ts.
 */

const timeFmt = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

/**
 * `updated` is the office's own time for the count; without one, `seenAt`
 * (when OpenSlate first read it) stands in, marked as such. `units`: what the
 * feed's reporting counts, in the plural ("precincts" for a county; a state's
 * site counts "counties").
 */
export function feedContestResult(
  c: CountyContest,
  updated?: number,
  seenAt?: number,
  units = "precincts",
): ContestResult {
  const changed = updated
    ? { changedAt: updated }
    : seenAt
      ? { changedAt: seenAt, changedSeen: true }
      : {};
  const p = c.precincts;
  // Mail ballots are counted before any precinct "reports": "0% of precincts"
  // beside thousands of votes would mislead, so precincts show once one reports.
  const precincts = p && p.total > 0 && p.reporting > 0 ? p : undefined;
  const percent = precincts
    ? Math.round((precincts.reporting / precincts.total) * 1000) / 10
    : undefined;
  const reporting = {
    text: precincts ? `${precincts.reporting} of ${precincts.total} ${units} reporting` : "",
    ...(percent !== undefined ? { percent } : {}),
    ...(units !== "precincts" ? { units } : {}),
    ...(updated ? { time: timeFmt.format(updated) } : {}),
    ...changed,
  };
  if (c.measure) {
    const threshold = c.threshold ?? measureThreshold(c.title);
    const yes = c.choices.find((x) => measureSide(x.name) === "yes");
    const no = c.choices.find((x) => measureSide(x.name) === "no");
    return {
      kind: "measure",
      title: c.title,
      reporting,
      measure: {
        number: "",
        // The card's heading already says it.
        name: "",
        yes: yes?.votes ?? 0,
        no: no?.votes ?? 0,
        yesPercent: yes?.percent ?? 0,
        noPercent: no?.percent ?? 0,
        ...(threshold ? { threshold } : {}),
      },
    };
  }
  return {
    kind: "candidates",
    title: c.title,
    reporting,
    candidates: c.choices
      .map((x) => ({
        name: x.name,
        ...(x.party ? { party: x.party } : {}),
        votes: x.votes,
        percent: x.percent,
        incumbent: Boolean(x.incumbent),
      }))
      .sort((a, b) => b.votes - a.votes),
  };
}
