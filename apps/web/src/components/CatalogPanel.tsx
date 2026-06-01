import { verifySlate } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { slatesCollection, upsertKnownIdentity } from "../lib/collections";
import { formatLocalDate } from "../lib/dates";
import {
  type CatalogEntry,
  DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG,
  catalogQueryOptions,
  slateFromUrlOptions,
} from "../lib/query";

/**
 * Shared per-entry import. Used by single-row import buttons and the bulk
 * "Import all" path so the two stay in sync. Skips the IndexedDB insert when
 * the token is already known, but still resolves with the token so the caller
 * can flip its row state.
 */
type ImportOutcome =
  | { kind: "imported"; token: string }
  | { kind: "already-imported"; token: string }
  | { kind: "error"; error: string };

async function importCatalogEntry(
  entry: CatalogEntry,
  catalogUrl: string,
  knownTokens: Set<string>,
  queryClient: QueryClient,
): Promise<ImportOutcome> {
  try {
    const slateUrl = new URL(entry.path, catalogUrl).href;
    const token = await queryClient.fetchQuery(slateFromUrlOptions(slateUrl));
    const result = verifySlate(token);
    if (!result.valid) {
      throw new Error(result.errors[0] ?? "slate did not verify");
    }
    if (knownTokens.has(token)) {
      return { kind: "already-imported", token };
    }
    slatesCollection.insert({ token, importedAt: new Date().toISOString() });
    if (result.issuerKey) {
      upsertKnownIdentity(result.issuerKey, {
        displayName: result.payload?.issuer.name,
        source: "from-slate",
      });
    }
    return { kind: "imported", token };
  } catch (err) {
    return { kind: "error", error: err instanceof Error ? err.message : String(err) };
  }
}

export function CatalogPanel() {
  const [catalogUrl, setCatalogUrl] = useState(DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG);
  const [pendingUrl, setPendingUrl] = useState(catalogUrl);
  const {
    data: catalog,
    isLoading,
    error,
    refetch,
    isFetching,
  } = useQuery(catalogQueryOptions(catalogUrl));
  const { data: slates } = useLiveQuery((q) => q.from({ slate: slatesCollection }));

  // Tokens we already have locally are deduped at the entry level by checking
  // the slate URL's hash isn't really doable without fetching; instead, after a
  // successful import we mark the entry imported in a local set so the UI
  // updates immediately without waiting for a re-verify pass.
  const [importedSlugs, setImportedSlugs] = useState<Set<string>>(new Set());

  return (
    <section className="panel">
      <h2>Public endorsements catalog</h2>
      <p className="hint">
        Browse a curated index of publicly-attributed endorsement slates. Every entry here is a{" "}
        <strong>secondhand report</strong> &mdash; signed by the catalog's researcher, not by the
        named organization. Each row imports a self-contained, cryptographically-verifiable slate
        into your local collection.
      </p>

      <div className="card">
        <label>
          Catalog URL
          <input
            type="url"
            value={pendingUrl}
            onChange={(e) => setPendingUrl(e.target.value)}
            placeholder="https://example.org/index.json"
          />
        </label>
        <div className="row">
          <button
            type="button"
            className="primary"
            onClick={() => setCatalogUrl(pendingUrl.trim())}
            disabled={!pendingUrl.trim() || pendingUrl.trim() === catalogUrl}
          >
            Load
          </button>
          <button type="button" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "Refreshing…" : "Refresh"}
          </button>
        </div>
        {isLoading && <p className="hint">Loading catalog…</p>}
        {error && (
          <p className="error">
            Could not load catalog: {error instanceof Error ? error.message : String(error)}
          </p>
        )}
      </div>

      {catalog && (
        <CatalogTable
          catalog={catalog}
          catalogUrl={catalogUrl}
          knownTokens={new Set(slates.map((s) => s.token))}
          importedSlugs={importedSlugs}
          onImported={(key) => setImportedSlugs((prev) => new Set(prev).add(key))}
        />
      )}
    </section>
  );
}

function entryKey(entry: CatalogEntry): string {
  return `${entry.slug}/${entry.election}`;
}

