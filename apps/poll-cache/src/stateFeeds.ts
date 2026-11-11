/**
 * State election offices' own results feeds, relayed so a crowd of browsers
 * costs a state one request per file per minute, not one each, and so the
 * feeds that answer no browser (no CORS header) can be read at all. Only the
 * states and paths `@openslate/core/stateResults` lists are fetched, with an
 * honest User-Agent. The public worker and a self-hosted apps/server both
 * mount this. Stateless apart from the cache; stores and logs nothing.
 *
 * `/api/state/<postal code>/<file>`, e.g. `/api/state/va/data`,
 * `/api/state/co/current_ver.txt`, `/api/state/sd/legislature`: a path under
 * the state's feed, or the name the registry gives one of its files.
 */

import { stateFeed, stateFeedPathTtl, stateFeedUrl } from "@openslate/core/stateResults";
import { type CountyUpstream, relayFeed } from "./countyCa";

export const STATE_FEEDS_PREFIX = "/api/state/";

export function stateFeedUpstream(pathname: string): CountyUpstream | null {
  if (!pathname.startsWith(STATE_FEEDS_PREFIX)) return null;
  const inner = pathname.slice(STATE_FEEDS_PREFIX.length);
  const slash = inner.indexOf("/");
  if (slash < 0) return null;
  const feed = stateFeed(inner.slice(0, slash));
  if (!feed) return null;
  const rest = inner.slice(slash + 1);
  const ttl = stateFeedPathTtl(feed, rest);
  return ttl === null ? null : { url: stateFeedUrl(feed, rest), ttl };
}

export function handleStateFeed(pathname: string, cors: Record<string, string>): Promise<Response> {
  return relayFeed(stateFeedUpstream(pathname), cors, "State election office");
}
