import { describe, expect, test } from "bun:test";
import { ballotListing, verifySlate } from "@openslate/core";
import type { ChoiceGroup, Race } from "../src/lib/collate";
import {
  GUIDE_REPORTER,
  type GuideReply,
  guidePrompt,
  guideSlate,
  raceCode,
  readGuideReply,
} from "../src/lib/friendsGuide";
import { sourceOf } from "../src/lib/sources";

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
  test("is a valid slate naming the friend as the source, not the signer", () => {
    const { picks } = read(reply([pick(prop, "Yes", "endorse", { statement: "Housing." })]));
    const result = verifySlate(guideSlate("Sam Rivera", picks, ballotListing([]), E));
    expect(result.valid).toBe(true);
    const payload = result.payload;
    if (!payload) throw new Error("no payload");
    expect(payload.issuer.name).toBe(GUIDE_REPORTER);
    expect(payload.context?.election).toBe(E);
    expect(payload.positions[0]?.subject.title).toBe(prop.subject.title);
    expect(sourceOf(payload)).toMatchObject({
      id: "of:sam rivera",
      name: "Sam Rivera",
      secondhand: true,
      signerName: GUIDE_REPORTER,
    });
  });
});
