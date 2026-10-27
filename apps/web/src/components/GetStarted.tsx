import { parseSlate, type SlatePayload } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { useQueries, useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Code, FlaskConical, Lock, MapPin, Pencil, Server } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { isPublicSite } from "../lib/alpha";
import { catalogEntryUrl, startSetupImport } from "../lib/catalogImport";
import {
  basedInArea,
  type EntrySummary,
  isSummarized,
  racesInArea,
  regionsOfSummaries,
  summaryJurisdictions,
  summaryOf,
} from "../lib/catalogSummary";
import { areaOptionsOf } from "../lib/collate";
import { slatesCollection } from "../lib/collections";
import { formatElectionDate } from "../lib/dates";
import { REPO_URL } from "../lib/feedback";
import { httpHref } from "../lib/httpHref";
import { type Area, isAreaSet, jurisdictionLabel, jurisdictionRank } from "../lib/jurisdictions";
import { areaStore, defaultToUnfollowed, localToday, myElectionStore } from "../lib/myVote";
import { useSearchBox } from "../lib/pageSearch";
import { DESKTOP_DOWNLOADS_URL, IS_DESKTOP_APP, THIS_DEVICE } from "../lib/platform";
import {
  CATALOG_BUILT_IN,
  type CatalogEntry,
  catalogEntryLogoUrl,
  catalogQueryOptions,
  DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG,
  isArticlesEntry,
  slateFromUrlOptions,
} from "../lib/query";
import { matchesSearch, searchTextOf } from "../lib/search";
import { type Standing, sourceIdOf } from "../lib/sources";
import { track } from "../lib/usage";
import { AreaPicker, describeArea } from "./AreaPicker";
import { isBallotEntry } from "./CatalogBrowser";
import { EndorserAvatar } from "./EndorserAvatar";
import { electionOptions } from "./electionOptions";
import { LeanSummary } from "./LeanMeter";
import { matchCount, PageSearch } from "./PageSearch";
import { StandingToggle } from "./StandingToggle";
import { Checkbox } from "./ui/Checkbox";
import { ProgressBar } from "./ui/ProgressBar";
import { Select } from "./ui/Select";

const CATALOG_URL = DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG;

/** Catalog entry path → how the user picked it. Not in the map = not picked. */
type Picks = ReadonlyMap<string, Exclude<Standing, "off">>;

type HeadingRef = React.RefObject<HTMLHeadingElement>;

/**
 * Getting set up to vote, right on My ballot: where you vote, then whose
 * endorsements you trust. It's the home page until anything is imported, so a
 * visitor lands in it with no choice to make first; `/?setup=true` brings it
 * back later (Sources links there). Publishing lives elsewhere, on purpose.
 */
