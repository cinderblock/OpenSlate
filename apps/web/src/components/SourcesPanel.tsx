import { useNavigate, useSearch } from "@tanstack/react-router";
import {
  ArrowDown,
  Landmark,
  Library,
  Link2,
  Scale,
  ThumbsDown,
  Trash2,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type DecodedSlate, electionOf } from "../lib/collate";
import { slatesCollection } from "../lib/collections";
import { formatElectionDate } from "../lib/dates";
import {
  followsStore,
  setStanding,
  useDecodedSlates,
  useDisagreeMode,
  useFollows,
} from "../lib/myVote";
import { usePageSearch } from "../lib/pageSearch";
import { matchesSearch, sourceSearchText } from "../lib/search";
import { type Source, type Standing, isBallotSource, standingOf } from "../lib/sources";
import { CatalogBrowser } from "./CatalogBrowser";
import { ContactsCard } from "./ContactsCard";
import { DisagreeModeSetting } from "./DisagreeModeSetting";
import { EndorserAvatar } from "./EndorserAvatar";
import { ImportVerifyPanel } from "./ImportVerifyPanel";
import { LeanMeter } from "./LeanMeter";
import { PageSearch, matchCount } from "./PageSearch";
import { SlatesList } from "./SlatesList";
import { SpectrumStrip } from "./SpectrumStrip";
import { StandingToggle } from "./StandingToggle";

interface SourceGroup {
  source: Source;
  /** What the search box finds it by (`sourceSearchText`). */
  searchText: string;
  slates: DecodedSlate[];
  elections: string[];
  positions: number;
  /** Links attached to ballot items (SPEC §3.15). */
  articles: number;
  standing: Standing;
  /** An official candidate list, not a recommendation. */
  ballot: boolean;
}

function groupBySource(slates: DecodedSlate[], follows: Record<string, Standing>): SourceGroup[] {
  const groups = new Map<string, SourceGroup>();
  for (const slate of slates) {
    const group = groups.get(slate.source.id) ?? {
      source: slate.source,
      searchText: "",
      slates: [],
      elections: [],
      positions: 0,
      articles: 0,
      standing: standingOf(follows, slate.source.id),
      ballot: isBallotSource(slate.source),
    };
    group.slates.push(slate);
    group.positions += slate.payload.positions.length;
    group.articles += slate.payload.articles?.length ?? 0;
    for (const { subject } of [...slate.payload.positions, ...(slate.payload.articles ?? [])]) {
      const election = electionOf(subject, slate.payload);
      if (election && !group.elections.includes(election)) group.elections.push(election);
    }
    groups.set(slate.source.id, group);
  }
  return [...groups.values()]
    .map((g) => {
      const elections = g.elections.sort();
      return { ...g, elections, searchText: sourceSearchText(g.source, elections) };
    })
    .sort((a, b) => a.source.name.localeCompare(b.source.name));
}

type AddTab = "catalog" | "paste";

