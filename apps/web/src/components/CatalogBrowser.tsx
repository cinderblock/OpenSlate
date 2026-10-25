import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Download, Plus, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { type BallotProblem, ballotProblems, problemReport } from "../lib/ballotCheck";
import { importCatalogEntry } from "../lib/catalogImport";
import { electionOf } from "../lib/collate";
import { formatLocalDate } from "../lib/dates";
import { reportFeedback } from "../lib/feedback";
import {
  defaultToUnfollowed,
  localToday,
  setStanding,
  useDecodedSlates,
  useFollows,
} from "../lib/myVote";
import {
  type CatalogEntry,
  DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG,
  catalogEntryLogoUrl,
  catalogQueryOptions,
} from "../lib/query";
import { ELECTION_AUTHORITY, type Standing, sourceIdOf, standingOf } from "../lib/sources";
import { track } from "../lib/usage";
import { EndorserAvatar } from "./EndorserAvatar";
import { LeanMeter } from "./LeanMeter";
import { StandingToggle } from "./StandingToggle";
import { electionOptions } from "./electionOptions";
import { Select } from "./ui/Select";
import { SearchField, UrlField } from "./ui/TextField";

function entryKey(entry: CatalogEntry): string {
  return `${entry.slug}/${entry.election}`;
}

/** An official candidate list: imported like a slate, but not something to follow. */
export function isBallotEntry(entry: CatalogEntry): boolean {
  return entry.attribution?.of.kind === ELECTION_AUTHORITY;
}

/**
 * A curated index of publicly-attributed slates. Every entry is a secondhand
 * report signed by the catalog's researcher, not by the named organization.
 * "Follow" or "Disagree" imports the entry and puts its organization on My
 * ballot, counted for or against what it backs.
 */
