import { mock } from "bun:test";

/**
 * Just enough of Cloudflare's runtime for the worker's code to load under
 * `bun test` (loaded by bunfig.toml's preload): the Durable Object base class
 * and the WebSocket auto-response pair. Tests give a Durable Object its own
 * fake state (test/recorder.test.ts).
 */

class DurableObject<Env = unknown> {
  constructor(
    readonly ctx: unknown,
    readonly env: Env,
  ) {}
}

mock.module("cloudflare:workers", () => ({ DurableObject }));

class WebSocketRequestResponsePair {
  constructor(
    readonly request: string,
    readonly response: string,
  ) {}
}

Object.assign(globalThis, {
  WebSocketRequestResponsePair:
    (globalThis as { WebSocketRequestResponsePair?: unknown }).WebSocketRequestResponsePair ??
    WebSocketRequestResponsePair,
});
