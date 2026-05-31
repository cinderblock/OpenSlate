import { verifySlate } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import Fuse from "fuse.js";
import { useMemo, useState } from "react";
import { slatesCollection } from "../lib/collections";
import { shortKey, useKnownIdentities } from "../lib/identities";

interface SlateRow {
  token: string;
  importedAt: string;
  issuerKey: string;
  /** Self-asserted name from the slate. */
  issuerName: string;
  /** Local nickname (if set in Identity tab); takes precedence over issuerName. */
  nickname: string;
  /** Resolved display: nickname || issuerName || shortKey(issuerKey). */
  displayName: string;
  election: string;
  positions: number;
  valid: boolean;
}

type SortKey = "displayName" | "election" | "positions" | "importedAt" | "valid";

export function SlatesList() {
  const { data: slates } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  const knownContacts = useKnownIdentities();
  const contactNames = useMemo(
    () => new Map(knownContacts.map((c) => [c.publicKey, c.displayName ?? ""])),
    [knownContacts],
  );

  const rows = useMemo<SlateRow[]>(() => {
    return slates.map((slate) => {
      const result = verifySlate(slate.token);
      const issuerKey = result.issuerKey ?? "";
      const issuerName = result.payload?.issuer.name ?? "";
      const nickname = contactNames.get(issuerKey) ?? "";
      return {
        token: slate.token,
        importedAt: slate.importedAt,
        issuerKey,
        issuerName,
        nickname,
        displayName: nickname || issuerName || shortKey(issuerKey),
        election: result.payload?.context?.election ?? "",
        positions: result.payload?.positions.length ?? 0,
        valid: result.valid,
      };
    });
  }, [slates, contactNames]);

  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("importedAt");
  const [sortAsc, setSortAsc] = useState(false);

  const fuse = useMemo(
    () =>
      new Fuse(rows, {
        keys: ["nickname", "issuerName", "issuerKey", "election"],
        threshold: 0.3,
        ignoreLocation: true,
      }),
    [rows],
  );

  const filtered = useMemo(() => {
    const base = query.trim() ? fuse.search(query).map((r) => r.item) : rows;
    const dir = sortAsc ? 1 : -1;
    return [...base].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      if (typeof av === "boolean" && typeof bv === "boolean") {
        return (Number(av) - Number(bv)) * dir;
      }
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
  }, [query, rows, fuse, sortKey, sortAsc]);

  if (rows.length === 0) {
    return (
      <p className="hint">No slates imported yet. Use the Import &amp; verify tab to add some.</p>
    );
  }

  return (
    <div className="slates-list">
      <div className="row">
        <input
          type="search"
          className="grow"
          placeholder={`search ${rows.length} slate(s) by issuer name, key, or election…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button type="button" className="link" onClick={() => setQuery("")}>
            clear
          </button>
        )}
      </div>
      <table>
        <thead>
          <tr>
            <SortHeader column="displayName" sortKey={sortKey} sortAsc={sortAsc} onToggle={setSort}>
              Issuer
            </SortHeader>
            <SortHeader column="election" sortKey={sortKey} sortAsc={sortAsc} onToggle={setSort}>
              Election
            </SortHeader>
            <SortHeader column="positions" sortKey={sortKey} sortAsc={sortAsc} onToggle={setSort}>
              Positions
            </SortHeader>
            <SortHeader column="importedAt" sortKey={sortKey} sortAsc={sortAsc} onToggle={setSort}>
              Imported
            </SortHeader>
            <SortHeader column="valid" sortKey={sortKey} sortAsc={sortAsc} onToggle={setSort}>
              Valid
            </SortHeader>
          </tr>
        </thead>
        <tbody>
          {filtered.map((row) => (
            <tr key={row.token}>
              <td>
                <div title={row.issuerKey}>
                  {row.displayName}
                  {row.nickname && row.issuerName && row.nickname !== row.issuerName && (
                    <span className="hint"> ({row.issuerName})</span>
                  )}
                </div>
              </td>
              <td>{row.election || <span className="hint">—</span>}</td>
              <td>{row.positions}</td>
              <td>{row.importedAt.slice(0, 10)}</td>
              <td>{row.valid ? "✓" : "✗"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  function setSort(column: SortKey) {
    if (sortKey === column) setSortAsc((v) => !v);
    else {
      setSortKey(column);
      setSortAsc(true);
    }
  }
}

function SortHeader({
  column,
  sortKey,
  sortAsc,
  onToggle,
  children,
}: {
  column: SortKey;
  sortKey: SortKey;
  sortAsc: boolean;
  onToggle: (col: SortKey) => void;
  children: React.ReactNode;
}) {
  const active = sortKey === column;
  return (
    <th
      className={`sortable${active ? " active" : ""}`}
      aria-sort={active ? (sortAsc ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        className="th-sort"
        onClick={() => onToggle(column)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle(column);
          }
        }}
      >
        {children}
        {active && (sortAsc ? " ▲" : " ▼")}
      </button>
    </th>
  );
}