export function GetStarted({ again }: { again: boolean }) {
  const navigate = useNavigate();
  const [election, setElection] = useState("");
  const [area, setArea] = useState<Area>(() => areaStore.get());
  const [areaDone, setAreaDone] = useState(false);
  const [selected, setSelected] = useState<Picks>(new Map());
  const [downloadAll, setDownloadAll] = useState(false);
  const areaHeading = useRef<HTMLHeadingElement>(null);
  const sourcesHeading = useRef<HTMLHeadingElement>(null);

  const catalog = useQuery(catalogQueryOptions(CATALOG_URL));
  const { data: imported } = useLiveQuery((q) => q.from({ slate: slatesCollection }));

  const today = localToday();
  const elections = useMemo(
    () => electionsOf(catalog.data?.entries ?? [], today),
    [catalog.data, today],
  );

  // The next upcoming election, as soon as the catalog is in, so anything the
  // area step needs about it starts loading right away.
  useEffect(() => {
    if (!election && elections[0]) setElection(elections[0][0]);
  }, [election, elections]);

  const summaries = useElectionSummaries(catalog.data?.entries, election);

  // Move focus to the card that just opened (or reopened), so keyboard and
  // screen-reader users land on it. Not on the first render: the page's own
  // heading comes first.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    (areaDone ? sourcesHeading : areaHeading).current?.focus();
  }, [areaDone]);

  function confirmArea() {
    areaStore.set(area);
    myElectionStore.set(election);
    setAreaDone(true);
  }

  /**
   * Start downloading the picks: the import carries on in the background,
   * with a banner over the ballot until it's done.
   */
  function followSelected() {
    areaStore.set(area);
    myElectionStore.set(election);
    const entries = summaries.entries.map((s) => s.entry);
    const picked = (entry: CatalogEntry) =>
      selected.has(entry.path) && !isBallotEntry(entry) && !isArticlesEntry(entry);
    // Official candidate lists always come along: they're the ballot itself. So
    // does news coverage of races on it (SPEC §3.15): reference, not a pick.
    const news = new Set(
      summaries.entries
        .filter((s) => isArticlesEntry(s.entry) && racesInArea(s, area) > 0)
        .map((s) => s.entry.path),
    );
    const chosen = downloadAll
      ? entries
      : entries.filter((e) => selected.has(e.path) || isBallotEntry(e) || news.has(e.path));

    if (downloadAll) {
      // The ones you didn't pick come along for comparison, not to trust:
      // sources new to this browser start unfollowed.
      const importedSources = new Set(imported.flatMap((s) => sourceIdOfToken(s.token) ?? []));
      defaultToUnfollowed(
        entries
          .filter((e) => !isBallotEntry(e) && !isArticlesEntry(e) && !picked(e))
          .map(sourceIdOf)
          .filter((id) => !importedSources.has(id)),
      );
    }

    if (catalog.data && chosen.length > 0) {
      void startSetupImport({
        catalog: catalog.data,
        catalogUrl: CATALOG_URL,
        entries: chosen,
        picks: Object.fromEntries(
          chosen.filter(picked).map((e) => [e.path, selected.get(e.path) ?? "follow"]),
        ),
        label: downloadAll ? `Adding all ${chosen.length} lists` : importLabel(chosen, picked),
        bundle: downloadAll,
      });
    }
    track({ name: "setup.finish" });
    window.scrollTo({ top: 0 });
    if (again) void navigate({ to: "/", search: {} });
  }

  return (
    <section className="panel get-started">
      <h2>{again ? "Set up for an election" : "Plan your vote"}</h2>
      <p className="get-started-lead">
        Tell us where you vote and whose endorsements you trust, and see them side by side on your
        own ballot, race by race. No account: everything stays {IS_DESKTOP_APP ? "on" : "in"}{" "}
        {THIS_DEVICE}.
      </p>
      {again ? (
        <p>
          <Link to="/" search={{}}>
            ← Back to my ballot
          </Link>
        </p>
      ) : (
        <AboutOpenSlate />
      )}

      <section className="card setup-step" aria-labelledby="setup-area-heading">
        <h3 id="setup-area-heading" ref={areaHeading} tabIndex={-1}>
          <span className="setup-step-number">1</span> Where do you vote?
        </h3>
        {areaDone ? (
          <p className="setup-step-done">
            <MapPin className="icon" />{" "}
            <span className="grow">
              {isAreaSet(area) ? describeArea(area) : "Every race, anywhere"}
              {election && <span className="hint"> · {formatElectionDate(election)}</span>}
            </span>
            <button type="button" className="link" onClick={() => setAreaDone(false)}>
              <Pencil className="icon" /> Change
            </button>
          </p>
        ) : (
          <AreaStep
            catalogLoading={catalog.isLoading}
            catalogError={catalog.error}
            elections={elections}
            today={today}
            election={election}
            setElection={setElection}
            summaries={summaries}
            area={area}
            setArea={setArea}
            onNext={confirmArea}
          />
        )}
      </section>

      {areaDone && catalog.data && (
        <section className="card setup-step" aria-labelledby="setup-sources-heading">
          <SourcesStep
            headingRef={sourcesHeading}
            summaries={summaries}
            election={election}
            area={area}
            selected={selected}
            setSelected={setSelected}
            downloadAll={downloadAll}
            setDownloadAll={setDownloadAll}
            onNext={followSelected}
          />
        </section>
      )}

      <p className="hint">
        Have endorsements from a friend, or rather browse every source yourself?{" "}
        <Link to="/sources" search={{ add: true }}>
          Add endorsements on the Sources page →
        </Link>
      </p>
    </section>
  );
}

/** What the import bar says it's fetching: your picks, and what comes along with them. */
function importLabel(chosen: CatalogEntry[], picked: (entry: CatalogEntry) => boolean): string {
  const picks = chosen.filter(picked).length;
  const along = [
    chosen.some(isBallotEntry) && "the official ballot lists",
    chosen.some(isArticlesEntry) && "news coverage",
  ].filter((part): part is string => Boolean(part));
  const parts = [
    ...(picks === 0 ? [] : [picks === 1 ? "your pick" : `your ${picks} picks`]),
    ...along,
  ];
  return parts.length > 0 ? `Downloading ${parts.join(" and ")}` : "Downloading";
}

