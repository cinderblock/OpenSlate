import { beforeEach, describe, expect, test } from "bun:test";
import type { Race as ResultRace } from "@openslate/core";
import type { Race, RacePosition } from "../src/lib/collate";
import {
  changesSince,
  type FollowedRace,
  followedRacesStore,
  followedSubject,
  followRace,
  isFollowing,
  marksOf,
  resultLine,
  unfollowRace,
  withSeen,
} from "../src/lib/followedRaces";
import { tallyRace } from "../src/lib/raceTally";

const KEY = "t:Oakland Mayor|j:us/ca/oakland|e:2026-11-03";

function position(id: string, stance: RacePosition["stance"] = "endorse"): RacePosition {
  return {
    source: { id, name: id, secondhand: true, signerKey: "k" },
    stance,
    valid: true,
    standing: "off",
  };
}

function race(choices: Record<string, RacePosition[]>): Race {
  return {
    key: KEY,
    subject: { title: "Oakland Mayor", jurisdiction: "us/ca/oakland", election: "2026-11-03" },
    choices: Object.entries(choices).map(([choice, positions]) => ({
      choice,
      positions,
      support: 0,
      opposition: 0,
      onBallot: true,
      writeIn: false,
    })),
    onBallot: true,
    unlisted: false,
    followedSources: 0,
    totalSources: 0,
  };
}

const item = (over: Partial<FollowedRace> = {}): FollowedRace => ({
  key: KEY,
  subject: { title: "Oakland Mayor" },
  since: "2026-10-20T00:00:00Z",
  ...over,
});

describe("following", () => {
  beforeEach(() => followedRacesStore.set([]));

  test("a race and a candidate in it are separate follows", () => {
    followRace(KEY, { title: "Oakland Mayor" }, undefined, "2026-10-20T00:00:00Z");
    followRace(KEY, { title: "Oakland Mayor" }, "Barbara Lee", "2026-10-20T00:00:00Z");
    const list = followedRacesStore.get();
    expect(list).toHaveLength(2);
    expect(isFollowing(list, KEY)).toBe(true);
    expect(isFollowing(list, KEY, "Barbara Lee")).toBe(true);
    expect(isFollowing(list, KEY, "Julius Robinson")).toBe(false);
    unfollowRace(KEY, undefined);
    expect(isFollowing(followedRacesStore.get(), KEY)).toBe(false);
    expect(isFollowing(followedRacesStore.get(), KEY, "Barbara Lee")).toBe(true);
  });

  test("following twice keeps one, and the first date", () => {
    followRace(KEY, { title: "Oakland Mayor" }, "Barbara Lee", "2026-10-20T00:00:00Z");
    followRace(KEY, { title: "Oakland Mayor" }, "Barbara Lee", "2026-10-29T00:00:00Z");
    expect(followedRacesStore.get().map((f) => f.since)).toEqual(["2026-10-20T00:00:00Z"]);
  });

  test("a followed race keeps its election and place even when the slate's context gave them", () => {
    const subject = followedSubject({
      subject: { title: "Oakland Mayor", kind: "race" },
      jurisdiction: "us/ca/oakland",
      election: "2026-11-03",
    });
    expect(subject).toEqual({
      title: "Oakland Mayor",
      kind: "race",
      jurisdiction: "us/ca/oakland",
      election: "2026-11-03",
    });
  });
});