export function CatalogBrowser() {
  const queryClient = useQueryClient();
  const [catalogUrl, setCatalogUrl] = useState(DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG);
  const [pendingUrl, setPendingUrl] = useState(catalogUrl);
  const {
    data: catalog,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery(catalogQueryOptions(catalogUrl));
  const { slates } = useDecodedSlates();
  const [follows] = useFollows();

  const [election, setElection] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);

  // `<source id>|<election>` for every imported slate, to mark catalog rows.
  const imported = useMemo(() => {
    const set = new Set<string>();
    for (const slate of slates) {
      const elections = new Set(
        slate.payload.positions.map((p) => electionOf(p.subject, slate.payload)),
      );
      for (const e of elections) set.add(`${slate.source.id}|${e ?? ""}`);
    }
    return set;
  }, [slates]);
  const knownTokens = useMemo(() => new Set(slates.map((s) => s.token)), [slates]);

  // `<source id>|<election>` → what its endorsements name that the ballot
  // listing doesn't have: likely an import that didn't go cleanly.
  const offBallot = useMemo(() => {
    const by = new Map<string, BallotProblem[]>();
    for (const problem of ballotProblems(slates)) {
      if (problem.kind === "write-in") continue;
      const key = `${problem.sourceId}|${problem.election ?? ""}`;
      by.set(key, [...(by.get(key) ?? []), problem]);
    }
    return by;
  }, [slates]);

  const elections = useMemo(
    () => [...new Set(catalog?.entries.map((e) => e.election))].sort(),
    [catalog],
  );
  const today = localToday();
  const activeElection = election ?? elections.find((e) => e >= today) ?? elections.at(-1) ?? "";

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (catalog?.entries ?? [])
      .filter((entry) => !activeElection || entry.election === activeElection)
      .filter((entry) => !q || (entry.attribution?.of.name ?? entry.slug).toLowerCase().includes(q))
      .sort(
        (a, b) =>
          // Ballot lists first: they're the frame the endorsements hang on.
          Number(isBallotEntry(b)) - Number(isBallotEntry(a)) ||
          (a.attribution?.of.name ?? a.slug).localeCompare(b.attribution?.of.name ?? b.slug),
      );
  }, [catalog, activeElection, search]);

  function isImported(entry: CatalogEntry): boolean {
    return imported.has(`${sourceIdOf(entry)}|${entry.election}`);
  }

  async function follow(entry: CatalogEntry, standing: Standing = "follow") {
    const key = entryKey(entry);
    const sourceId = sourceIdOf(entry);
    if (isImported(entry)) {
      setStanding(sourceId, standing);
      return;
    }
    setBusy((prev) => new Set(prev).add(key));
    const result = await importCatalogEntry(entry, catalogUrl, knownTokens, queryClient);
    setBusy((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
    if (result.kind === "error") {
      setErrors((prev) => ({ ...prev, [key]: result.error }));
    } else if (!isBallotEntry(entry)) {
      setStanding(sourceId, standing);
    }
  }

  /** Import every shown entry without following the ones you haven't chosen. */
  async function importAll() {
    track({ name: "catalog.import_all" });
    const pending = rows.filter((entry) => !isImported(entry));
    const alreadyImported = new Set(slates.map((s) => s.source.id));
    // Sources new to this browser start unfollowed: comparing isn't trusting.
    defaultToUnfollowed(
      pending
        .filter((entry) => !isBallotEntry(entry))
        .map(sourceIdOf)
        .filter((id) => !alreadyImported.has(id) && !(id in follows)),
    );
    setBulkSummary(null);
    setBulk({ done: 0, total: pending.length });
    let failed = 0;
    for (const [i, entry] of pending.entries()) {
      const result = await importCatalogEntry(entry, catalogUrl, knownTokens, queryClient);
      if (result.kind === "error") {
        failed++;
        setErrors((prev) => ({ ...prev, [entryKey(entry)]: result.error }));
      }
      setBulk({ done: i + 1, total: pending.length });
    }
    setBulk(null);
    setBulkSummary(
      `Imported ${pending.length - failed} for comparison${failed ? `, ${failed} failed` : ""}. Follow the ones you trust.`,
    );
  }

  const pendingCount = rows.filter((entry) => !isImported(entry)).length;

  return (
    <div className="catalog-browser">
      <p className="hint">
        Each entry is a <strong>secondhand report</strong>: a researcher's signed record of what the
        organization published, not a slate the organization signed itself. The source page is
        linked from each one.
      </p>

      {isLoading && <p className="hint">Loading catalog…</p>}
      {error && (
        <p className="error">
          Could not load catalog: {error instanceof Error ? error.message : String(error)}
        </p>
      )}

      {catalog && (
        <>
          <div className="row">
            <Select
              label="Election"
              value={activeElection}
              onChange={setElection}
              options={electionOptions(
                elections.map((date) => ({ date })),
                today,
              )}
            />
            <SearchField
              className="grow"
              label="Search"
              placeholder="organization name…"
              value={search}
              onChange={setSearch}
            />
          </div>

          <ul className="catalog-list">
            {rows.map((entry) => {
              const key = entryKey(entry);
              const sourceId = sourceIdOf(entry);
              const has = isImported(entry);
              const ballot = isBallotEntry(entry);
              const standing: Standing = has ? standingOf(follows, sourceId) : "off";
              const name = entry.attribution?.of.name ?? entry.slug;
              const rowClass =
                has && (ballot || standing === "follow")
                  ? "following"
                  : standing === "disagree"
                    ? "disagreeing"
                    : "";
              return (
                <li key={key} className={rowClass}>
                  <EndorserAvatar
                    sourceId={sourceId}
                    name={name}
                    size="md"
                    logo={catalogEntryLogoUrl(entry, catalogUrl)}
                  />
                  <div className="grow">
                    {entry.attribution?.of.uri ? (
                      <a href={entry.attribution.of.uri} target="_blank" rel="noreferrer">
                        {name}
                      </a>
                    ) : (
                      name
                    )}
                    {ballot && <span className="tag tag-inline">official candidate list</span>}
                    <div className="hint">
                      {entry.positions} {ballot ? "candidates" : "positions"} · reported by{" "}
                      {entry.issuer.name ?? "a researcher"}
                      {entry.attribution &&
                        ` · ${entry.attribution.mode} ${formatLocalDate(entry.attribution.retrieved_at)}`}
                    </div>
                    {!ballot && entry.lean && (
                      <LeanMeter
                        sourceId={sourceId}
                        name={name}
                        lean={{ ...entry.lean, via: "catalog" }}
                        withWord
                      />
                    )}
                    {errors[key] && <div className="error">{errors[key]}</div>}
                    {has && (
                      <OffBallotLine problems={offBallot.get(`${sourceId}|${entry.election}`)} />
                    )}
                  </div>
                  {ballot ? (
                    has ? (
                      <span className="hint">
                        <Check className="icon" /> Added
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => follow(entry)}
                        disabled={busy.has(key) || bulk !== null}
                      >
                        {busy.has(key) ? (
                          "Importing…"
                        ) : (
                          <>
                            <Plus className="icon" /> Add
                          </>
                        )}
                      </button>
                    )
                  ) : busy.has(key) ? (
                    <span className="hint">Importing…</span>
                  ) : (
                    // Releasing both keeps the slate imported, just off My ballot.
                    <StandingToggle
                      name={name}
                      value={standing}
                      isDisabled={bulk !== null}
                      onChange={(next) =>
                        next === "off" ? setStanding(sourceId, "off") : follow(entry, next)
                      }
                    />
                  )}
                </li>
              );
            })}
          </ul>
          {rows.length === 0 && <p className="hint">No entries match.</p>}

          <div className="row">
            <button
              type="button"
              onClick={importAll}
              disabled={bulk !== null || pendingCount === 0}
            >
              <Download className="icon" />{" "}
              {bulk
                ? `Importing ${bulk.done}/${bulk.total}…`
                : pendingCount === 0
                  ? "All shown are imported"
                  : `Import the other ${pendingCount} to compare`}
            </button>
            {bulkSummary && <span className="hint">{bulkSummary}</span>}
          </div>
        </>
      )}

      <details>
        <summary>Use a different catalog</summary>
        <div className="row">
          <UrlField
            className="grow"
            aria-label="Catalog URL"
            value={pendingUrl}
            onChange={setPendingUrl}
            placeholder="https://example.org/index.json"
          />
          <button
            type="button"
            onClick={() => {
              setCatalogUrl(pendingUrl.trim());
              setElection(null);
            }}
            disabled={!pendingUrl.trim() || pendingUrl.trim() === catalogUrl}
          >
            Load
          </button>
          <button type="button" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className="icon" /> {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {catalog && (
          <p className="hint">
            {catalog.entries.length} entries · generated {formatLocalDate(catalog.generated_at)}
          </p>
        )}
      </details>
    </div>
  );
}

/** Under an imported entry: the names it gives that aren't on the ballot. */
function OffBallotLine({ problems }: { problems: BallotProblem[] | undefined }) {
  if (!problems?.length) return null;
  return (
    <div className="warning">
      {problems.length === 1 ? "1 name" : `${problems.length} names`} here{" "}
      {problems.length === 1 ? "isn't" : "aren't"} on the official ballot list, so{" "}
      {problems.length === 1 ? "it" : "they"} may not have imported cleanly.{" "}
      <button
        type="button"
        className="link"
        onClick={() => reportFeedback("wrong-info", problemReport(problems))}
      >
        Report {problems.length === 1 ? "it" : "them"}
      </button>
    </div>
  );
}