/** The source a stored slate speaks for, or undefined if it doesn't parse. */
function sourceIdOfToken(token: string): string | undefined {
  try {
    return sourceIdOf(parseSlate(token).payload);
  } catch {
    return undefined;
  }
}

/** A step's buttons. `sticky`: kept in view under a long list, so going on is one click away. */
function StepActions({ sticky, children }: { sticky?: boolean; children: React.ReactNode }) {
  return <div className={`setup-actions${sticky ? " sticky" : ""}`}>{children}</div>;
}

/** "What is this, and do I have to use this website?", folded away under the lead. */
function AboutOpenSlate() {
  return (
    <details className="setup-about">
      <summary>What is OpenSlate?</summary>
      <p>
        A free tool for lining up the endorsements you trust on your ballot, and for sharing
        endorsements anyone can check. Every endorsement is signed, so you can see who issued it and
        that nobody changed it along the way.
      </p>
      <ul>
        {!isPublicSite() && (
          <li>
            <FlaskConical className="icon" />
            <span>
              <strong>Alpha.</strong> Written by AI with a human watching over it, so things might
              be wrong, change, or break. Check what matters, and help fix what isn't right.
            </span>
          </li>
        )}
        <li>
          <Lock className="icon" />
          <span>
            <strong>No account.</strong> Your picks, notes and signing keys stay{" "}
            {IS_DESKTOP_APP ? "on" : "in"} {THIS_DEVICE}. They're never sent to us, and reach others
            only when you share them.
          </span>
        </li>
        <li>
          <Code className="icon" />
          <span>
            <strong>Open source.</strong> Every line is public on GitHub under the MIT license: read
            it, check it, or help build it.
          </span>
        </li>
        <li>
          <Server className="icon" />
          {IS_DESKTOP_APP ? (
            <span>
              <strong>Runs on your computer.</strong>{" "}
              {CATALOG_BUILT_IN
                ? "This edition carries a copy of the public endorsements and voter guides, so planning your ballot works with no internet. "
                : ""}
              Polls, forecasts and results still need a connection.
            </span>
          ) : (
            <span>
              <strong>Don't want to use this website?</strong> Run OpenSlate on your own computer:
              the desktop app for Windows, macOS and Linux comes with or without a built-in copy of
              the endorsements, for planning your ballot offline. Or host the app's plain files on
              any web server.
            </span>
          )}
        </li>
      </ul>
      <p className="setup-about-links">
        <a href={REPO_URL} target="_blank" rel="noreferrer">
          Source code on GitHub
        </a>
        {" · "}
        {IS_DESKTOP_APP ? (
          <a href={DESKTOP_DOWNLOADS_URL} target="_blank" rel="noreferrer">
            Newer versions
          </a>
        ) : (
          <>
            <a href={DESKTOP_DOWNLOADS_URL} target="_blank" rel="noreferrer">
              Download the desktop app
            </a>
            {" · "}
            <a href={`${REPO_URL}#how-to-run`} target="_blank" rel="noreferrer">
              How to run your own
            </a>
          </>
        )}
      </p>
    </details>
  );
}

/**
 * The catalog's elections with how many organizations publish for each (a
 * ballot list keeps an election on the menu without counting as one).
 * Upcoming first (soonest first), then past (latest first).
 */
function electionsOf(entries: CatalogEntry[], today: string): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    counts.set(entry.election, (counts.get(entry.election) ?? 0) + (isBallotEntry(entry) ? 0 : 1));
  }
  return [...counts.entries()].sort(([a], [b]) => {
    const ap = a < today;
    const bp = b < today;
    return ap !== bp ? Number(ap) - Number(bp) : ap ? b.localeCompare(a) : a.localeCompare(b);
  });
}

/** Each of the election's catalog entries, summarized; `done` of `total` slates read so far. */
interface ElectionSummaries {
  entries: EntrySummary[];
  /** Slates read so far, for entries the catalog doesn't summarize. */
  done: number;
  total: number;
}

