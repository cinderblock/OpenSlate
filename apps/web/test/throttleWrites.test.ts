import { describe, expect, test } from "bun:test";
import { throttleWrites } from "../src/lib/query";

/** A timer run by hand. */
function manualTimer() {
  const due: Array<() => void> = [];
  return {
    timer: { set: (fn: () => void) => due.push(fn) },
    fire() {
      for (const fn of due.splice(0)) fn();
    },
    get waiting() {
      return due.length;
    },
  };
}

describe("throttleWrites", () => {
  test("with the real timer, setTimeout isn't called as a method", async () => {
    const original = globalThis.setTimeout;
    // As in a browser: setTimeout with any `this` but the global throws.
    const strict = function (this: unknown, fn: () => void, ms?: number) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return original(fn, ms);
    };
    globalThis.setTimeout = strict as typeof setTimeout;
    try {
      const written: number[] = [];
      const persist = throttleWrites(async (n: number) => written.push(n), 1);
      persist(1);
      await Bun.sleep(20);
      expect(written).toEqual([1]);
    } finally {
      globalThis.setTimeout = original;
    }
  });

  test("many asks in a moment are one write, of the last", () => {
    const written: number[] = [];
    const clock = manualTimer();
    const persist = throttleWrites(async (n: number) => written.push(n), 1000, clock.timer);
    for (let n = 1; n <= 50; n++) persist(n);
    expect(written).toEqual([]);
    expect(clock.waiting).toBe(1);
    clock.fire();
    expect(written).toEqual([50]);
  });

  test("an ask after a write waits its own turn", () => {
    const written: string[] = [];
    const clock = manualTimer();
    const persist = throttleWrites(async (s: string) => written.push(s), 1000, clock.timer);
    persist("a");
    clock.fire();
    persist("b");
    persist("c");
    clock.fire();
    expect(written).toEqual(["a", "c"]);
  });

  test("a write that fails doesn't stop the next", async () => {
    const written: string[] = [];
    const clock = manualTimer();
    const persist = throttleWrites(
      async (s: string) => {
        if (s === "bad") throw new Error("quota");
        written.push(s);
      },
      1000,
      clock.timer,
    );
    persist("bad");
    clock.fire();
    await Promise.resolve();
    persist("good");
    clock.fire();
    expect(written).toEqual(["good"]);
  });
});
