import { afterAll, expect, test } from "bun:test";

// src/index.ts reads KALSHI_FORECASTS when it loads, so each case loads its own
// copy of the module (the query string makes it a separate module instance).
const saved = process.env.KALSHI_FORECASTS;
afterAll(() => {
  if (saved === undefined) Reflect.deleteProperty(process.env, "KALSHI_FORECASTS");
  else process.env.KALSHI_FORECASTS = saved;
});

async function load(setting: string | undefined, tag: string) {
  if (setting === undefined) Reflect.deleteProperty(process.env, "KALSHI_FORECASTS");
  else process.env.KALSHI_FORECASTS = setting;
  return (await import(`../src/index.ts?${tag}`)).default as {
    fetch: (req: Request) => Response | Promise<Response>;
  };
}

async function health(server: Awaited<ReturnType<typeof load>>) {
  const res = await server.fetch(new Request("http://localhost/api/health"));
  return (await res.json()) as { forecasts?: unknown };
}

test("Kalshi forecasts are off unless KALSHI_FORECASTS=true", async () => {
  for (const [setting, tag] of [
    [undefined, "unset"],
    ["1", "one"],
  ] as const) {
    const server = await load(setting, tag);
    expect((await health(server)).forecasts).toBe(false);
    const res = await server.fetch(new Request("http://localhost/api/forecasts/v2/events/X"));
    expect(res.status).toBe(404);
  }
});

test("KALSHI_FORECASTS=true turns the relay on and says so", async () => {
  const server = await load("true", "on");
  expect((await health(server)).forecasts).toBe(true);
});
