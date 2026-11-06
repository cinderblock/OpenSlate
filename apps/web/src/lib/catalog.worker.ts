import { storedDeps } from "./catalogDeps";
import { type CatalogStatus, createCatalogService, type LineUpAsk } from "./catalogService";
import type { LinedUp } from "./lineUp";
import type { Catalog, CatalogEntry } from "./query";

/**
 * The public catalog off the page: downloading the bundle, parsing it,
 * checking every signature, keeping the copy, and lining up every race. The
 * page (allSlates.ts) sees the progress and the races, nothing more. The
 * catalog's list and single slates are asked of the page, whose query cache
 * other pages share.
 */

/** From the page. */
export type ToCatalogWorker =
  | { type: "load"; catalogUrl: string }
  | { type: "lineUp"; id: number; ask: LineUpAsk }
  | { type: "answer"; id: number; value?: unknown; error?: string };

/** Asked of the page, and answered with `answer`. */
export type CatalogQuestion =
  | { what: "catalog"; catalogUrl: string }
  | { what: "slate"; entry: CatalogEntry; catalogUrl: string };

/** To the page. */
export type FromCatalogWorker =
  | { type: "status"; status: CatalogStatus }
  | { type: "linedUp"; id: number; result?: LinedUp; error?: string }
  | { type: "ask"; id: number; question: CatalogQuestion };

const post = (message: FromCatalogWorker) => self.postMessage(message);

let nextAsk = 0;
const asked = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (err: Error) => void }
>();

function ask<T>(question: CatalogQuestion): Promise<T> {
  const id = nextAsk++;
  return new Promise<T>((resolve, reject) => {
    asked.set(id, { resolve: (value) => resolve(value as T), reject });
    post({ type: "ask", id, question });
  });
}

const service = createCatalogService({
  ...storedDeps,
  fetchCatalog: (catalogUrl) => ask<Catalog>({ what: "catalog", catalogUrl }),
  fetchSlate: (entry, catalogUrl) => ask<string>({ what: "slate", entry, catalogUrl }),
});
service.subscribe(() => post({ type: "status", status: service.status() }));

self.onmessage = (event: MessageEvent<ToCatalogWorker>) => {
  const message = event.data;
  if (message.type === "load") service.load(message.catalogUrl);
  else if (message.type === "answer") {
    const waiting = asked.get(message.id);
    asked.delete(message.id);
    if (message.error !== undefined) waiting?.reject(new Error(message.error));
    else waiting?.resolve(message.value);
  } else {
    const { id } = message;
    service.lineUp(message.ask).then(
      (result) => post({ type: "linedUp", id, result }),
      (err) =>
        post({ type: "linedUp", id, error: err instanceof Error ? err.message : String(err) }),
    );
  }
};
