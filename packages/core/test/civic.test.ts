import { describe, expect, test } from "bun:test";
import {
  CivicError,
  civicErrorMessage,
  civicUrl,
  normalizeVoterInfo,
  parseCivicElections,
  readCivic,
  type VipVoterInfo,
} from "../src/civic";

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

describe("normalizeVoterInfo", () => {
  const lookup = normalizeVoterInfo(response);

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
    expect(normalizeVoterInfo({ contests: [] })).toEqual({ contests: [] });
  });
});

describe("civicUrl", () => {
  test("puts the parameters and the key in the query", () => {
    const url = civicUrl("voterinfo", "KEY", { address: "1 Dr Carlton B Goodlett Pl" });
    expect(url.origin + url.pathname).toBe(
      "https://civicinfo.googleapis.com/civicinfo/v2/voterinfo",
    );
    expect(url.searchParams.get("address")).toBe("1 Dr Carlton B Goodlett Pl");
    expect(url.searchParams.get("key")).toBe("KEY");
  });
});

describe("parseCivicElections", () => {
  test("keeps the fields OpenSlate reads, by date", () => {
    expect(
      parseCivicElections({
        kind: "civicinfo#electionsQueryResponse",
        elections: [
          {
            id: "9000",
            name: "General",
            electionDay: "2026-11-03",
            ocdDivisionId: "ocd-division/country:us",
          },
          { id: "2000", name: "VIP Test Election", electionDay: "2017-06-06", extra: true },
          { id: "bad" },
        ],
      }),
    ).toEqual([
      { id: "2000", name: "VIP Test Election", electionDay: "2017-06-06" },
      {
        id: "9000",
        name: "General",
        electionDay: "2026-11-03",
        ocdDivisionId: "ocd-division/country:us",
      },
    ]);
  });
  test("nothing when the answer has no list", () => {
    expect(parseCivicElections({})).toEqual([]);
  });
});

describe("readCivic", () => {
  test("an error carries Google's reason", async () => {
    const body = JSON.stringify({
      error: {
        code: 400,
        message: "API key not valid. Please pass a valid API key.",
        errors: [{ reason: "badRequest" }],
      },
    });
    const error = await readCivic(new Response(body, { status: 400 })).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CivicError);
    expect((error as CivicError).status).toBe(400);
    expect((error as CivicError).message).toBe(
      "Google answered 400: API key not valid. Please pass a valid API key. — badRequest",
    );
  });
  test("a non-JSON error body is cut short", () => {
    expect(civicErrorMessage("x".repeat(300))).toHaveLength(200);
  });
});
