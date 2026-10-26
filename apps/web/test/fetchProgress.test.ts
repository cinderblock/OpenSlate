import { describe, expect, test } from "bun:test";
import { forEachConcurrently, readTextWithProgress } from "../src/lib/fetchProgress";

describe("forEachConcurrently", () => {
  test("runs every item, never more than the limit at once", async () => {
    let running = 0;
    let peak = 0;
    const seen: number[] = [];
    await forEachConcurrently([1, 2, 3, 4, 5, 6, 7], 3, async (item) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      seen.push(item);
      running--;
    });
    expect(peak).toBe(3);
    expect(seen.sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test("starts no new items once stopped", async () => {
    const started: number[] = [];
    let stop = false;
    await forEachConcurrently(
      [1, 2, 3, 4, 5],
      1,
      async (item) => {
        started.push(item);
        if (item === 2) stop = true;
      },
      () => stop,
    );
    expect(started).toEqual([1, 2]);
  });
});

describe("readTextWithProgress", () => {
  test("reports the bytes as they arrive and returns the text", async () => {
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("héllo "));
        controller.enqueue(encoder.encode("world"));
        controller.close();
      },
    });
    const progress: number[] = [];
    const text = await readTextWithProgress(new Response(body), (n) => progress.push(n));
    expect(text).toBe("héllo world");
    expect(progress).toEqual([7, 12]);
  });
});
