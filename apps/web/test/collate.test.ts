import { describe, expect, test } from "bun:test";
import {
  type BallotChoice,
  type BallotContest,
  type KeyPair,
  type Stance,
  createSlate,
  generateKeyPair,
} from "@openslate/core";
import {
  areaOptionsOf,
  collateRaces,
  countedTone,
  decodeSlates,
  defaultElection,
  electionsOf,
  positionJurisdictions,
} from "../src/lib/collate";

const researcher = generateKeyPair();

interface P {
  title: string;
  choice?: string;
  stance?: Stance;
  jurisdiction?: string;
  district?: string;
  election?: string;
  kind?: string;
}

function slate(input: {
  of?: string;
  /** `attribution.of.kind`, e.g. "election-authority". */
  ofKind?: string;
  name?: string;
  keyPair?: KeyPair;
  election?: string;
  issuedAt?: string;
  positions: Array<P & { statement?: string; contest?: BallotContest; ballot?: BallotChoice }>;
}): { token: string; importedAt: string } {
  const token = createSlate({
    keyPair: input.keyPair ?? (input.of ? researcher : generateKeyPair()),
    issuer: { name: input.of ? "Researcher" : (input.name ?? "Someone") },
    ...(input.election ? { context: { election: input.election } } : {}),
    ...(input.issuedAt ? { issuedAt: input.issuedAt } : {}),
    positions: input.positions.map((p) => ({
      subject: {
        title: p.title,
        ...(p.jurisdiction ? { jurisdiction: p.jurisdiction } : {}),
        ...(p.district ? { district: p.district } : {}),
        ...(p.election ? { election: p.election } : {}),
        ...(p.kind ? { kind: p.kind } : {}),
        ...(p.contest ? { ballot: p.contest } : {}),
      },
      stance: p.stance ?? "endorse",
      ...(p.choice ? { choice: p.choice } : {}),
      ...(p.statement ? { statement: p.statement } : {}),
      ...(p.ballot ? { ballot: p.ballot } : {}),
    })),
    ...(input.of
      ? {
          attribution: {
            of: { name: input.of, ...(input.ofKind ? { kind: input.ofKind } : {}) },
            mode: "scraped" as const,
            retrieved_at: "2026-01-01T00:00:00Z",
          },
        }
      : {}),
  }).token;
  return { token, importedAt: "2026-10-01T00:00:00Z" };
}

const E = "2026-11-03";

/** The Secretary of State's list: every candidate, in ballot order, no opinion. */
const ballot = slate({
  of: "Secretary of State",
  ofKind: "election-authority",
  election: E,
  // Same title + jurisdiction + election as the endorsements, or it's another race.
  positions: [
    {
      title: "Governor",
      choice: "C",
      stance: "neutral",
      ballot: { party: "Green", designation: "Teacher" },
    },
    {
      title: "Governor",
      choice: "A",
      stance: "neutral",
      ballot: { party: "Democratic", designation: "Attorney" },
    },
    { title: "Governor", choice: "B", stance: "neutral" },
    { title: "Treasurer", choice: "T1", stance: "neutral" },
    { title: "Treasurer", choice: "T2", stance: "neutral" },
  ].map((p) => ({ ...p, election: E, jurisdiction: "us/ca" })),
});

describe("countedTone", () => {
  test("a followed source counts as it says; one you disagree with, the other way", () => {
    expect(countedTone("endorse", "follow")).toBe("for");
    expect(countedTone("lean_against", "follow")).toBe("against");
    expect(countedTone("endorse", "disagree")).toBe("against");
    expect(countedTone("lean_for", "disagree")).toBe("against");
    expect(countedTone("oppose", "disagree")).toBe("for");
    expect(countedTone("neutral", "disagree")).toBe("neutral");
  });
});

