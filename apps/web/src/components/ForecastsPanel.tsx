import type { Forecast, Subject } from "@openslate/core";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { forecastEventQueryOptions, forecastsSource } from "../lib/forecasts";

interface ForecastsPanelProps {
  subject: Subject;
}

/**
 * Surface Kalshi prediction-market data for a subject. These are
 * market-implied probabilities, NOT polls — labelled accordingly so a viewer
 * doesn't confuse them with survey data.
 */
export function ForecastsPanel({ subject }: ForecastsPanelProps) {
  const lookup = useMemo(() => forecastsSource.lookup(subject), [subject]);

  const queries = useQueries({
    queries: lookup.eventIds.map((id) => forecastEventQueryOptions(id)),
  });

  const loading = queries.some((q) => q.isLoading);
  const firstError = queries.find((q) => q.error)?.error;

  // Pick the first non-null result. We don't merge across events because each
  // event is a distinct market question.
  const forecast: Forecast | null = useMemo(() => {
    for (const q of queries) {
      if (q.data) return q.data;
    }
    return null;
  }, [queries]);

  if (lookup.eventIds.length === 0) return null;

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

      {firstError && !forecast && (
        <p className="hint warning">
          Couldn't load forecast:{" "}
          {firstError instanceof Error ? firstError.message : "unknown error"}
        </p>
      )}

      {!loading && !firstError && !forecast && (
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
    </div>
  );
}

function ForecastBody({ forecast }: { forecast: Forecast }) {
  const candidates = forecast.candidates.slice(0, 12);
  const hasParty = candidates.some((c) => c.party);
  return (
    <>
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
