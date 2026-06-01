import { type SlatePayload, verifySlate } from "@openslate/core";
import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { shortKey } from "../lib/identities";
import { useResolvedRaces } from "../lib/results";
import { type SlateSummary, summarizeSlate } from "../lib/slate-summary";

interface LeaderboardProps {
  tokens: string[];
}

/**
 * Optional cross-slate leaderboard on /results. Defers the fan-out of
 * civicAPI fetches until the user explicitly asks, since enabling it for
 * many slates queues a lot of parallel requests (most will hit cache after
 * the first round, but the initial round is real bandwidth).
 *
 * Each LeaderboardRow runs its own useResolvedRaces and reports its summary
 * back via a callback so the parent can sort the table by win rate as data
 * streams in. Rows whose summary hasn't reported yet sink to the bottom
 * rather than disappearing, so the table doesn't flicker.
 */
export function Leaderboard({ tokens }: LeaderboardProps) {
  const [open, setOpen] = useState(false);
  const [reported, setReported] = useState<Map<string, SlateSummary>>(new Map());

  // Stable callback so each row's useEffect only fires on real count changes.
  const handleSummary = useCallback((t: string, s: SlateSummary) => {
    setReported((prev) => {
      const prior = prev.get(t);
      if (
        prior &&
        prior.wins === s.wins &&
        prior.losses === s.losses &&
        prior.pending === s.pending &&
        prior.unresolved === s.unresolved
      ) {
        return prev;
      }
      const next = new Map(prev);
      next.set(t, s);
      return next;
    });
  }, []);

  const verified = useMemo(() => {
    return tokens.map((token) => ({ token, payload: verifySlate(token).payload }));
  }, [tokens]);

  const sortedTokens = useMemo(() => {
    return [...tokens].sort((a, b) => {
      const sa = reported.get(a)?.winRate;
      const sb = reported.get(b)?.winRate;
      if (sa === undefined && sb === undefined) return 0;
      if (sa === undefined) return 1;
      if (sb === undefined) return -1;
      if (sa === null && sb === null) return 0;
      if (sa === null) return 1;
      if (sb === null) return -1;
      return sb - sa;
    });
  }, [tokens, reported]);

  if (verified.length < 2) return null;

  return (
    <div className="card">
      <div className="card-title">
        <strong>Compare slates</strong>
        <span className="tag">{verified.length} slates</span>
        <button type="button" className="link" onClick={() => setOpen((v) => !v)}>
          {open ? "Hide" : "Show leaderboard"}
        </button>
      </div>
      {open ? (
        <table className="region-table">
          <thead>
            <tr>
              <th>Slate</th>
              <th className="num">Total</th>
              <th className="num">Wins</th>
              <th className="num">Losses</th>
              <th className="num">Pending</th>
              <th className="num">Win rate</th>
            </tr>
          </thead>
          <tbody>
            {sortedTokens.map((token) => {
              const row = verified.find((r) => r.token === token);
              if (!row?.payload) return null;
              return (
                <LeaderboardRow
                  key={token}
                  token={token}
                  payload={row.payload}
                  onSummary={handleSummary}
                />
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="hint">
          Fans out a civicAPI fetch per position per slate. Cache is shared with the per-slate
          result pages, so opening this is free once you've already viewed those.
        </p>
      )}
    </div>
  );
}

interface LeaderboardRowProps {
  token: string;
  payload: SlatePayload;
  onSummary: (token: string, summary: SlateSummary) => void;
}

function LeaderboardRow({ token, payload, onSummary }: LeaderboardRowProps) {
  const subjects = useMemo(() => payload.positions.map((p) => p.subject), [payload]);
  const races = useResolvedRaces(subjects);
  const summary = useMemo(
    () => summarizeSlate(payload.positions, races),
    [payload.positions, races],
  );

  useEffect(() => {
    onSummary(token, summary);
  }, [token, summary, onSummary]);

  const displayName =
    payload.attribution?.of.name ?? payload.issuer.name?.trim() ?? shortKey(payload.issuer.key);
  const winRateText = summary.winRate === null ? "—" : `${Math.round(summary.winRate * 100)}%`;

  return (
    <tr>
      <td>
        {payload.attribution && <span className="tag">secondhand</span>}{" "}
        <Link to="/results/$token" params={{ token }}>
          {displayName}
        </Link>
      </td>
      <td className="num">{summary.total}</td>
      <td className="num">{summary.wins}</td>
      <td className="num">{summary.losses}</td>
      <td className="num">{summary.pending + summary.unresolved}</td>
      <td className="num">{winRateText}</td>
    </tr>
  );
}
