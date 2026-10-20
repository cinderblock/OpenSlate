import { describe, expect, test } from "bun:test";
import { type VipVoterInfo, normalize } from "../src/ballot";

// A trimmed voterInfoQuery response, the shape the Civic Information API
// documents: district ids are relative to their scope, not OCD ids.
const response: VipVoterInfo = {
  election: { id: "9000", name: "California General Election", electionDay: "2026-11-03" },
  normalizedInput: { state: "CA" },
  contests: [
    {
      type: "General",
      office: "Governor",
      district: { name: "California", scope: "statewide" },
      candidates: [
        { name: "Xavier Becerra", party: "Democratic" },
        { name: "Steve Hilton", party: "Republican" },
      ],
      numberVotingFor: 1,
    },
    {
      type: "General",
      office: "U.S. Representative",
      district: {
        name: "California's 11th congressional district",
        scope: "congressional",
        id: "11",
      },
      candidates: [{ name: "Scott Wiener" }, { name: "Connie Chan" }],
    },
    {
      type: "General",
      office: "Member of the State Assembly",
      district: { name: "California Assembly district 17", scope: "stateLower", id: "17" },
      candidates: [{ name: "Matt Haney" }],
    },
    {
      type: "Referendum",
      referendumTitle: "Proposition A",
      district: { name: "San Francisco", scope: "citywide" },
      referendumBallotResponses: ["Yes", "No"],
    },
  ],
};

describe("normalize", () => {
  const lookup = normalize(response);

  test("carries the address's state", () => {
    expect(lookup.state).toBe("ca");
  });

  test("passes each contest's district scope and number through", () => {
    expect(lookup.contests.map((c) => c.district)).toEqual([
      { name: "California", scope: "statewide" },
      { name: "California's 11th congressional district", scope: "congressional", id: "11" },
      { name: "California Assembly district 17", scope: "stateLower", id: "17" },
      { name: "San Francisco", scope: "citywide" },
    ]);
  });

  test("still shapes contests as before", () => {
    const [governor, , , propA] = lookup.contests;
    expect(governor?.subject).toEqual({
      title: "Governor",
      id: "vip:9000:California:governor",
      kind: "race",
      jurisdiction: "California",
      election: "2026-11-03",
    });
    expect(governor?.voteFor).toBe(1);
    expect(propA?.subject.kind).toBe("measure");
    expect(propA?.candidates.map((c) => c.name)).toEqual(["Yes", "No"]);
  });

  test("omits the state when the address wasn't normalized", () => {
    expect(normalize({ contests: [] })).toEqual({ contests: [] });
  });
});
