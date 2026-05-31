import type { Subject } from "@openslate/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { type Poll, pollsBySubjectQueryOptions, subjectToVoteHubKey } from "../lib/polls";

interface PollsPanelProps {
  subject: Subject;
}

export function PollsPanel({ subject }: PollsPanelProps) {
  const voteHubKey = useMemo(() => subjectToVoteHubKey(subject), [subject]);
  const query = useQuery(pollsBySubjectQueryOptions(voteHubKey));

  const polls = useMemo(() => sortPolls(query.data ?? []), [query.data]);

  return (
    <div className="card">
      <div className="card-title">
        <strong>Recent polls</strong>
        {voteHubKey && <span className="tag">{voteHubKey}</span>}
      </div>

      {query.isLoading && <p className="hint">Loading polls…</p>}

      {query.error && (
        <p className="hint warning">
          Couldn't load polls:{" "}
          {query.error instanceof Error ? query.error.message : "unknown error"}
        </p>
      )}

      {!query.isLoading && !query.error && polls.length === 0 && (
        <p className="hint">
          No polls found for <code className="key">{voteHubKey}</code>. Try a different subject, or
          browse at{" "}
          <a href="https://votehub.com" target="_blank" rel="noreferrer">
            votehub.com
          </a>
          .
        </p>
      )}

      {polls.length > 0 && (
        <ul className="position-list">
          {polls.slice(0, 10).map((poll) => (
            <li key={poll.id}>
              <span className="position-subject">
                <strong>{poll.pollster}</strong>
                {poll.population && (
                  <span className="tag-inline"> {poll.population.toUpperCase()}</span>
                )}
                {poll.sample_size && <span className="hint"> n={poll.sample_size}</span>}
                {poll.end_date && <span className="hint"> · {poll.end_date}</span>}
                {poll.partisan && (
                  <span className="warning" title="Partisan-affiliated poll">
                    {" "}
                    · partisan ({poll.partisan})
                  </span>
                )}
                <div className="hint">
                  {poll.answers.map((a, i) => (
                    <span key={`${poll.id}-${a.choice}-${i}`}>
                      {i > 0 && " · "}
                      <strong>{a.choice}</strong> {a.pct.toFixed(1)}%
                    </span>
                  ))}
                  {poll.url && (
                    <>
                      {" · "}
                      <a href={poll.url} target="_blank" rel="noreferrer">
                        source
                      </a>
                    </>
                  )}
                </div>
              </span>
            </li>
          ))}
        </ul>
      )}

      <p className="hint">
        Polling data via{" "}
        <a href="https://votehub.com" target="_blank" rel="noreferrer">
          VoteHub
        </a>{" "}
        — licensed{" "}
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
          CC BY 4.0
        </a>
        .
      </p>
    </div>
  );
}

function sortPolls(polls: Poll[]): Poll[] {
  return [...polls].sort((a, b) => (b.end_date ?? "").localeCompare(a.end_date ?? ""));
}
