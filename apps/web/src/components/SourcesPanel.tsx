import { Landmark, Library, Link2, Scale, Trash2, UserCheck, UserPlus } from "lucide-react";
import { useMemo, useState } from "react";
import { type DecodedSlate, electionOf } from "../lib/collate";
import { slatesCollection } from "../lib/collections";
import { formatElectionDate } from "../lib/dates";
import { followsStore, setFollowed, useDecodedSlates, useFollows } from "../lib/myVote";
import { type Source, isBallotSource, isFollowed } from "../lib/sources";
import { CatalogBrowser } from "./CatalogBrowser";
import { ContactsCard } from "./ContactsCard";
import { EndorserAvatar } from "./EndorserAvatar";
import { ImportVerifyPanel } from "./ImportVerifyPanel";
import { LeanMeter } from "./LeanMeter";
import { SlatesList } from "./SlatesList";
import { SpectrumStrip } from "./SpectrumStrip";
import { Switch } from "./ui/Switch";

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

      {/* Two columns on a wide screen once there's something imported: what you
          have on the left, "Add sources" on the right. One column, in this
          order, on a phone. */}
      <div className={isReady && groups.length > 0 ? "sources-layout" : undefined}>
        {isReady && ballots.length > 0 && (
          <div className="card sources-ballot">
            <h3>
              <Landmark className="icon" /> Ballot data
            </h3>
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
          <div className="card sources-following">
            <h3>
              <UserCheck className="icon" /> Following ({following.length})
            </h3>
            {following.length === 0 ? (
              <p className="hint">You aren't following anyone yet. Follow some from Add sources.</p>
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

        {isReady && following.length > 0 && (
          <div className="card sources-spectrum">
            <h3>
              <Scale className="icon" /> Left to right
            </h3>
            <p className="hint">
              Where the sources you follow sit, by the side they took wherever the Democratic and
              Republican parties split. Tap one for its counts.
            </p>
            <SpectrumStrip sources={following.map((g) => g.source)} />
          </div>
        )}

        <div className="sources-add">
          <h3 className="section-heading">
            <UserPlus className="icon" /> Add sources
          </h3>
          <div className="segmented" role="tablist" aria-label="Add sources from">
            <button
              type="button"
              role="tab"
              aria-selected={addTab === "catalog"}
              className={addTab === "catalog" ? "active" : ""}
              onClick={() => setAddTab("catalog")}
            >
              <Library className="icon" /> Public catalog
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={addTab === "paste"}
              className={addTab === "paste" ? "active" : ""}
              onClick={() => setAddTab("paste")}
            >
              <Link2 className="icon" /> Link, file, QR or paste
            </button>
          </div>
          {addTab === "catalog" ? (
            <div className="card">
              <CatalogBrowser />
            </div>
          ) : (
            <ImportVerifyPanel embedded />
          )}
        </div>

        <div className="sources-contacts">
          <ContactsCard />
        </div>

        {slates.length > 0 && (
          <details className="card sources-all">
            <summary>All imported slates ({slates.length})</summary>
            <SlatesList />
          </details>
        )}
      </div>
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
        <Switch
          isSelected={group.followed}
          onChange={(on) => setFollowed(source.id, on)}
          aria-label={`Follow ${source.name}`}
        />
      )}
      <EndorserAvatar sourceId={source.id} name={source.name} size="md" />
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
          {source.secondhand
            ? `reported by ${source.signerName ?? "a researcher"}, not signed by them`
            : "signed by them"}
          {group.slates.some((s) => !s.valid) && (
            <span className="warning"> · a slate failed verification</span>
          )}
        </div>
        {!group.ballot && <LeanMeter sourceId={source.id} name={source.name} withWord />}
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
          <Trash2 className="icon" /> remove
        </button>
      )}
    </li>
  );
}