/**
 * Where each of the election's organizations has races, for both steps. A
 * current catalog says so per entry, so this is immediate and downloads
 * nothing. For an older catalog's entries it fetches the slates, and reads them
 * without checking signatures: it's only a preview, and the import checks
 * every slate it keeps.
 */
function useElectionSummaries(
  entries: CatalogEntry[] | undefined,
  election: string,
): ElectionSummaries {
  const forElection = useMemo(
    () => (entries ?? []).filter((e) => e.election === election),
    [entries, election],
  );
  const unsummarized = useMemo(() => forElection.filter((e) => !isSummarized(e)), [forElection]);
  const results = useQueries({
    queries: unsummarized.map((entry) => ({
      ...slateFromUrlOptions(catalogEntryUrl(entry, CATALOG_URL)),
      staleTime: 1000 * 60 * 5,
    })),
  });
  // Each slate is read once, however many times the list re-renders as the
  // rest arrive.
  const payloads = useRef(new Map<string, SlatePayload | undefined>());
  const tokens = results.map((r) => r.data);
  // useQueries returns new objects every render; key the memo on what matters.
  const resultKey = results.map((r) => `${r.status}:${r.data ?? ""}`).join("\n");
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on result contents
  return useMemo<ElectionSummaries>(() => {
    const tokenOf = new Map(unsummarized.map((entry, i) => [entry.path, tokens[i]]));
    const payloadOf = (token: string) => {
      if (!payloads.current.has(token)) {
        let payload: SlatePayload | undefined;
        try {
          payload = parseSlate(token).payload;
        } catch {
          payload = undefined;
        }
        payloads.current.set(token, payload);
      }
      return payloads.current.get(token);
    };
    return {
      entries: forElection.map((entry) => {
        const token = tokenOf.get(entry.path);
        return summaryOf(entry, token ? payloadOf(token) : undefined);
      }),
      done: results.filter((r) => r.status !== "pending").length,
      total: unsummarized.length,
    };
  }, [forElection, unsummarized, resultKey]);
}

/**
 * Shown while an older catalog's slates load: a bar, and a firm word against
 * moving on, since without them nobody can be matched to your ballot.
 */
function SummariesWait({ summaries }: { summaries: ElectionSummaries }) {
  if (summaries.done >= summaries.total) return null;
  return (
    <div className="setup-wait">
      <ProgressBar label="Loading endorsements" value={summaries.done} maxValue={summaries.total} />
      <p>
        <strong>Please wait for this to finish.</strong> This catalog doesn't say where each
        organization's endorsements are, so we read them all to match them to your ballot.
      </p>
    </div>
  );
}

function AreaStep({
  catalogLoading,
  catalogError,
  elections,
  today,
  election,
  setElection,
  summaries,
  area,
  setArea,
  onNext,
}: {
  catalogLoading: boolean;
  catalogError: Error | null;
  elections: Array<[string, number]>;
  today: string;
  election: string;
  setElection: (next: string) => void;
  summaries: ElectionSummaries;
  area: Area;
  setArea: (next: Area) => void;
  onNext: () => void;
}) {
  const options = useMemo(
    () => areaOptionsOf(summaryJurisdictions(summaries.entries)),
    [summaries],
  );

  if (catalogLoading) return <ProgressBar label="Loading the public catalog" value={0} />;
  if (catalogError) {
    return (
      <>
        <p className="error">Couldn't load the public catalog: {catalogError.message}</p>
        <p>
          You can still add endorsements yourself: paste one a friend sent, or load one from a link.
        </p>
        <StepActions>
          <Link to="/sources" search={{ add: true }} className="button-link primary">
            Add endorsements myself
          </Link>
        </StepActions>
      </>
    );
  }

  const loading = summaries.done < summaries.total;

  return (
    <>
      <p>
        This trims a statewide list to the races on your ballot. It stays{" "}
        {IS_DESKTOP_APP ? "on" : "in"} {THIS_DEVICE}, and you can change it any time.
      </p>
      {/* The next upcoming election is picked already; a choice only when there is one. */}
      {elections.length > 1 && (
        <Select
          className="setup-election"
          label="Election"
          value={election}
          onChange={setElection}
          options={electionOptions(
            elections.map(([date]) => ({ date })),
            today,
          ).map((option, i) => ({
            ...option,
            badge: `${elections[i]?.[1] ?? 0} organizations`,
          }))}
        />
      )}
      {loading ? (
        <SummariesWait summaries={summaries} />
      ) : (
        <AreaPicker options={options} area={area} election={election} onChange={setArea} />
      )}
      <StepActions>
        <span className="grow" />
        {/* Picking an area is the way through; showing everything stays a quiet
            way out, and only once there's a picker to pass up. */}
        {!loading && !isAreaSet(area) && (
          <button type="button" className="hollow" onClick={onNext}>
            Show every race instead
          </button>
        )}
        <button
          type="button"
          className="primary"
          onClick={onNext}
          disabled={loading || !isAreaSet(area)}
        >
          Next →
        </button>
      </StepActions>
    </>
  );
}

