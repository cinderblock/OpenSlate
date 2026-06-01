import { verifySlate } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { slatesCollection, upsertKnownIdentity } from "../lib/collections";
import { formatLocalDate } from "../lib/dates";
import {
  type CatalogEntry,
  DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG,
  catalogQueryOptions,
  slateFromUrlOptions,
} from "../lib/query";

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
  const sorted = useMemo(
    () =>
      [...catalog.entries].sort(
        (a, b) =>
          (a.attribution?.of.name ?? a.slug).localeCompare(b.attribution?.of.name ?? b.slug) ||
          a.election.localeCompare(b.election),
      ),
    [catalog.entries],
  );

  if (sorted.length === 0) {
    return <p className="hint">This catalog has no entries yet.</p>;
  }

  return (
    <div className="slates-list">
      <p className="hint">
        {sorted.length} entr{sorted.length === 1 ? "y" : "ies"} &middot; catalog generated{" "}
        {formatLocalDate(catalog.generated_at)}
      </p>
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
  const slateUrl = useMemo(() => new URL(entry.path, catalogUrl).href, [entry.path, catalogUrl]);

  const isImported = alreadyImported || (importedToken !== null && knownTokens.has(importedToken));

  async function handleImport() {
    setImporting(true);
    setError(null);
    try {
      const token = await queryClient.fetchQuery(slateFromUrlOptions(slateUrl));
      const result = verifySlate(token);
      if (!result.valid) {
        throw new Error(result.errors[0] ?? "slate did not verify");
      }
      if (!knownTokens.has(token)) {
        slatesCollection.insert({ token, importedAt: new Date().toISOString() });
        if (result.issuerKey) {
          upsertKnownIdentity(result.issuerKey, {
            displayName: result.payload?.issuer.name,
            source: "from-slate",
          });
        }
      }
      setImportedToken(token);
      onImported();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
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