function CatalogTable({
  catalog,
  catalogUrl,
  knownTokens,
  importedSlugs,
  onImported,
}: {
  catalog: { entries: CatalogEntry[]; generated_at: string };
  catalogUrl: string;
  knownTokens: Set<string>;
  importedSlugs: Set<string>;
  onImported: (key: string) => void;
}) {
  const queryClient = useQueryClient();
  const sorted = useMemo(
    () =>
      [...catalog.entries].sort(
        (a, b) =>
          (a.attribution?.of.name ?? a.slug).localeCompare(b.attribution?.of.name ?? b.slug) ||
          a.election.localeCompare(b.election),
      ),
    [catalog.entries],
  );

  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null);
  const [bulkSummary, setBulkSummary] = useState<{
    imported: number;
    alreadyHad: number;
    failed: number;
    errors: string[];
  } | null>(null);

  // Entries we haven't already marked as imported in this session.
  const pending = useMemo(
    () => sorted.filter((entry) => !importedSlugs.has(entryKey(entry))),
    [sorted, importedSlugs],
  );

  async function importAll() {
    setBulkRunning(true);
    setBulkSummary(null);
    setBulkProgress({ done: 0, total: pending.length });
    let imported = 0;
    let alreadyHad = 0;
    let failed = 0;
    const errors: string[] = [];
    for (let i = 0; i < pending.length; i++) {
      const entry = pending[i];
      if (!entry) continue;
      const result = await importCatalogEntry(entry, catalogUrl, knownTokens, queryClient);
      if (result.kind === "imported") {
        imported++;
        onImported(entryKey(entry));
      } else if (result.kind === "already-imported") {
        alreadyHad++;
        onImported(entryKey(entry));
      } else {
        failed++;
        errors.push(
          `${entry.attribution?.of.name ?? entry.slug} (${entry.election}): ${result.error}`,
        );
      }
      setBulkProgress({ done: i + 1, total: pending.length });
    }
    setBulkSummary({ imported, alreadyHad, failed, errors });
    setBulkRunning(false);
  }

  if (sorted.length === 0) {
    return <p className="hint">This catalog has no entries yet.</p>;
  }

  return (
    <div className="slates-list">
      <p className="hint">
        {sorted.length} entr{sorted.length === 1 ? "y" : "ies"} &middot; catalog generated{" "}
        {formatLocalDate(catalog.generated_at)}
      </p>
      <div className="row">
        <button
          type="button"
          className="primary"
          onClick={importAll}
          disabled={bulkRunning || pending.length === 0}
        >
          {bulkRunning
            ? `Importing ${bulkProgress?.done ?? 0}/${bulkProgress?.total ?? 0}…`
            : pending.length === sorted.length
              ? `Import all ${sorted.length}`
              : pending.length === 0
                ? "All imported"
                : `Import remaining ${pending.length}`}
        </button>
        {bulkSummary && (
          <span className="hint">
            {bulkSummary.imported} imported · {bulkSummary.alreadyHad} already had ·{" "}
            <span className={bulkSummary.failed > 0 ? "warning" : ""}>
              {bulkSummary.failed} failed
            </span>
          </span>
        )}
      </div>
      {bulkSummary && bulkSummary.errors.length > 0 && (
        <details>
          <summary className="warning">{bulkSummary.errors.length} import errors</summary>
          <ul className="position-list">
            {bulkSummary.errors.map((msg) => (
              <li key={msg} className="error">
                {msg}
              </li>
            ))}
          </ul>
        </details>
      )}
      <table>
        <thead>
          <tr>
            <th>Organization</th>
            <th>Election / period</th>
            <th>Positions</th>
            <th>Attribution</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((entry) => (
            <CatalogRow
              key={entryKey(entry)}
              entry={entry}
              catalogUrl={catalogUrl}
              alreadyImported={importedSlugs.has(entryKey(entry))}
              knownTokens={knownTokens}
              onImported={() => onImported(entryKey(entry))}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CatalogRow({
  entry,
  catalogUrl,
  alreadyImported,
  knownTokens,
  onImported,
}: {
  entry: CatalogEntry;
  catalogUrl: string;
  alreadyImported: boolean;
  knownTokens: Set<string>;
  onImported: () => void;
}) {
  const queryClient = useQueryClient();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // After import we cache the token so we can flip the row to a stable
  // "imported" state even if the live slates query hasn't refreshed yet.
  const [importedToken, setImportedToken] = useState<string | null>(null);

  const orgName = entry.attribution?.of.name ?? entry.slug;
  const orgUri = entry.attribution?.of.uri;

  const isImported = alreadyImported || (importedToken !== null && knownTokens.has(importedToken));

  async function handleImport() {
    setImporting(true);
    setError(null);
    const result = await importCatalogEntry(entry, catalogUrl, knownTokens, queryClient);
    if (result.kind === "error") {
      setError(result.error);
    } else {
      setImportedToken(result.token);
      onImported();
    }
    setImporting(false);
  }

  return (
    <tr>
      <td>
        {orgUri ? (
          <a href={orgUri} target="_blank" rel="noreferrer">
            {orgName}
          </a>
        ) : (
          orgName
        )}
        <div className="hint" title={entry.issuer.key}>
          via {entry.issuer.name ?? entry.issuer.key.slice(0, 16)}…
        </div>
      </td>
      <td>{entry.election}</td>
      <td>{entry.positions}</td>
      <td>
        {entry.attribution ? (
          <>
            <code>{entry.attribution.mode}</code>
            <div className="hint">retrieved {formatLocalDate(entry.attribution.retrieved_at)}</div>
          </>
        ) : (
          <span className="hint">—</span>
        )}
      </td>
      <td>
        {isImported ? (
          <span className="hint">✓ Imported</span>
        ) : (
          <button type="button" onClick={handleImport} disabled={importing}>
            {importing ? "Importing…" : "Import"}
          </button>
        )}
        {error && <div className="error">{error}</div>}
      </td>
    </tr>
  );
}