export function SourcesPanel() {
  const { slates, isReady } = useDecodedSlates();
  const [follows] = useFollows();
  const [disagreeMode] = useDisagreeMode();
  const groups = useMemo(() => groupBySource(slates, follows), [slates, follows]);
  // The search box narrows the lists; the spectrum still shows everyone you follow.
  const search = usePageSearch("/sources");
  const shown = search.searching
    ? groups.filter((g) => matchesSearch(g.searchText, search.terms))
    : groups;
  const ballots = shown.filter((g) => g.ballot);
  const following = shown.filter((g) => !g.ballot && g.standing === "follow");
  const disagreeing = shown.filter((g) => !g.ballot && g.standing === "disagree");
  const notFollowing = shown.filter((g) => !g.ballot && g.standing === "off");
  const allFollowing = useMemo(
    () => groups.filter((g) => !g.ballot && g.standing === "follow"),
    [groups],
  );
  const endorsers = groups.some((g) => !g.ballot);
  const [addTab, setAddTab] = useState<AddTab>("catalog");

  // "Add endorsements" elsewhere (My ballot) links to `?add`: land on that
  // section, not the top of a long Following list. Then drop the flag, so
  // back and reload don't keep jumping.
  const { add } = useSearch({ from: "/sources" });
  const navigate = useNavigate({ from: "/sources" });
  const addHeading = useRef<HTMLHeadingElement>(null);
  const showAdd = useCallback(() => {
    const heading = addHeading.current;
    if (!heading) return;
    // Two columns put it near the top already; scroll only when it's down the page.
    const top = heading.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight / 2) heading.scrollIntoView({ block: "start" });
    heading.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    if (!add || !isReady) return;
    showAdd();
    void navigate({
      search: ({ add: _, ...rest }) => rest,
      replace: true,
      resetScroll: false,
    });
  }, [add, isReady, navigate, showAdd]);

  return (
    <section className="panel">
      <h2>Sources</h2>
      <p className="hint">
        The organizations and people whose endorsements you've imported. Sources you follow show on
        My ballot. So do sources you disagree with, counted the other way: what they back counts
        against it, and what they oppose counts for it. The rest stay imported so you can compare on
        race pages.
      </p>

      {/* On one column, "Add endorsements" is below everything you already
          have; on a wide screen it's the column beside it, so no need. */}
      {isReady && groups.length > 0 && (
        <button type="button" className="sources-jump" onClick={showAdd}>
          <UserPlus className="icon" /> Add endorsements <ArrowDown className="icon" />
        </button>
      )}

      {isReady && groups.length > 0 && (
        <PageSearch
          search={search}
          label="Search your sources"
          placeholder="Search your sources by name, reporter, link or election…"
        >
          {shown.length === 0
            ? `None of your sources match “${search.query.trim()}”. The public catalog under Add endorsements has its own search.`
            : matchCount(shown.length, groups.length, "sources", search.query)}
        </PageSearch>
      )}

      {/* Two columns on a wide screen once there's something imported: what you
          have on the left, "Add endorsements" on the right. One column, in this
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

        {isReady && endorsers && (!search.searching || shown.length > ballots.length) && (
          <div className="card sources-following">
            <h3>
              <UserCheck className="icon" /> Following ({following.length})
            </h3>
            {following.length === 0 ? (
              <p className="hint">
                {search.searching
                  ? "None you follow match."
                  : disagreeing.length === 0
                    ? "You aren't following anyone yet. Follow some from Add endorsements."
                    : "You aren't following anyone to agree with yet."}
              </p>
            ) : (
              <ul className="source-list">
                {following.map((group) => (
                  <SourceRow key={group.source.id} group={group} />
                ))}
              </ul>
            )}
            {disagreeing.length > 0 && (
              <>
                <h4 className="sources-subheading">
                  <ThumbsDown className="icon" /> Disagree with ({disagreeing.length})
                </h4>
                <ul className="source-list">
                  {disagreeing.map((group) => (
                    <SourceRow key={group.source.id} group={group} />
                  ))}
                </ul>
                <details className="disagree-mode-details">
                  <summary>
                    In two-way races:{" "}
                    {disagreeMode === "side" ? "for the other side" : "against what they picked"}
                  </summary>
                  <DisagreeModeSetting />
                </details>
              </>
            )}
            {notFollowing.length > 0 && (
              // Open while searching, so a match in here isn't hidden behind it.
              <details key={String(search.searching)} open={search.searching}>
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

        {/* Only the sources you agree with: a source you disagree with on the
            strip would read as "where you sit". */}
        {isReady && allFollowing.length > 0 && (
          <div className="card sources-spectrum">
            <h3>
              <Scale className="icon" /> Left to right
            </h3>
            <p className="hint">
              Where the sources you follow sit, by the side they took wherever the Democratic and
              Republican parties split. Tap one for its counts.
            </p>
            <SpectrumStrip sources={allFollowing.map((g) => g.source)} />
          </div>
        )}

        <div className="sources-add">
          <h3 className="section-heading" id="add-endorsements" ref={addHeading} tabIndex={-1}>
            <UserPlus className="icon" /> Add endorsements
          </h3>
          <p className="hint">
            Follow more organizations from the public catalog, or add a slate someone shared with
            you.
          </p>
          <div className="segmented" role="tablist" aria-label="Add endorsements from">
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
          {group.positions > 0 || group.articles === 0
            ? `${group.positions} ${group.ballot ? "ballot lines" : "positions"} · `
            : ""}
          {group.articles > 0 &&
            `${group.articles} ${group.articles === 1 ? "article" : "articles"} · `}
          {source.secondhand
            ? `reported by ${source.signerName ?? "a researcher"}, not signed by them`
            : "signed by them"}
          {group.slates.some((s) => !s.valid) && (
            <span className="warning"> · a slate failed verification</span>
          )}
        </div>
        {!group.ballot && <LeanMeter sourceId={source.id} name={source.name} withWord />}
      </div>
      {!group.ballot && (
        <StandingToggle
          name={source.name}
          value={group.standing}
          onChange={(next) => setStanding(source.id, next)}
        />
      )}
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
