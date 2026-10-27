import type { Subject } from "@openslate/core";
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { type Poll, pollsBySubjectQueryOptions, pollsSource } from "../lib/polls";

interface PollsPanelProps {
  subject: Subject;
}

export function PollsPanel({ subject }: PollsPanelProps) {
  const lookup = useMemo(() => pollsSource.lookup(subject), [subject]);

  // Fan out one query per candidate provider key (most-specific first). Each
  // share TanStack cache so re-mounts are free; PollsSource encapsulates the
  // taxonomy quirks.
  const queries = useQueries({
    queries: lookup.subjectKeys.map((key) => pollsBySubjectQueryOptions(key)),
  });

  const loading = queries.some((q) => q.isLoading);
  const firstError = queries.find((q) => q.error)?.error;

  const polls = useMemo(() => {
    const seen = new Set<string>();
    const merged: Poll[] = [];
    for (const q of queries) {
      for (const p of q.data ?? []) {
        if (seen.has(p.id)) continue;
        if (!pollsSource.matches(p, lookup)) continue;
        seen.add(p.id);
        merged.push(p);
      }
    }
    return sortPolls(merged);
  }, [queries, lookup]);

  const officeLabel = lookup.office && lookup.office !== "other" ? lookup.office : undefined;

  return (
    <div className="card">
      <div className="card-title">
        <strong>Recent polls</strong>
        {lookup.subjectKeys.map((key) => (
          <span key={key} className="tag">
            {key}
          </span>
        ))}
        {officeLabel && <span className="tag">office: {officeLabel.replace("_", " ")}</span>}
      </div>

      {loading && <p className="hint">Loading polls…</p>}

      {firstError && (
        <p className="hint warning">
          Couldn't load polls: {firstError instanceof Error ? firstError.message : "unknown error"}
        </p>
      )}

      {!loading && !firstError && polls.length === 0 && (
        <EmptyPolls subjectKeys={lookup.subjectKeys} officeLabel={officeLabel} />
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
                    // biome-ignore lint/suspicious/noArrayIndexKey: a static list that never reorders
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
        <a href={pollsSource.url} target="_blank" rel="noreferrer">
          {pollsSource.name}
        </a>
        {pollsSource.license && (
          <>
            {" "}
            — licensed{" "}
            <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">
              {pollsSource.license}
            </a>
          </>
        )}
        .
      </p>
    </div>
  );
}

function EmptyPolls({ subjectKeys, officeLabel }: { subjectKeys: string[]; officeLabel?: string }) {
  if (subjectKeys.length === 0) {
    return (
      <p className="hint">
        VoteHub doesn't track polls of this race. It covers governor and U.S. Senate and House
        races, some other statewide offices and measures, and big-city mayors.
      </p>
    );
  }
  return (
    <p className="hint">
      No {officeLabel ?? ""} polls found. Tried{" "}
      {subjectKeys.map((key, i) => (
        <span key={key}>
          {i > 0 && ", "}
          <code className="key">{key}</code>
        </span>
      ))}
      . If VoteHub's dataset has no polls of this race, none will show. Browse{" "}
      <a href="https://votehub.com" target="_blank" rel="noreferrer">
        votehub.com
      </a>{" "}
      to confirm.
    </p>
  );
}

function sortPolls(polls: Poll[]): Poll[] {
  return [...polls].sort((a, b) => (b.end_date ?? "").localeCompare(a.end_date ?? ""));
}