describe("collateRaces", () => {
  const slates = decodeSlates([
    slate({
      of: "SPUR",
      positions: [
        { title: "Governor", choice: "A", election: E, jurisdiction: "us/ca" },
        { title: "Prop 1", choice: "Yes", election: E, jurisdiction: "us/ca", kind: "measure" },
      ],
    }),
    slate({
      of: "GrowSF",
      positions: [
        { title: "Governor", choice: "A", election: E, jurisdiction: "us/ca" },
        { title: "Prop 1", choice: "No", election: E, jurisdiction: "us/ca", kind: "measure" },
      ],
    }),
    slate({
      of: "Tenants Union",
      positions: [
        { title: "Governor", choice: "B", election: E, jurisdiction: "us/ca" },
        { title: "Governor", choice: "A", stance: "oppose", election: E, jurisdiction: "us/ca" },
      ],
    }),
  ]);

  test("lines up every source's choice per race, most-backed choice first", () => {
    const races = collateRaces(slates, { follows: {} });
    const governor = races.find((r) => r.subject.title === "Governor");
    expect(governor?.followedSources).toBe(3);
    expect(governor?.choices.map((c) => [c.choice, c.support, c.opposition])).toEqual([
      ["A", 2, 1],
      ["B", 1, 0],
    ]);
  });

  test("unfollowed sources stay on a race's choices, marked, without counting", () => {
    const follows = { "of:growsf": "off" } as const;
    const races = collateRaces(slates, { follows });
    const prop = races.find((r) => r.subject.title === "Prop 1");
    expect(prop?.choices.map((c) => c.choice)).toEqual(["Yes", "No"]);
    expect(prop?.totalSources).toBe(2);
    expect(prop?.followedSources).toBe(1);
    const no = prop?.choices.find((c) => c.choice === "No");
    expect(no?.support).toBe(0);
    expect(no?.positions[0]?.standing).toBe("off");
  });

  test("a source you disagree with counts the other way, after the ones you agree with", () => {
    const follows = { "of:tenants union": "disagree" } as const;
    const governor = collateRaces(slates, { follows }).find((r) => r.subject.title === "Governor");
    expect(governor?.followedSources).toBe(3);
    // Tenants Union opposes A (so A gains) and backs B (so B loses).
    expect(governor?.choices.map((c) => [c.choice, c.support, c.opposition])).toEqual([
      ["A", 3, 0],
      ["B", 0, 1],
    ]);
    const a = governor?.choices.find((c) => c.choice === "A");
    expect(a?.positions.map((p) => [p.source.name, p.stance, p.standing])).toEqual([
      ["GrowSF", "endorse", "follow"],
      ["SPUR", "endorse", "follow"],
      ["Tenants Union", "oppose", "disagree"],
    ]);
  });

  describe("two-way races, a source you disagree with", () => {
    const follows = { "of:growsf": "disagree" } as const;
    const tally = (mode?: "choice" | "side") =>
      collateRaces(slates, { follows, ...(mode ? { disagree: mode } : {}) })
        .find((r) => r.subject.title === "Prop 1")
        ?.choices.map((c) => [c.choice, c.support, c.opposition, c.positions.length]);

    test("by default counts against what it picked, where it picked it", () => {
      // GrowSF backs No: No gets one against.
      expect(tally()).toEqual([
        ["Yes", 1, 0, 1],
        ["No", 0, 1, 1],
      ]);
      expect(tally("choice")).toEqual(tally());
    });

    test("on `side`, counts for the other side, listed there with the side it named", () => {
      expect(tally("side")).toEqual([
        ["Yes", 2, 0, 2],
        ["No", 0, 0, 0],
      ]);
      const yes = collateRaces(slates, { follows, disagree: "side" })
        .find((r) => r.subject.title === "Prop 1")
        ?.choices.find((c) => c.choice === "Yes");
      expect(yes?.positions.map((p) => [p.source.name, p.stance, p.named])).toEqual([
        ["SPUR", "endorse", undefined],
        ["GrowSF", "endorse", "No"],
      ]);
    });

    test("races with more names stay against what it picked", () => {
      const disagree = { "of:tenants union": "disagree" } as const;
      const governor = (mode: "choice" | "side") =>
        collateRaces(slates, { follows: disagree, disagree: mode }).find(
          (r) => r.subject.title === "Governor",
        );
      // Governor here isn't on a ballot listing, so the field is unknown: not two-way.
      expect(governor("side")?.choices).toEqual(governor("choice")?.choices);
    });
  });

  test("races only unfollowed sources cover are listed on request", () => {
    const follows = { "of:growsf": "off" } as const;
    const extra = decodeSlates([
      slate({
        of: "GrowSF",
        positions: [{ title: "Sheriff", choice: "S", election: E, jurisdiction: "us/ca" }],
      }),
    ]);
    const withGrowSF = [...slates, ...extra];
    expect(collateRaces(withGrowSF, { follows }).map((r) => r.subject.title)).toEqual([
      "Governor",
      "Prop 1",
    ]);
    expect(
      collateRaces(withGrowSF, { follows, includeUnfollowed: true }).map((r) => r.subject.title),
    ).toEqual(["Governor", "Sheriff", "Prop 1"]);
  });

  test("how the ballot prints it: a ballot source's, over an endorser's copy", () => {
    const where = { election: E, jurisdiction: "us/ca" };
    const listing = slate({
      of: "Secretary of State",
      ofKind: "election-authority",
      positions: [
        {
          ...where,
          title: "Board",
          choice: "A",
          stance: "neutral",
          contest: { heading: "Board Member", vote_for: 3 },
          ballot: { party: "Green", incumbent: true },
        },
      ],
    });
    const endorser = slate({
      of: "SPUR",
      positions: [
        {
          ...where,
          title: "Board",
          choice: "A",
          contest: { vote_for: 1 },
          ballot: { party: "Typo" },
        },
      ],
    });
    // Whichever comes first, the listing's wins.
    for (const order of [
      [endorser, listing],
      [listing, endorser],
    ]) {
      const [board] = collateRaces(decodeSlates(order), { follows: { "of:spur": "follow" } });
      expect(board?.ballot).toEqual({ heading: "Board Member", vote_for: 3 });
      expect(board?.choices[0]?.ballot).toEqual({ party: "Green", incumbent: true });
    }
  });

  test("a ballot source supplies the field in ballot order, without being a source", () => {
    const races = collateRaces([...slates, ...decodeSlates([ballot])], {
      follows: { "of:secretary of state": "off" },
    });
    const governor = races.find((r) => r.subject.title === "Governor");
    expect(governor?.onBallot).toBe(true);
    // Backed choices first, then the rest of the field as the ballot lists it.
    expect(governor?.choices.map((c) => [c.choice, c.onBallot, c.positions.length])).toEqual([
      ["A", true, 3],
      ["B", true, 1],
      ["C", true, 0],
    ]);
    expect(governor?.choices[0]?.ballot).toEqual({ party: "Democratic", designation: "Attorney" });
    // The ballot's own order survives the support sort, for the ballot view.
    expect(governor?.choices.map((c) => [c.choice, c.ballotIndex])).toEqual([
      ["A", 1],
      ["B", 2],
      ["C", 0],
    ]);
    expect(governor?.followedSources).toBe(3);
    expect(governor?.totalSources).toBe(3);

    // A race nobody endorsed is still on the ballot.
    const treasurer = races.find((r) => r.subject.title === "Treasurer");
    expect(treasurer?.choices.map((c) => c.choice)).toEqual(["T1", "T2"]);
    expect(treasurer?.followedSources).toBe(0);
  });

  test("offices sort before measures", () => {
    const races = collateRaces(slates, { follows: {} });
    expect(races.map((r) => r.subject.title)).toEqual(["Governor", "Prop 1"]);
  });

  test("filters by election, falling back to the slate's context election", () => {
    const mixed = decodeSlates([
      slate({ name: "A", election: "2026-06-02", positions: [{ title: "Primary race" }] }),
      slate({ name: "B", positions: [{ title: "General race", election: E }] }),
    ]);
    const june = collateRaces(mixed, { follows: {}, election: "2026-06-02" });
    expect(june.map((r) => r.subject.title)).toEqual(["Primary race"]);
    expect(june[0]?.election).toBe("2026-06-02");
  });

  test("filters by area", () => {
    const local = decodeSlates([
      slate({
        name: "A",
        positions: [
          { title: "Mayor", jurisdiction: "us/ca/sf" },
          { title: "Mayor", jurisdiction: "us/ca/oakland" },
          { title: "House", jurisdiction: "us/ca/cd-11" },
          { title: "House", jurisdiction: "us/ca/cd-12" },
        ],
      }),
    ]);
    const races = collateRaces(local, {
      follows: {},
      area: { localities: ["us/ca/sf"], districts: { "us/ca/cd": "11" } },
    });
    expect(races.map((r) => r.jurisdiction)).toEqual(["us/ca/cd-11", "us/ca/sf"]);
  });

  test("places a race by its district, taking the ballot source's", () => {
    const oc = "us/ca/orange-county";
    const board = (title: string) => ({ title, jurisdiction: oc, choice: "X" });
    const slates = decodeSlates([
      slate({
        of: "OC Registrar",
        ofKind: "election-authority",
        positions: [
          { ...board("HB City SD, Trustee Area 4"), district: "us/ca/elsd-17880/ta-4" },
          { ...board("Anaheim Elementary SD, Trustee Area 2"), district: "us/ca/elsd-2610/ta-2" },
          { ...board("Irvine Ranch Water District, Division 5"), district: `${oc}/irwd/div-5` },
          board("Orange County Assessor"),
        ],
      }),
      // An endorser's district loses to the ballot source's.
      slate({
        name: "Endorser",
        positions: [{ ...board("HB City SD, Trustee Area 4"), district: "us/ca/elsd-2610" }],
      }),
    ]);
    const area = {
      localities: ["us/ca/huntington-beach", oc],
      districts: { "us/ca/elsd": "17880", "us/ca/unsd": "none" },
    };
    const races = collateRaces(slates, { follows: {}, area });
    expect(races.map((r) => [r.subject.title, r.maybe ?? false])).toEqual([
      ["HB City SD, Trustee Area 4", true],
      ["Irvine Ranch Water District, Division 5", true],
      ["Orange County Assessor", false],
    ]);
    expect(races[0]?.district).toBe("us/ca/elsd-17880/ta-4");
    // With no area, nothing is a maybe.
    expect(collateRaces(slates, { follows: {} }).some((r) => r.maybe)).toBe(false);
  });

  test("a source's newer slate replaces its older one on the same race", () => {
    const keyPair = generateKeyPair();
    const reissued = decodeSlates([
      slate({
        name: "Alice",
        keyPair,
        issuedAt: "2026-09-01T00:00:00Z",
        positions: [{ title: "Mayor", choice: "Old pick" }],
      }),
      slate({
        name: "Alice",
        keyPair,
        issuedAt: "2026-10-01T00:00:00Z",
        positions: [{ title: "Mayor", choice: "New pick" }],
      }),
    ]);
    const races = collateRaces(reissued, { follows: {} });
    expect(races[0]?.choices.map((c) => c.choice)).toEqual(["New pick"]);
  });
});

