/**
 * Downloading many small things, or one big one, with progress to show for it.
 * Pure helpers: no React, no storage. Unit-tested in test/fetchProgress.test.ts.
 */

/**
 * Run `fn` over `items`, at most `limit` at a time, in order of starting.
 * Stops starting new ones once `stopped()` says so; ones already running
 * finish.
 */
export async function forEachConcurrently<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<void>,
  stopped: () => boolean = () => false,
): Promise<void> {
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length && !stopped()) {
      const index = next++;
      await fn(items[index] as T, index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Read a response body as text, reporting how many bytes have arrived. The
 * count is of decoded bytes, so compare it to the uncompressed size: a
 * compressed transfer's Content-Length is smaller than what the stream yields.
 */
export async function readTextWithProgress(
  response: Response,
  onProgress: (received: number) => void,
): Promise<string> {
  if (!response.body) return response.text();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    onProgress(received);
  }
  const all = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    all.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(all);
}
