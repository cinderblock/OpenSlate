import { rememberDecoded } from "./collate";
import { type LineUpInput, lineUp } from "./lineUp";

/**
 * `lineUp` off the page (allSlates.ts `lineUpOffPage`). The slates come
 * decoded and verified already, and adoptions look theirs up by token, so
 * they're remembered first: nothing is checked twice.
 */

export interface LineUpRequest {
  id: number;
  input: LineUpInput;
}

export type LineUpReply =
  | { id: number; result: ReturnType<typeof lineUp> }
  | { id: number; error: string };

self.onmessage = (event: MessageEvent<LineUpRequest>) => {
  const { id, input } = event.data;
  let reply: LineUpReply;
  try {
    rememberDecoded(input.imported);
    rememberDecoded(input.catalog);
    reply = { id, result: lineUp(input) };
  } catch (err) {
    reply = { id, error: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(reply);
};
