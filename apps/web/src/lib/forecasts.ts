import {
  type Forecast,
  type ForecastCandidate,
  type ForecastSource,
  type Subject,
  inferKalshiEventTickers,
} from "@openslate/core";
import { baseUrlFor } from "./routing";

export type { Forecast, ForecastCandidate } from "@openslate/core";

// ---- Kalshi wire shapes (subset we use) ------------------------------------

interface KalshiMarket {
  ticker: string;
  title?: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  subtitle?: string;
  yes_ask_dollars?: string;
  yes_bid_dollars?: string;
  last_price_dollars?: string;
  open_interest_fp?: string;
  volume_fp?: string;
  status?: string;
  close_time?: string;
  rules_primary?: string;
  custom_strike?: Record<string, string> | null;
  result?: string;
}

interface KalshiEventEnvelope {
  event: {
    event_ticker: string;
    title?: string;
    mutually_exclusive?: boolean;
    series_ticker?: string;
  };
  markets?: KalshiMarket[];
}

// ---- Helpers ---------------------------------------------------------------

function kalshiUrl(path: string, params?: Record<string, string>): string {
  const search = params ? `?${new URLSearchParams(params).toString()}` : "";
  return `${baseUrlFor("kalshi")}${path}${search}`;
}

/**
 * Map a market to a candidate row. Returns `null` when the market doesn't
 * name a candidate (e.g. a degenerate parent market with no yes_sub_title).
 */
function marketToCandidate(market: KalshiMarket): ForecastCandidate | null {
  const name =
    market.yes_sub_title?.trim() ||
    market.custom_strike?.Candidate ||
    market.custom_strike?.candidate ||
    undefined;
  if (!name) return null;
  // Pick a price: last_price_dollars is the most recent trade; yes_ask is the
  // best ask. When the market has no recent activity, last_price stays at the
  // last trade — fine for headline. We fall back to yes_ask if last_price is
  // 0.0000 (no trades).
  const last = parseMoney(market.last_price_dollars);
  const ask = parseMoney(market.yes_ask_dollars);
  const bid = parseMoney(market.yes_bid_dollars);
  let probability = last;
  if (probability <= 0 && ask > 0) probability = (ask + bid) / 2;
  return {
    name,
    party: extractParty(market.subtitle ?? ""),
    probability,
    marketId: market.ticker,
    url: `https://kalshi.com/markets/${market.ticker}`,
    liquidity: Number.parseFloat(market.volume_fp ?? "0"),
    settled: market.status === "settled" && market.result === "yes",
  };
}

function parseMoney(value: string | undefined): number {
  if (!value) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Kalshi puts party affiliation in `subtitle`, formatted like `":: Republican"`.
 * Some markets use a different format; this regex stays lenient.
 */
function extractParty(subtitle: string): string | undefined {
  const match = /(?:::|–|—|-)\s*([A-Z][A-Za-z]+)/.exec(subtitle);
  if (!match) return undefined;
  const candidate = match[1];
  return candidate;
}

// ---- KalshiSource adapter --------------------------------------------------

export function createKalshiSource(): ForecastSource {
  return {
    name: "Kalshi",
    url: "https://kalshi.com",
    license: "Kalshi terms of service apply — see https://kalshi.com/legal",
    lookup(subject: Subject) {
      return { eventIds: inferKalshiEventTickers(subject) };
    },
    async forecastForEvent(eventId): Promise<Forecast | null> {
      // Kalshi's nested-markets parameter is `with_nested_markets` for
      // event.markets, but to keep the response shape stable we ask for
      // `include_markets=true` which lifts the array to top-level
      // `envelope.markets`. Both work; the latter is simpler to parse.
      const url = kalshiUrl(`/events/${encodeURIComponent(eventId)}`, {
        include_markets: "true",
      });
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.status === 404) return null;
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Kalshi event lookup failed: HTTP ${res.status}: ${body.slice(0, 200)}`);
      }
      const envelope = (await res.json()) as KalshiEventEnvelope;
      const event = envelope.event;
      const markets = envelope.markets ?? [];
      const candidates = markets
        .map(marketToCandidate)
        .filter((c): c is ForecastCandidate => c !== null)
        .sort((a, b) => b.probability - a.probability);
      const totalVolume = markets.reduce(
        (acc, m) => acc + Number.parseFloat(m.volume_fp ?? "0"),
        0,
      );
      const closeTime = markets[0]?.close_time;
      return {
        eventId: event.event_ticker,
        title: event.title ?? markets[0]?.title ?? event.event_ticker,
        closeTime,
        mutuallyExclusive: event.mutually_exclusive,
        candidates,
        totalVolume,
        url: `https://kalshi.com/markets/${event.event_ticker}`,
      };
    },
  };
}

export const forecastsSource: ForecastSource = createKalshiSource();

// ---- TanStack Query options ------------------------------------------------

export function forecastEventQueryOptions(eventId: string | undefined) {
  return {
    queryKey: ["forecasts", "event", eventId] as const,
    queryFn: async (): Promise<Forecast | null> => {
      if (!eventId) return null;
      return forecastsSource.forecastForEvent(eventId);
    },
    enabled: Boolean(eventId),
    // Kalshi markets move on every trade. Short staleTime so live updates
    // surface; cache still avoids hammering the proxy on quick re-renders.
    staleTime: 1000 * 60,
  };
}