describe("elections", () => {
  const slates = decodeSlates([
    slate({ of: "SPUR", positions: [{ title: "X", election: "2026-06-02" }] }),
    slate({ of: "GrowSF", positions: [{ title: "Y", election: E }] }),
  ]);

  test("summarises each election the slates cover", () => {
    expect(electionsOf(slates, { "of:growsf": "off" })).toEqual([
      { date: "2026-06-02", races: 1, sources: 1, followedSources: 1 },
      { date: E, races: 1, sources: 1, followedSources: 0 },
    ]);
  });

  test("a ballot source adds races but isn't a source", () => {
    const summary = electionsOf([...slates, ...decodeSlates([ballot])], {}).find(
      (e) => e.date === E,
    );
    expect(summary).toEqual({ date: E, races: 3, sources: 1, followedSources: 1 });
  });

  test("defaults to the next upcoming election with followed sources", () => {
    const summaries = electionsOf(slates, {});
    expect(defaultElection(summaries, "2026-10-19")).toBe(E);
    expect(defaultElection(summaries, "2026-05-01")).toBe("2026-06-02");
    // Election day itself still counts as upcoming.
    expect(defaultElection(summaries, E)).toBe(E);
    // Everything past: show the latest.
    expect(defaultElection(summaries, "2027-01-01")).toBe(E);
    expect(defaultElection([], "2026-10-19")).toBeUndefined();
  });

  test("prefers an upcoming election the user follows over an earlier unfollowed one", () => {
    const summaries = electionsOf(slates, { "of:spur": "off" });
    expect(defaultElection(summaries, "2026-05-01")).toBe(E);
  });
});