describe("what's new", () => {
  const before = tallyRace(race({ "Barbara Lee": [position("a")], "Julius Robinson": [] }));

  test("nothing is new about a race just followed", () => {
    expect(changesSince(before, item())).toEqual({ added: [], gone: 0 });
  });

  test("a new source shows, under the choice it named", () => {
    const seen = marksOf(before, {});
    const after = tallyRace(
      race({ "Barbara Lee": [position("a"), position("b")], "Julius Robinson": [] }),
    );
    const { added, gone } = changesSince(after, item({ seen }));
    expect(added.map((n) => [n.position.source.id, n.choice])).toEqual([["b", "Barbara Lee"]]);
    expect(gone).toBe(0);
  });

  test("a change of mind is news, and the old position is gone", () => {
    const seen = marksOf(before, {});
    const after = tallyRace(race({ "Barbara Lee": [position("a", "oppose")] }));
    const { added, gone } = changesSince(after, item({ seen }));
    expect(added.map((n) => n.position.stance)).toEqual(["oppose"]);
    expect(gone).toBe(1);
  });

  test("a candidate's follow only hears about that candidate", () => {
    const followed = { choice: "Barbara Lee" };
    const seen = marksOf(before, followed);
    const after = tallyRace(
      race({ "Barbara Lee": [position("a")], "Julius Robinson": [position("c")] }),
    );
    expect(changesSince(after, item({ ...followed, seen })).added).toEqual([]);
  });

  test("withSeen fills in only what has no baseline, and leaves an up-to-date list alone", () => {
    const list = [item(), item({ choice: "Barbara Lee", seen: [] })];
    const next = withSeen(list, () => before, "2026-10-30T00:00:00Z");
    expect(next[0]?.seen).toHaveLength(1);
    expect(next[0]?.seenAt).toBe("2026-10-30T00:00:00Z");
    expect(next[1]).toBe(list[1] as FollowedRace);
    expect(withSeen(next, () => before, "2026-10-31T00:00:00Z")).toBe(next);
  });

  test("withSeen can bring one item up to date, for Got it", () => {
    const list = [item({ seen: [] }), item({ choice: "Barbara Lee", seen: [] })];
    const next = withSeen(list, () => before, "2026-10-30T00:00:00Z", {
      key: KEY,
      choice: "Barbara Lee",
    });
    expect(next[0]?.seen).toEqual([]);
    expect(next[1]?.seen).toHaveLength(1);
  });

  test("a race the catalog dropped stays as it was", () => {
    const list = [item()];
    expect(withSeen(list, () => undefined, "2026-10-30T00:00:00Z")).toBe(list);
  });
});

describe("resultLine", () => {
  const result = (over: Partial<ResultRace>): ResultRace =>
    ({
      id: 1,
      election_name: "Oakland Mayor",
      percent_reporting: 42,
      candidates: [
        { name: "Julius Robinson", percent: 30.25, votes: 300 },
        { name: "Barbara Lee", percent: 61.2, votes: 600 },
      ],
      ...over,
    }) as ResultRace;

  test("the followed candidate, leading", () => {
    expect(resultLine(result({}), "Barbara Lee")).toBe(
      "Barbara Lee 61.2%, leading · 42.0% reporting",
    );
  });

  test("the followed candidate, behind", () => {
    expect(resultLine(result({}), "Julius Robinson")).toBe(
      "Julius Robinson 30.3%, behind Barbara Lee's 61.2% · 42.0% reporting",
    );
  });

  test("a whole race shows the top two", () => {
    expect(resultLine(result({}))).toBe(
      "Barbara Lee 61.2%, Julius Robinson 30.3% · 42.0% reporting",
    );
  });

  test("a called race says who won", () => {
    const called = result({
      percent_reporting: 100,
      candidates: [
        { name: "Barbara Lee", percent: 61.2, winner: true },
        { name: "Julius Robinson", percent: 30.2 },
      ],
    });
    expect(resultLine(called)).toBe("Barbara Lee won, 61.2%");
    expect(resultLine(called, "Barbara Lee")).toBe("Barbara Lee won, 61.2%");
    expect(resultLine(called, "Julius Robinson")).toBe(
      "Barbara Lee won, 61.2%; Julius Robinson 30.2%",
    );
  });

  test("no votes in, or a name the feed doesn't have, shows nothing", () => {
    expect(
      resultLine(result({ candidates: [{ name: "Barbara Lee", percent: 0 }] })),
    ).toBeUndefined();
    expect(resultLine(result({}), "Someone Else")).toBeUndefined();
  });
});
