import type { Subject } from "./schema";

/**
 * Forecasts are *market-implied probabilities*, not polls. A `ForecastSource`
 * adapter surfaces prediction-market data (Kalshi, Polymarket, etc.) in a
 * unified shape so UI doesn't have to know provider quirks.
 *
 * Display layers MUST label forecasts as such — they're not survey data and
 * the epistemic basis is different from a pollster's sample.
 */

export interface ForecastCandidate {
  /** Display name of the candidate or option. */
  name: string;
  /** Optional party / affiliation, when the provider exposes it. */
  party?: string;
  /** Market-implied probability in [0, 1]. */
  probability: number;
  /** Provider's id for the market (one option of an event). */
  marketId?: string;
  /** Provider URL for "more info" on this option's market. */
  url?: string;
  /** Volume / open-interest hint — low values mean the price is thinly traded. */
  liquidity?: number;
  /** Whether this option has already settled YES (i.e. won). */
  settled?: boolean;
}

export interface Forecast {
  /** Provider's id for the event. */
  eventId: string;
  /** Display title from the provider. */
  title: string;
  /** When the markets close / resolve. */
  closeTime?: string;
  /** When the provider last updated this event's data. */
  updatedAt?: string;
  /**
   * Whether the candidate markets are mutually exclusive. When true, the
   * probabilities should approximately sum to 100% (modulo bid-ask spread).
   */
  mutuallyExclusive?: boolean;
  /** Per-option market prices, ordered by probability descending. */
  candidates: ForecastCandidate[];
  /** Aggregate volume across the event's markets, in provider units. */
  totalVolume?: number;
  /** Link to the event's page on the provider's site. */
  url?: string;
}

export interface ForecastLookup {
  /**
   * Provider event IDs to try, ordered most-specific first. Callers fan out
   * across these and use the first non-null response.
   */
  eventIds: string[];
}

export interface ForecastSource {
  readonly name: string;
  readonly url: string;
  readonly license?: string;
  /** Derive provider event IDs from an OpenSlate Subject. */
  lookup(subject: Subject): ForecastLookup;
  /** Fetch one event's forecast, or `null` when the event doesn't exist. */
  forecastForEvent(eventId: string): Promise<Forecast | null>;
}

// ---- Reusable helpers for Kalshi-style ticker derivation -------------------

import { inferUsHouseDistrict, inferUsStateCode, inferYear } from "./polls";
import { inferOfficeFromTitle } from "./polls";

/**
 * Derive candidate Kalshi event tickers from a Subject. Kalshi tickers don't
 * follow a strict published schema, but the conventions for elections are:
 *
 * - Series ticker: `KX<OFFICE><STATE>` or `<OFFICE>PARTY<STATE>`
 * - Event ticker: `<SERIES>-<YY>` for the canonical annual event
 *
 * This returns up to 4 plausible tickers per office; callers try them in
 * order. Returns `[]` when neither year nor jurisdiction is parseable.
 */
export function inferKalshiEventTickers(subject: Subject): string[] {
  const office = inferOfficeFromTitle(subject);
  const stateCode = inferUsStateCode(subject);
  const year = inferYear(subject);
  const yy = year ? year.slice(-2) : undefined;
  const district = inferUsHouseDistrict(subject);
  if (!yy) return [];

  const ids: string[] = [];

  // House district (e.g. "CA-22" → KXCA22-26 / HOUSECA22-26)
  if (district) {
    const compact = district.replace("-", "");
    ids.push(`KX${compact}-${yy}`);
    ids.push(`HOUSE${compact}-${yy}`);
    ids.push(`KX${compact}PRIMARY-${yy}`);
  }

  if (stateCode && office) {
    switch (office) {
      case "governor":
        ids.push(`KXGOV${stateCode}-${yy}`);
        ids.push(`GOVPARTY${stateCode}-${yy}`);
        ids.push(`KXGOV${stateCode}PRIMARY-${yy}`);
        break;
      case "senator":
        ids.push(`KXSEN${stateCode}-${yy}`);
        ids.push(`SENATEPARTY${stateCode}-${yy}`);
        ids.push(`SENATE${stateCode}-${yy}`);
        break;
      case "president":
        ids.push(`PRESPARTY${stateCode}-${yy}`);
        break;
      case "attorney_general":
        ids.push(`KXAG${stateCode}-${yy}`);
        break;
      case "secretary_of_state":
        ids.push(`KXSOS${stateCode}-${yy}`);
        break;
      default:
        break;
    }
  }

  // Dedupe in-order.
  return [...new Set(ids)];
}
