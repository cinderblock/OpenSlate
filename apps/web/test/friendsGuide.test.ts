import { describe, expect, test } from "bun:test";
import {
  ballotListing,
  buildSlate,
  createIdentity,
  identityToIssuer,
  type SlatePayload,
  signSlate,
  verifySlate,
} from "@openslate/core";
import {
  type ChoiceGroup,
  type DecodedSlate,
  decodeLocalGuides,
  decodeSlates,
  LOCAL_GUIDE_KEY,
  type Race,
} from "../src/lib/collate";
import {
  earlierGuides,
  type GuideReply,
  guidePrompt,
  guideSlate,
  raceCode,
  readGuideReply,
  signSavedGuide,
} from "../src/lib/friendsGuide";

const E = "2026-11-03";

function group(choice: string): ChoiceGroup {
  return { choice, positions: [], support: 0, opposition: 0, onBallot: true, writeIn: false };
}

function race(title: string, names: string[], extra: Partial<Race> = {}): Race {
  return {
    key: `t:${title}|j:us/ca|e:${E}`,
    subject: { title, kind: "race", jurisdiction: "us/ca", election: E },
    choices: names.map(group),
    onBallot: true,
    unlisted: false,
    followedSources: 0,
    totalSources: 0,
    ...extra,
  };
}

const prop = race("California — Proposition 1 (Authorizes Bonds)", ["Yes", "No"]);
const mayor = race("Mayor", ["Donald P. (Don) Wagner", "Ana Ruiz"], { ballot: { vote_for: 1 } });
const unlisted = race("Water Board", [], { onBallot: false });
const races = [prop, mayor, unlisted];

function reply(picks: object[], rest: object = {}) {
  return JSON.stringify({ friend: "Sam Rivera", election: E, picks, ...rest });
}

function read(text: string): GuideReply {
  const result = readGuideReply(text, races, E);
  if ("error" in result) throw new Error(result.error);
  return result;
}

const pick = (race: Race, choice: string, stance = "endorse", rest: object = {}) => ({
  race: raceCode(race),
  choice,
  stance,
  ...rest,
});

describe("raceCode", () => {
  test("is short, and the same for the same race", () => {
    expect(raceCode(prop)).toBe(raceCode({ key: prop.key }));
    expect(raceCode(prop)).not.toBe(raceCode(mayor));
    expect(raceCode(prop)).toMatch(/^r[0-9a-z]{1,7}$/);
  });
});

describe("guidePrompt", () => {
  test("lists each race's code, title, instruction and choices", () => {
    const prompt = guidePrompt(races, E);
    expect(prompt).toContain(
      `${raceCode(prop)} | California — Proposition 1 (Authorizes Bonds) | Yes; No`,
    );
    expect(prompt).toContain(`${raceCode(mayor)} | Mayor | Vote for one`);
    expect(prompt).toContain("Donald P. (Don) Wagner; Ana Ruiz");
    expect(prompt).toContain(`${raceCode(unlisted)} | Water Board | (choices not listed)`);
    expect(prompt).toContain(`"election": "${E}"`);
  });
});

describe("readGuideReply", () => {
  test("reads the JSON whatever the chat wrapped it in", () => {
    const text = `Here you go!\n\n\`\`\`json\n${reply([pick(prop, "No")])}\n\`\`\`\nHope that helps.`;
    const { friend, picks, problems } = read(text);
    expect(friend).toBe("Sam Rivera");
    expect(problems).toEqual([]);
    expect(picks[0]?.position).toEqual({ subject: prop.subject, stance: "endorse", choice: "No" });
  });

  test("puts a name under the ballot's spelling", () => {
    const { picks } = read(reply([pick(mayor, "Don Wagner")]));
    expect(picks[0]?.position.choice).toBe("Donald P. (Don) Wagner");
  });

  test("keeps rank, label and statement", () => {
    const rest = { rank: 2, label: "Strong yes", statement: "Solid record." };
    const { picks } = read(reply([pick(mayor, "Ana Ruiz", "lean_for", rest)]));
    expect(picks[0]?.position).toMatchObject({ stance: "lean_for", ...rest });
  });

  test("treats null fields as absent", () => {
    const rest = { rank: null, label: null, statement: null };
    const { picks } = read(reply([pick(prop, "Yes", "endorse", rest)], { unclear: null }));
    expect(Object.keys(picks[0]?.position ?? {}).sort()).toEqual(["choice", "stance", "subject"]);
  });

  test("leaves out a race code it doesn't know, and a choice not on the ballot", () => {
    const { picks, problems } = read(
      reply([
        { race: "rnope", choice: "Yes", stance: "endorse" },
        pick(mayor, "Anna Ruiz"),
        pick(mayor, "Someone Else"),
      ]),
    );
    expect(picks).toEqual([]);
    expect(problems[0]).toContain('race code "rnope"');
    expect(problems[1]).toContain('Did it mean "Ana Ruiz"?');
    expect(problems[2]).toContain("isn't on the ballot.");
  });

  test("takes any name in a race with no official list", () => {
    const { picks } = read(reply([pick(unlisted, "Pat Doe")]));
    expect(picks[0]?.position.choice).toBe("Pat Doe");
  });

  test("leaves out a rank on a pick against", () => {
    const { picks, problems } = read(reply([pick(mayor, "Ana Ruiz", "oppose", { rank: 1 })]));
    expect(picks).toEqual([]);
    expect(problems).toHaveLength(1);
  });

  test("passes on what the chat left out", () => {
    const { leftOut } = read(reply([], { not_on_list: ["Prop 99"], unclear: ["Row 7"] }));
    expect(leftOut).toEqual(["Prop 99", "Row 7"]);
  });

  test("refuses what isn't a reply, and a reply for another election", () => {
    expect(readGuideReply("no json here", races, E)).toHaveProperty("error");
    expect(readGuideReply("{not json}", races, E)).toHaveProperty("error");
    expect(readGuideReply('{"picks":"none"}', races, E)).toHaveProperty("error");
    const other = reply([], { election: "2024-11-05" });
    expect(readGuideReply(other, races, E)).toEqual({
      error: expect.stringContaining("2024-11-05"),
    });
  });
});

