import type { Forecast, Subject } from "@openslate/core";
import { useQueries, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import {
  forecastEventQueryOptions,
  forecastsHealthOptions,
  forecastsSource,
} from "../lib/forecasts";

interface ForecastsPanelProps {
  subject: Subject;
}

/**
 * Surface Kalshi prediction-market data for a subject. These are
 * market-implied probabilities, NOT polls — labelled accordingly so a viewer
 * doesn't confuse them with survey data.
 *
 * Renders nothing unless the app's backend relays Kalshi, which only a
 * self-hosted server opts into (lib/forecasts.ts).
 */
export function ForecastsPanel({ subject }: ForecastsPanelProps) {
  const lookup = useMemo(() => forecastsSource.lookup(subject), [subject]);
  const relay = useQuery(forecastsHealthOptions());

  const queries = useQueries({
    queries: lookup.eventIds.map((id) => ({
      ...forecastEventQueryOptions(id),
      enabled: relay.data === true,
    })),
  });

  const loading = queries.some((q) => q.isLoading);
  const failed = queries.some((q) => q.error);

  // Pick the first non-null result. We don't merge across events because each
  // event is a distinct market question.
  const forecast: Forecast | null = useMemo(() => {
    for (const q of queries) {
      if (q.data) return q.data;
    }
    return null;
  }, [queries]);

  if (relay.data !== true || lookup.eventIds.length === 0) return null;

  // Kalshi errored (often a rate limit) and the relay had no earlier copy: say
  // so in one line rather than showing the error. The ticker that failed may
  // be the one that exists, so this isn't "no market matched".
  const unavailable = !loading && failed && !forecast;

  return (
    <div className="card">
      <div className="card-title">
        <strong>Forecast (market-implied)</strong>
        {forecast && (
          <span className="tag" title={`Kalshi event: ${forecast.eventId}`}>
            {forecast.eventId}
          </span>
        )}
        {forecast?.mutuallyExclusive === true && (
          <span className="tag" title="Probabilities should sum to ~100%">
            exclusive
          </span>
        )}
      </div>

      {loading && !forecast && <p className="hint">Loading forecast…</p>}

      {unavailable && <p className="hint">Kalshi isn't answering right now. Try again later.</p>}

      {!loading && !failed && !forecast && (
        <p className="hint">
          No Kalshi market matched. Tried{" "}
          {lookup.eventIds.map((id, i) => (
            <span key={id}>
              {i > 0 && ", "}
              <code className="key">{id}</code>
            </span>
          ))}
          .
        </p>
      )}

      {forecast && <ForecastBody forecast={forecast} />}

      {!unavailable && (
        <p className="hint">
          Forecast data via{" "}
          <a href="https://kalshi.com" target="_blank" rel="noreferrer">
            Kalshi
          </a>{" "}
          — these are <strong>market-implied probabilities</strong> from a regulated prediction
          market, not polls. Subject to{" "}
          <a href="https://kalshi.com/legal" target="_blank" rel="noreferrer">
            Kalshi's terms
          </a>
          .
        </p>
      )}
    </div>
  );
}

/** "Oct 24, 3:12 PM PDT" in the reader's own time zone. */
function formatAsOf(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

function ForecastBody({ forecast }: { forecast: Forecast }) {
  const candidates = forecast.candidates.slice(0, 12);
  const hasParty = candidates.some((c) => c.party);
  return (
    <>
      {forecast.staleAsOf && (
        <p className="hint warning">
          Kalshi isn't answering right now. These prices are from{" "}
          <time dateTime={forecast.staleAsOf}>{formatAsOf(forecast.staleAsOf)}</time> and may have
          moved since.
        </p>
      )}
      <p className="hint">
        <a href={forecast.url} target="_blank" rel="noreferrer">
          {forecast.title}
        </a>
        {forecast.closeTime && <> · closes {forecast.closeTime.slice(0, 10)}</>}
        {typeof forecast.totalVolume === "number" && forecast.totalVolume > 0 && (
          <> · ${Math.round(forecast.totalVolume).toLocaleString()} traded</>
        )}
      </p>
      <table className="region-table">
        <thead>
          <tr>
            <th>Candidate</th>
            {hasParty && <th>Party</th>}
            <th className="num">Probability</th>
            <th className="num">Volume</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c) => (
            <tr key={c.marketId ?? c.name}>
              <td>
                {c.url ? (
                  <a href={c.url} target="_blank" rel="noreferrer">
                    {c.name}
                  </a>
                ) : (
                  c.name
                )}
                {c.settled && <span className="ok"> ✓ won</span>}
              </td>
              {hasParty && <td>{c.party ?? "—"}</td>}
              <td className="num">{(c.probability * 100).toFixed(1)}%</td>
              <td className="num">
                {c.liquidity !== undefined && c.liquidity > 0
                  ? `$${Math.round(c.liquidity).toLocaleString()}`
                  : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
