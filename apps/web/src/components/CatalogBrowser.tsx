import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { importCatalogEntry } from "../lib/catalogImport";
import { electionOf } from "../lib/collate";
import { formatElectionDate, formatLocalDate } from "../lib/dates";
import {
  defaultToUnfollowed,
  localToday,
  setFollowed,
  useDecodedSlates,
  useFollows,
} from "../lib/myVote";
import {
  type CatalogEntry,
  DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG,
  catalogQueryOptions,
} from "../lib/query";
import { ELECTION_AUTHORITY, isFollowed, sourceIdOf } from "../lib/sources";
import { track } from "../lib/usage";

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
 * "Follow" imports the entry and puts its organization on My ballot.
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

  async function follow(entry: CatalogEntry) {
    const key = entryKey(entry);
    const sourceId = sourceIdOf(entry);
    if (isImported(entry)) {
      setFollowed(sourceId, true);
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
      setFollowed(sourceId, true);
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
            <label>
              Election
              <select value={activeElection} onChange={(e) => setElection(e.target.value)}>
                {elections.map((e) => (
                  <option key={e} value={e}>
                    {formatElectionDate(e)}
                    {e < today ? " (past)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="grow">
              Search
              <input
                type="search"
                placeholder="organization name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>

          <ul className="catalog-list">
            {rows.map((entry) => {
              const key = entryKey(entry);
              const sourceId = sourceIdOf(entry);
              const has = isImported(entry);
              const ballot = isBallotEntry(entry);
              const following = has && (ballot || isFollowed(follows, sourceId));
              const name = entry.attribution?.of.name ?? entry.slug;
              return (
                <li key={key} className={following ? "following" : ""}>
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
                      <span title={entry.issuer.key}>{entry.issuer.name ?? "a researcher"}</span>
                      {entry.attribution &&
                        ` · ${entry.attribution.mode} ${formatLocalDate(entry.attribution.retrieved_at)}`}
                    </div>
                    {errors[key] && <div className="error">{errors[key]}</div>}
                  </div>
                  {ballot ? (
                    has ? (
                      <span className="hint">✓ Added</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => follow(entry)}
                        disabled={busy.has(key) || bulk !== null}
                        title="Import the official candidate list so every race shows its whole field"
                      >
                        {busy.has(key) ? "Importing…" : "+ Add"}
                      </button>
                    )
                  ) : following ? (
                    <button
                      type="button"
                      className="link"
                      onClick={() => setFollowed(sourceId, false)}
                      title="Stop showing this source on My ballot (keeps it imported)"
                    >
                      ✓ Following
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => follow(entry)}
                      disabled={busy.has(key) || bulk !== null}
                    >
                      {busy.has(key) ? "Importing…" : has ? "Follow" : "+ Follow"}
                    </button>
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
              title="Import without following, to compare on race pages and with “Show sources I don't follow”"
            >
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
          <input
            type="url"
            className="grow"
            value={pendingUrl}
            onChange={(e) => setPendingUrl(e.target.value)}
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
            {isFetching ? "Refreshing…" : "Refresh"}
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