describe("guideSlate", () => {
  const { picks } = read(reply([pick(prop, "Yes", "endorse", { statement: "Housing." })]));
  const voter = createIdentity({ name: "Alex", kind: "individual" });
  const token = guideSlate("Sam Rivera", picks, ballotListing([]), E, voter);
  const [slate] = decodeSlates([{ token, importedAt: "2026-11-02T00:00:00.000Z" }]);

  test("is signed by the voter and verifies", () => {
    expect(verifySlate(token).valid).toBe(true);
    expect(slate?.payload.issuer).toEqual(identityToIssuer(voter));
    expect(slate?.payload.context?.election).toBe(E);
    expect(slate?.payload.positions[0]?.subject.title).toBe(prop.subject.title);
  });

  test("names the friend as the source, never as the signer", () => {
    expect(slate?.source).toMatchObject({
      id: "of:sam rivera",
      name: "Sam Rivera",
      secondhand: true,
      signerName: "Alex",
    });
    expect(slate?.payload.attribution?.mode).toBe("transcribed");
  });

  test("signs a guide saved unsigned, as the voter", () => {
    const saved: SlatePayload = buildSlate({
      issuer: { key: LOCAL_GUIDE_KEY, name: "you" },
      context: { election: E, title: "Sam Rivera's voter guide" },
      attribution: {
        of: { name: "Sam Rivera", kind: "individual" },
        mode: "transcribed",
        retrieved_at: "2026-11-02T00:00:00.000Z",
      },
      positions: picks.map((p) => p.position),
    });
    const signed = signSavedGuide(saved, voter);
    expect(verifySlate(signed).valid).toBe(true);
    expect(verifySlate(signed).payload?.issuer).toEqual(identityToIssuer(voter));
    expect(verifySlate(signed).payload?.attribution?.of?.name).toBe("Sam Rivera");
  });
});

describe("earlierGuides", () => {
  const { picks } = read(reply([pick(prop, "Yes", "endorse")]));
  const voter = createIdentity({ name: "Alex", kind: "individual" });
  const own = new Set([identityToIssuer(voter).key]);
  const decoded = (token: string): DecodedSlate =>
    decodeSlates([{ token, importedAt: "2026-11-02T00:00:00.000Z" }])[0] as DecodedSlate;
  const report = (name: string, issuerName: string, election = E) => {
    const signer = createIdentity({ name: issuerName, kind: "researcher" });
    return decoded(
      signSlate(
        buildSlate({
          issuer: identityToIssuer(signer),
          context: { election },
          attribution: {
            of: { name, kind: "individual" },
            mode: "transcribed",
            retrieved_at: "2026-11-02T00:00:00.000Z",
          },
        }),
        signer.keyPair.secretKey,
      ),
    );
  };

  test("finds the voter's own report, whatever the name's case", () => {
    const mine = decoded(guideSlate("Sam Rivera", picks, ballotListing([]), E, voter));
    expect(earlierGuides([mine], "sam rivera", E, own)).toEqual([mine]);
  });

  test("finds the unsigned and throwaway-key copies", () => {
    const throwaway = report("Sam Rivera", "you");
    const [unsigned] = decodeLocalGuides([
      buildSlate({
        issuer: { key: LOCAL_GUIDE_KEY, name: "you" },
        context: { election: E },
        attribution: {
          of: { name: "Sam Rivera", kind: "individual" },
          mode: "transcribed",
          retrieved_at: "2026-11-02T00:00:00.000Z",
        },
      }),
    ]);
    const slates = [throwaway, unsigned as DecodedSlate];
    expect(earlierGuides(slates, "Sam Rivera", E, own)).toEqual(slates);
  });

  test("leaves someone else's report, another friend and another election", () => {
    const slates = [
      report("Sam Rivera", "A researcher"),
      report("Jo Park", "you"),
      report("Sam Rivera", "you", "2024-11-05"),
    ];
    expect(earlierGuides(slates, "Sam Rivera", E, own)).toEqual([]);
  });
});
