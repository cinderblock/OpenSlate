import { useLiveQuery } from "@tanstack/react-db";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Download, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  type Backup,
  backupFileName,
  clearCaches,
  createBackup,
  KEY_GROUP_LABEL,
  type KeyGroup,
  type LocalEntry,
  parseBackup,
  readLocalEntries,
  resetEverything,
  restoreBackup,
  storageEstimate,
  summarizeBackup,
} from "../lib/browserData";
import { type DecodedSlate, electionOf } from "../lib/collate";
import { publishedCollection } from "../lib/collections";
import { formatElectionDate, formatLocalDate } from "../lib/dates";
import { downloadText } from "../lib/download";
import { useKnownIdentities, useMyIdentities } from "../lib/identities";
import { removeLocalKey } from "../lib/localStore";
import { localToday, removeSlates, useDecodedSlates } from "../lib/myVote";
import { Checkbox } from "./ui/Checkbox";
import { FileDrop } from "./ui/FileDrop";
import { Segmented } from "./ui/Segmented";

/**
 * Settings → Your data: everything OpenSlate keeps in this browser, and the
 * ways to clean it up, back it up, restore it and start over
 * (plans/browser-data-manager.md).
 */
export function BrowserDataPage() {
  // Bumped after a change the live stores don't announce (a raw key removal).
  const [revision, setRevision] = useState(0);
  const refresh = () => setRevision((n) => n + 1);

  return (
    <div className="browser-data">
      <p className="no-print">
        <Link to="/settings">
          <ArrowLeft className="icon" /> Settings
        </Link>
      </p>
      <h1>Your data</h1>
      <p className="hint">
        Everything OpenSlate knows about you lives in this browser, on this device. There's no
        account and no server keeping a copy, so this is the one place to see it, take it with you,
        or clear it out.
      </p>
      <StorageUse revision={revision} />
      <div className="card-columns">
        <div>
          <SlatesSection />
          <BackupSection />
        </div>
        <div>
          <AccountsSection />
          <SettingsSection revision={revision} onChange={refresh} />
          <ResetSection />
        </div>
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

function StorageUse({ revision }: { revision: number }) {
  const [usage, setUsage] = useState<number | undefined>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure after each change.
  useEffect(() => {
    let live = true;
    void storageEstimate().then((estimate) => {
      if (live) setUsage(estimate.usage);
    });
    return () => {
      live = false;
    };
  }, [revision]);
  if (usage === undefined) return null;
  return (
    <p className="hint">
      This site uses about {formatBytes(usage)} of this browser's storage, counting the app's own
      files kept for offline use.
    </p>
  );
}

// --- Imported slates ---

interface SlateRow {
  slate: DecodedSlate;
  elections: string[];
  /** Signed without a name and not reported for anyone: shown by its key. */
  unnamed: boolean;
  past: boolean;
}

interface SlateGroup {
  id: string;
  name: string;
  rows: SlateRow[];
}

function slateElections(slate: DecodedSlate): string[] {
  const dates = new Set<string>();
  for (const position of slate.payload.positions) {
    const date = electionOf(position.subject, slate.payload);
    if (date) dates.add(date.slice(0, 10));
  }
  if (dates.size === 0 && slate.payload.context?.election) {
    dates.add(slate.payload.context.election.slice(0, 10));
  }
  return [...dates].sort();
}

function groupSlates(slates: DecodedSlate[], today: string): SlateGroup[] {
  const groups = new Map<string, SlateGroup>();
  for (const slate of slates) {
    const elections = slateElections(slate);
    const row: SlateRow = {
      slate,
      elections,
      unnamed: !slate.payload.issuer.name?.trim() && !slate.payload.attribution,
      past: elections.length > 0 && elections.every((date) => date < today),
    };
    const group = groups.get(slate.source.id) ?? {
      id: slate.source.id,
      name: slate.source.name,
      rows: [],
    };
    group.rows.push(row);
    groups.set(group.id, group);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function SlatesSection() {
  const { slates, isReady } = useDecodedSlates();
  const today = localToday();
  const groups = useMemo(() => groupSlates(slates, today), [slates, today]);
  const rows = useMemo(() => groups.flatMap((group) => group.rows), [groups]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);

  // Forget selections of slates that are gone.
  useEffect(() => {
    setSelected((current) => {
      const present = new Set(slates.map((slate) => slate.token));
      const kept = [...current].filter((token) => present.has(token));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [slates]);

  const unnamed = rows.filter((row) => row.unnamed);
  const past = rows.filter((row) => row.past);

  function toggle(tokens: string[], on: boolean) {
    setConfirming(false);
    setSelected((current) => {
      const next = new Set(current);
      for (const token of tokens) {
        if (on) next.add(token);
        else next.delete(token);
      }
      return next;
    });
  }

  function select(which: SlateRow[]) {
    setConfirming(false);
    setSelected(new Set(which.map((row) => row.slate.token)));
  }

  function remove() {
    removeSlates(
      slates.filter((slate) => selected.has(slate.token)),
      slates,
    );
    setSelected(new Set());
    setConfirming(false);
  }

  return (
    <section className="panel">
      <h2>Imported slates</h2>
      <p className="hint">
        The endorsements you've added, each a signed slate. Removing one takes it off My ballot and
        Sources; a source left with none is forgotten, so nothing adds it back on its own. Import it
        again any time.
      </p>
      {!isReady ? (
        <p className="hint">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="hint">None yet.</p>
      ) : (
        <>
          <div className="row">
            <button type="button" className="link" onClick={() => select(rows)}>
              Select all {rows.length}
            </button>
            {past.length > 0 && (
              <button type="button" className="link" onClick={() => select(past)}>
                Select {plural(past.length, "past-election slate")}
              </button>
            )}
            {unnamed.length > 0 && (
              <button type="button" className="link" onClick={() => select(unnamed)}>
                Select {plural(unnamed.length, "unnamed slate")}
              </button>
            )}
            {selected.size > 0 && (
              <button type="button" className="link" onClick={() => select([])}>
                Select none
              </button>
            )}
          </div>
          <ul className="data-list">
            {groups.map((group) => (
              <SlateGroupItem key={group.id} group={group} selected={selected} toggle={toggle} />
            ))}
          </ul>
          <div className="row data-actions">
            {confirming ? (
              <>
                <button type="button" className="danger" onClick={remove}>
                  <Trash2 className="icon" /> Remove {plural(selected.size, "slate")}
                </button>
                <button type="button" className="link" onClick={() => setConfirming(false)}>
                  cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="danger"
                disabled={selected.size === 0}
                onClick={() => setConfirming(true)}
              >
                <Trash2 className="icon" /> Remove selected
                {selected.size > 0 ? ` (${selected.size})` : ""}
              </button>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function SlateGroupItem({
  group,
  selected,
  toggle,
}: {
  group: SlateGroup;
  selected: ReadonlySet<string>;
  toggle: (tokens: string[], on: boolean) => void;
}) {
  const tokens = group.rows.map((row) => row.slate.token);
  const count = tokens.filter((token) => selected.has(token)).length;
  const single = group.rows.length === 1 ? group.rows[0] : undefined;

  return (
    <li>
      <Checkbox
        isSelected={count === tokens.length}
        isIndeterminate={count > 0 && count < tokens.length}
        onChange={(on) => toggle(tokens, on)}
      >
        <span className="data-slate">
          <strong>{group.name}</strong>
          {single ? (
            <SlateDetail row={single} />
          ) : (
            <span className="hint">{plural(group.rows.length, "slate")}</span>
          )}
        </span>
      </Checkbox>
      {!single && (
        <ul className="data-sublist">
          {group.rows.map((row) => (
            <li key={row.slate.token}>
              <Checkbox
                isSelected={selected.has(row.slate.token)}
                onChange={(on) => toggle([row.slate.token], on)}
              >
                <SlateDetail row={row} />
              </Checkbox>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function SlateDetail({ row }: { row: SlateRow }) {
  const { slate } = row;
  return (
    <span className="hint">
      {row.elections.map(formatElectionDate).join(", ") || "no election date"} ·{" "}
      {plural(slate.payload.positions.length, "position")}
      {slate.importedAt && <> · added {formatLocalDate(slate.importedAt)}</>}
      {row.unnamed && " · signed without a name"}
      {slate.local && " · unsigned"}
      {!slate.valid && <span className="warning"> · failed verification</span>}
    </span>
  );
}

// --- Identities, contacts, published ---

function AccountsSection() {
  const identities = useMyIdentities();
  const contacts = useKnownIdentities();
  const { data: published } = useLiveQuery((q) => q.from({ published: publishedCollection }));

  return (
    <section className="panel">
      <h2>Identities and contacts</h2>
      <ul className="data-list">
        <li>
          <strong>{plural(identities.length, "signing identity", "signing identities")}</strong>
          <div className="hint">
            Your own keys for publishing. Each holds a secret key: lose it and you can't sign as
            that identity again. <Link to="/publish/identities">Manage and back up identities</Link>
          </div>
        </li>
        <li>
          <strong>{plural(contacts.length, "contact")}</strong>
          <div className="hint">
            Nicknames you gave the people and groups whose slates you import.{" "}
            <Link to="/sources">Manage contacts in Sources</Link>
          </div>
        </li>
        <li>
          <strong>{plural(published.length, "published slate")}</strong>
          <div className="hint">Slates you signed in this browser.</div>
        </li>
      </ul>
    </section>
  );
}

// --- Settings and choices (localStorage) ---

function SettingsSection({ revision, onChange }: { revision: number; onChange: () => void }) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read after each change.
  const entries = useMemo(() => readLocalEntries(), [revision]);
  const [cachesCleared, setCachesCleared] = useState(false);

  const byGroup = new Map<KeyGroup, LocalEntry[]>();
  const legacy: LocalEntry[] = [];
  for (const entry of entries) {
    if (entry.described.kind === "legacy") legacy.push(entry);
    else {
      const list = byGroup.get(entry.described.group) ?? [];
      list.push(entry);
      byGroup.set(entry.described.group, list);
    }
  }
  const groupOrder = Object.keys(KEY_GROUP_LABEL) as KeyGroup[];

  function remove(keys: string[]) {
    for (const key of keys) removeLocalKey(key);
    onChange();
  }

  return (
    <section className="panel">
      <h2>Settings and choices</h2>
      <p className="hint">
        Smaller things this browser remembers. Resetting one puts it back to how a new visitor
        starts.
      </p>
      {entries.length === 0 && <p className="hint">Nothing saved yet.</p>}
      {groupOrder.map((group) => {
        const list = byGroup.get(group);
        if (!list) return null;
        return (
          <div key={group} className="data-group">
            <h3>{KEY_GROUP_LABEL[group]}</h3>
            <ul className="data-list">
              {list.map((entry) => (
                <LocalEntryRow key={entry.key} entry={entry} onReset={() => remove([entry.key])} />
              ))}
            </ul>
          </div>
        );
      })}
      {legacy.length > 0 && (
        <div className="data-group">
          <h3>Left over from older versions</h3>
          <ul className="data-list">
            {legacy.map((entry) => (
              <LocalEntryRow key={entry.key} entry={entry} onReset={() => remove([entry.key])} />
            ))}
          </ul>
          {legacy.length > 1 && (
            <button type="button" onClick={() => remove(legacy.map((entry) => entry.key))}>
              <Trash2 className="icon" /> Remove all {legacy.length}
            </button>
          )}
        </div>
      )}
      <div className="data-group">
        <h3>Downloaded data</h3>
        <p className="hint">
          Copies of the public catalog, results and polls, kept so pages open fast and work offline.
          Clearing them is safe: they download again when needed.
        </p>
        <button
          type="button"
          onClick={() => void clearCaches().then(() => setCachesCleared(true), onChange)}
        >
          <RotateCcw className="icon" /> Clear downloaded data
        </button>
        {cachesCleared && <span className="hint"> Cleared.</span>}
      </div>
    </section>
  );
}

function LocalEntryRow({ entry, onReset }: { entry: LocalEntry; onReset: () => void }) {
  const { described } = entry;
  const known = described.kind === "known";
  return (
    <li className="data-entry">
      <div className="grow">
        <strong>{known ? described.label : <code>{entry.key}</code>}</strong>{" "}
        <span className="hint">{formatBytes(entry.size)}</span>
        <div className="hint">{described.description}</div>
      </div>
      <button
        type="button"
        className="link"
        onClick={onReset}
        aria-label={`${known ? "Reset" : "Remove"} ${known ? described.label : entry.key}`}
      >
        {known ? (
          <>
            <RotateCcw className="icon" /> reset
          </>
        ) : (
          <>
            <Trash2 className="icon" /> remove
          </>
        )}
      </button>
    </li>
  );
}

// --- Backup and restore ---

type RestoreMode = "merge" | "replace";

function BackupSection() {
  const [withIdentities, setWithIdentities] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [loaded, setLoaded] = useState<{ name: string; backup: Backup } | undefined>();
  const [mode, setMode] = useState<RestoreMode>("merge");

  async function backUp() {
    setBusy(true);
    setError(undefined);
    try {
      const text = await createBackup({ withoutIdentities: !withIdentities });
      downloadText(backupFileName(), text, "application/json");
    } catch (e) {
      setError(`Couldn't make the backup: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function load(file: File) {
    setError(undefined);
    setLoaded(undefined);
    const parsed = parseBackup(await file.text());
    if (parsed.ok) setLoaded({ name: file.name, backup: parsed.backup });
    else setError(parsed.error);
  }

  async function restore() {
    if (!loaded) return;
    setBusy(true);
    try {
      await restoreBackup(loaded.backup, { replace: mode === "replace" });
      location.reload();
    } catch (e) {
      setBusy(false);
      setError(`Couldn't restore: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  const summary = loaded ? summarizeBackup(loaded.backup) : undefined;

  return (
    <section className="panel">
      <h2>Back up and restore</h2>
      <p className="hint">
        One file with everything above: slates, picks and notes, sources, area, contacts and
        settings. Use it to move to another browser or device, or to keep a copy. Downloaded data
        isn't included; it comes back on its own.
      </p>
      <div className="card">
        <Checkbox isSelected={withIdentities} onChange={setWithIdentities}>
          Include my signing identities (their secret keys)
        </Checkbox>
        {withIdentities && (
          <p className="hint">Anyone with the file can sign as you. Keep it somewhere private.</p>
        )}
        <div className="row">
          <button type="button" onClick={() => void backUp()} disabled={busy}>
            <Download className="icon" /> Download backup
          </button>
        </div>
      </div>
      <div className="card">
        <FileDrop
          accept={[".json", "application/json"]}
          onFile={(file) => void load(file)}
          label="Restore from a backup"
          hint="or drop the file here"
        />
        {loaded && summary && (
          <div className="data-restore">
            <p>
              <strong>{loaded.name}</strong>, made{" "}
              {formatLocalDate(loaded.backup.exportedAt) || loaded.backup.exportedAt}:{" "}
              {[
                plural(summary.slates, "slate"),
                plural(summary.identities, "identity", "identities"),
                plural(summary.contacts, "contact"),
                plural(summary.published, "published slate"),
                plural(summary.settings, "setting"),
              ].join(", ")}
              .
            </p>
            <Segmented
              aria-label="How to restore"
              layout="stacked"
              options={[
                { id: "merge", label: "Add to what's here (the backup wins where both have one)" },
                { id: "replace", label: "Replace everything here with the backup" },
              ]}
              value={mode}
              onChange={setMode}
            />
            <div className="row">
              <button
                type="button"
                className={mode === "replace" ? "danger" : "primary"}
                onClick={() => void restore()}
                disabled={busy}
              >
                Restore
              </button>
              <button type="button" className="link" onClick={() => setLoaded(undefined)}>
                cancel
              </button>
            </div>
          </div>
        )}
      </div>
      {error && (
        <p className="warning" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

// --- Reset everything ---

function ResetSection() {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function reset() {
    setBusy(true);
    try {
      await resetEverything();
      location.hash = "#/";
      location.reload();
    } catch (e) {
      setBusy(false);
      setError(`Couldn't reset: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <section className="panel">
      <h2>Start over</h2>
      <p className="hint">
        Forget everything OpenSlate keeps in this browser: slates, picks and notes, sources, area,
        identities, contacts and settings. It can't be undone, so download a backup first if you
        might want any of it.
      </p>
      {confirming ? (
        <div className="row">
          <button type="button" className="danger" onClick={() => void reset()} disabled={busy}>
            <Trash2 className="icon" /> Yes, erase everything
          </button>
          <button type="button" className="link" onClick={() => setConfirming(false)}>
            cancel
          </button>
        </div>
      ) : (
        <button type="button" className="danger" onClick={() => setConfirming(true)}>
          <Trash2 className="icon" /> Reset everything
        </button>
      )}
      {error && (
        <p className="warning" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