describe("areaOptionsOf", () => {
  test("collects localities and district numbers", () => {
    const slates = decodeSlates([
      slate({
        name: "A",
        positions: [
          { title: "1", jurisdiction: "us/ca/sf" },
          { title: "2", jurisdiction: "us/ca/cd-12" },
          { title: "3", jurisdiction: "us/ca/cd-2" },
          { title: "4", jurisdiction: "us/ca/ad-17" },
          { title: "5", jurisdiction: "us/ca" },
          { title: "6", jurisdiction: "us/ca/chula-vista" },
          { title: "7", jurisdiction: "us/ca/sf" },
        ],
      }),
    ]);
    expect(areaOptionsOf(positionJurisdictions(slates))).toEqual({
      // San Francisco has more races here, so it leads.
      localities: ["us/ca/sf", "us/ca/chula-vista"],
      districts: { "us/ca/cd": ["2", "12"], "us/ca/ad": ["17"] },
    });
  });

  test("weighs each item by its race count", () => {
    expect(
      areaOptionsOf([
        { jurisdiction: "us/ca/sf", count: 1 },
        { jurisdiction: "us/ca/oakland", count: 3 },
        { jurisdiction: "us/ca/sf" },
      ]).localities,
    ).toEqual(["us/ca/oakland", "us/ca/sf"]);
  });
});