function SourcesStep({
  headingRef,
  summaries,
  election,
  area,
  selected,
  setSelected,
  downloadAll,
  setDownloadAll,
  onNext,
}: {
  headingRef: HeadingRef;
  summaries: ElectionSummaries;
  election: string;
  area: Area;
  selected: Picks;
  setSelected: (next: Picks) => void;
  downloadAll: boolean;
  setDownloadAll: (next: boolean) => void;
  onNext: () => void;
}) {
  const [showOthers, setShowOthers] = useState(false);
  const search = useSearchBox();

  // Each organization with how many races on *your* ballot it weighs in on,
  // grouped by where it publishes for (statewide, a city…).
  const ballots = summaries.entries.filter((s) => isBallotEntry(s.entry));
  const organizations = summaries.entries.filter(
    (s) => !isBallotEntry(s.entry) && !isArticlesEntry(s.entry),
  ).length;
  const { groups, others } = useMemo(() => {
    const scored = summaries.entries
      .filter((s) => !isBallotEntry(s.entry) && !isArticlesEntry(s.entry))
      .map((s) => ({
        entry: s.entry,
        races: racesInArea(s, area),
        scope: s.scope,
        // Found by its name, its site, and where it publishes for.
        searchText: searchTextOf([
          s.entry.attribution?.of.name ?? s.entry.slug,
          s.entry.attribution?.of.uri,
          jurisdictionLabel(s.scope),
        ]),
      }));
    // A group that publishes for another city still weighs in on statewide
    // races, but it isn't "yours": list it under "based elsewhere". One based
    // in a region is yours when the region's contests are voted where you are.
    const regions = regionsOfSummaries(summaries.entries);
    const elsewhere = (s: (typeof scored)[number]) =>
      isAreaSet(area) && (s.races === 0 || !basedInArea(s.scope, area, regions));
    const relevant = scored.filter((s) => !elsewhere(s));
    const byScope = new Map<string, typeof scored>();
    for (const s of relevant) {
      const label = jurisdictionLabel(s.scope);
      byScope.set(label, [...(byScope.get(label) ?? []), s]);
    }
    return {
      groups: [...byScope.entries()]
        .map(([label, items]) => ({
          label,
          rank: jurisdictionRank(items[0]?.scope),
          items: items.sort(
            (a, b) =>
              b.races - a.races ||
              (a.entry.attribution?.of.name ?? "").localeCompare(
                b.entry.attribution?.of.name ?? "",
              ),
          ),
        }))
        .sort((a, b) => a.rank - b.rank || b.items.length - a.items.length),
      others: scored.filter(elsewhere).sort((a, b) => b.races - a.races),
    };
  }, [summaries, area]);

  // The search narrows each group; groups with nothing left go, and the
  // "based elsewhere" ones show without a click.
  const matches = (item: { searchText: string }) => matchesSearch(item.searchText, search.terms);
  const shownGroups = search.searching
    ? groups
        .map((group) => ({ ...group, items: group.items.filter(matches) }))
        .filter((group) => group.items.length > 0)
    : groups;
  const shownOthers = search.searching ? others.filter(matches) : others;
  const shownCount = shownGroups.reduce((n, g) => n + g.items.length, 0) + shownOthers.length;

  function pick(path: string, standing: Standing) {
    const next = new Map(selected);
    if (standing === "off") next.delete(path);
    else next.set(path, standing);
    setSelected(next);
  }

  const following = [...selected.values()].filter((s) => s === "follow").length;
  const disagreeing = selected.size - following;
  const followLabel = [
    following > 0 ? `follow ${following}` : "",
    disagreeing > 0 ? `disagree with ${disagreeing}` : "",
  ]
    .filter(Boolean)
    .join(", ");

  function renderItem(item: { entry: CatalogEntry; races: number }) {
    const { entry } = item;
    const standing = selected.get(entry.path) ?? "off";
    const name = entry.attribution?.of.name ?? entry.slug;
    return (
      <div key={entry.path} className={`setup-source standing-${standing}`}>
        <EndorserAvatar
          sourceId={sourceIdOf(entry)}
          name={name}
          size="md"
          logo={catalogEntryLogoUrl(entry, CATALOG_URL)}
          logoBackground={entry.logo_background}
        />
        <span className="grow">
          <strong>{name}</strong>
          {httpHref(entry.attribution?.of.uri) && (
            <>
              {" "}
              <a href={httpHref(entry.attribution?.of.uri)} target="_blank" rel="noreferrer">
                site
              </a>
            </>
          )}
        </span>
        <span className="hint setup-source-meta">
          {item.races} race{item.races === 1 ? "" : "s"}
          {isAreaSet(area) ? " on your ballot" : ""}
          {entry.lean && (
            <LeanSummary sourceId={sourceIdOf(entry)} lean={{ ...entry.lean, via: "catalog" }} />
          )}
        </span>
        <StandingToggle name={name} value={standing} onChange={(next) => pick(entry.path, next)} />
      </div>
    );
  }

  return (
    <>
      <h3 id="setup-sources-heading" ref={headingRef} tabIndex={-1}>
        <span className="setup-step-number">2</span> Whose endorsements do you trust?
      </h3>
      <p>
        Follow a few for {formatElectionDate(election)}: a party, a newspaper, groups that share
        your values. Mark ones you disagree with too: what they back counts against it on your
        ballot, and what they oppose counts for it. You can change this later on the Sources page.
      </p>
      <SummariesWait summaries={summaries} />
      {organizations > 0 && (
        <PageSearch
          search={search}
          label="Search organizations"
          placeholder="Search organizations by name, site or place…"
        >
          {matchCount(shownCount, organizations, "organizations", search.query)}
        </PageSearch>
      )}
      <div className="setup-sources">
        {shownGroups.map((group) => (
          <fieldset key={group.label} className="setup-group">
            <legend>{group.label}</legend>
            {group.items.map(renderItem)}
          </fieldset>
        ))}
        {shownOthers.length > 0 &&
          (search.searching ? (
            <fieldset className="setup-group">
              <legend>Based elsewhere</legend>
              {shownOthers.map(renderItem)}
            </fieldset>
          ) : (
            <fieldset className="setup-group">
              <legend>
                <button type="button" className="link" onClick={() => setShowOthers((v) => !v)}>
                  {showOthers ? "▾" : "▸"} {others.length} more based elsewhere
                </button>
              </legend>
              {showOthers && others.map(renderItem)}
            </fieldset>
          ))}
      </div>
      <p className="hint">
        These are secondhand reports: a researcher's signed record of what each organization
        published.
        {ballots.length > 0 && (
          <>
            {" "}
            The official candidate list from{" "}
            {ballots.map((s) => s.entry.attribution?.of.name ?? s.entry.slug).join(" and ")} is
            included, so every race shows its whole field.
          </>
        )}
      </p>
      {organizations > 0 && (
        <Checkbox className="setup-download-all" isSelected={downloadAll} onChange={setDownloadAll}>
          <span>
            <strong>Download all {organizations} organizations' lists, not just my picks</strong>
            <span className="hint ui-option-note">
              More private: the server can't tell whose recommendations you use. The ones you didn't
              pick are kept for comparison, not followed. It's a bigger download.
            </span>
          </span>
        </Checkbox>
      )}
      <StepActions sticky>
        <span className="grow" />
        {/* Following someone is the way through; going on without is the quiet
            way out, and only when there's still something to download. */}
        {selected.size === 0 && (ballots.length > 0 || downloadAll) && (
          <button type="button" className="hollow" onClick={onNext}>
            {downloadAll ? "Download without following" : "See the ballot without following anyone"}
          </button>
        )}
        <button type="button" className="primary" onClick={onNext} disabled={selected.size === 0}>
          {selected.size === 0
            ? "Follow and see my ballot →"
            : `${followLabel.charAt(0).toUpperCase()}${followLabel.slice(1)} and see my ballot →`}
        </button>
      </StepActions>
    </>
  );
}
