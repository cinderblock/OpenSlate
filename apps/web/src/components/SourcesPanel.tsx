import { useMemo, useState } from "react";
import { type DecodedSlate, electionOf } from "../lib/collate";
import { slatesCollection } from "../lib/collections";
import { formatElectionDate } from "../lib/dates";
import { followsStore, setFollowed, useDecodedSlates, useFollows } from "../lib/myVote";
import { type Source, isBallotSource, isFollowed } from "../lib/sources";
import { CatalogBrowser } from "./CatalogBrowser";
import { ContactsCard } from "./ContactsCard";
import { ImportVerifyPanel } from "./ImportVerifyPanel";
import { SlatesList } from "./SlatesList";

interface SourceGroup {
  source: Source;
  slates: DecodedSlate[];
  elections: string[];
  positions: number;
  followed: boolean;
  /** An official candidate list, not a recommendation. */
  ballot: boolean;
}

function groupBySource(slates: DecodedSlate[], follows: Record<string, boolean>): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const slate of slates) {
    const group = groups.get(slate.source.id) ?? {
      source: slate.source,
      slates: [],
      elections: [],
      positions: 0,
      followed: isFollowed(follows, slate.source.id),
      ballot: isBallotSource(slate.source),
    };
    group.slates.push(slate);
    group.positions += slate.payload.positions.length;
    for (const position of slate.payload.positions) {
      const election = electionOf(position.subject, slate.payload);
      if (election && !group.elections.includes(election)) group.elections.push(election);
    }
    groups.set(slate.source.id, group);
  }
  return [...groups.values()]
    .map((g) => ({ ...g, elections: g.elections.sort() }))
    .sort((a, b) => a.source.name.localeCompare(b.source.name));
}

type AddTab = "catalog" | "paste";

export function SourcesPanel() {
  const { slates, isReady } = useDecodedSlates();
  const [follows] = useFollows();
  const groups = useMemo(() => groupBySource(slates, follows), [slates, follows]);
  const ballots = groups.filter((g) => g.ballot);
  const following = groups.filter((g) => !g.ballot && g.followed);
  const notFollowing = groups.filter((g) => !g.ballot && !g.followed);
  const [addTab, setAddTab] = useState<AddTab>("catalog");

  return (
    <section className="panel">
      <h2>Sources</h2>
      <p className="hint">
        The organizations and people whose endorsements you've imported. Sources you follow show on
        My ballot; the rest stay imported so you can compare on race pages.
      </p>

      {isReady && ballots.length > 0 && (
        <div className="card">
          <h3>Ballot data</h3>
          <p className="hint">
            Official candidate lists. They aren't recommendations, so there's nothing to follow;
            they give each race its whole field.
          </p>
          <ul className="source-list">
            {ballots.map((group) => (
              <SourceRow key={group.source.id} group={group} />
            ))}
          </ul>
        </div>
      )}

      {isReady && groups.length > ballots.length && (
        <div className="card">
          <h3>Following ({following.length})</h3>
          {following.length === 0 ? (
            <p className="hint">You aren't following anyone yet. Follow sources below.</p>
          ) : (
            <ul className="source-list">
              {following.map((group) => (
                <SourceRow key={group.source.id} group={group} />
              ))}
            </ul>
          )}
          {notFollowing.length > 0 && (
            <details>
              <summary>Imported but not followed ({notFollowing.length})</summary>
              <ul className="source-list">
                {notFollowing.map((group) => (
                  <SourceRow key={group.source.id} group={group} />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      <h3 className="section-heading">Add sources</h3>
      <div className="segmented" role="tablist" aria-label="Add sources from">
        <button
          type="button"
          role="tab"
          aria-selected={addTab === "catalog"}
          className={addTab === "catalog" ? "active" : ""}
          onClick={() => setAddTab("catalog")}
        >
          Public catalog
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={addTab === "paste"}
          className={addTab === "paste" ? "active" : ""}
          onClick={() => setAddTab("paste")}
        >
          Link, file, QR or paste
        </button>
      </div>
      {addTab === "catalog" ? (
        <div className="card">
          <CatalogBrowser />
        </div>
      ) : (
        <ImportVerifyPanel embedded />
      )}

      <ContactsCard />

      {slates.length > 0 && (
        <details className="card">
          <summary>All imported slates ({slates.length})</summary>
          <SlatesList />
        </details>
      )}
    </section>
  );
}

function SourceRow({ group }: { group: SourceGroup }) {
  const [confirming, setConfirming] = useState(false);
  const { source } = group;

  function remove() {
    for (const slate of group.slates) slatesCollection.delete(slate.token);
    // Forget the follow choice too, so importing it again starts fresh.
    followsStore.set((current) => {
      const next = { ...current };
      delete next[source.id];
      return next;
    });
  }

  return (
    <li className="source-row">
      {!group.ballot && (
        <label className="switch" title={group.followed ? "Following" : "Not following"}>
          <input
            type="checkbox"
            checked={group.followed}
            onChange={(e) => setFollowed(source.id, e.target.checked)}
          />
          <span className="sr-only">Follow {source.name}</span>
        </label>
      )}
      <div className="grow">
        {source.uri ? (
          <a href={source.uri} target="_blank" rel="noreferrer">
            {source.name}
          </a>
        ) : (
          <strong>{source.name}</strong>
        )}
        <div className="hint">
          {group.elections.map(formatElectionDate).join(", ") || "no election date"} ·{" "}
          {group.positions} {group.ballot ? "ballot lines" : "positions"} ·{" "}
          {source.secondhand ? (
            <span title={`Signed by ${source.signerKey}. ${source.name} did not sign this.`}>
              reported by {source.signerName ?? "a researcher"}
            </span>
          ) : (
            <span title={source.signerKey}>signed by them</span>
          )}
          {group.slates.some((s) => !s.valid) && (
            <span className="warning"> · a slate failed verification</span>
          )}
        </div>
      </div>
      {confirming ? (
        <span className="row">
          <button type="button" className="danger" onClick={remove}>
            Remove {group.slates.length} slate{group.slates.length === 1 ? "" : "s"}
          </button>
          <button type="button" className="link" onClick={() => setConfirming(false)}>
            cancel
          </button>
        </span>
      ) : (
        <button type="button" className="link danger" onClick={() => setConfirming(true)}>
          remove
        </button>
      )}
    </li>
  );
}
