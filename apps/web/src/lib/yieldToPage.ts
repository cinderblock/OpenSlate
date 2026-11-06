/**
 * The next task, without `setTimeout`'s once-a-second crawl in a background
 * tab. On a page it lets the page paint and answer input; in a worker, it lets
 * the worker answer messages.
 */
export function yieldToPage(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(null);
  });
}
