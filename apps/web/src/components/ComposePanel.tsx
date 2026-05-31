import {
  type Position,
  STANCES,
  type Stance,
  type Subject,
  buildSlate,
  deserializeIdentity,
  identityToIssuer,
  signSlate,
  verifySlate,
} from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useAddress, useElectionId } from "../lib/address";
import {
  type DraftRow,
  effectiveOrder,
  useBallotDraft,
  useBallotRanking,
} from "../lib/ballotDraft";
import { slatesCollection } from "../lib/collections";
import { useActiveIdentity } from "../lib/identities";
import { type BallotContest, electionsQueryOptions } from "../lib/query";
import { subjectKey, useBallotContests, useImportedSubjects } from "../lib/subjects";
import { BallotComposer } from "./BallotComposer";
import { ElectionCombobox } from "./ElectionCombobox";
import { RawInspector } from "./ImportVerifyPanel";
import { QrDialog } from "./Qr";
import { SubjectPicker } from "./SubjectPicker";

const STANCE_LABEL: Record<Stance, string> = {
  endorse: "Endorse",
  oppose: "Oppose",
  lean_for: "Lean for",
  lean_against: "Lean against",
  neutral: "Neutral",
  abstain: "Abstain",
};

interface OffBallotEntry {
  id: string;
  subject: Subject;
  stance: Stance;
  choice?: string;
  statement?: string;
}

export function ComposePanel() {
  const { active: identity, all: myIdentities, activeKey, setActiveKey } = useActiveIdentity();

  const [address, setAddress] = useAddress();
  const [addressDraft, setAddressDraft] = useState(address);
  const [electionId, setElectionId] = useElectionId();
  const electionsQuery = useQuery(electionsQueryOptions());
  const imported = useImportedSubjects();
  const ballot = useBallotContests(address, electionId || undefined);
  const draft = useBallotDraft();
  const ranking = useBallotRanking();

  const [offBallot, setOffBallot] = useState<OffBallotEntry[]>([]);
  const [pickedSubject, setPickedSubject] = useState<Subject | null>(null);
  const [offBallotStance, setOffBallotStance] = useState<Stance>("endorse");
  const [offBallotChoice, setOffBallotChoice] = useState("");
  const [offBallotStatement, setOffBallotStatement] = useState("");
  const [pickerSeq, setPickerSeq] = useState(0);

  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const [exportSelections, setExportSelections] = useState(false);
  const [exportPrivateNotes, setExportPrivateNotes] = useState(false);
  const [exportEndorsements, setExportEndorsements] = useState(false);

  const { data: importedSlates } = useLiveQuery((q) => q.from({ slate: slatesCollection }));

  const ballotPositions = useMemo<Position[]>(() => {
    return Object.values(draft.rows)
      .filter(
        (row): row is DraftRow & { stance: Stance } =>
          row.electionId === electionId && Boolean(row.stance),
      )
      .map((row) => ({
        subject: row.subject,
        stance: row.stance,
        ...(row.choice ? { choice: row.choice } : {}),
        ...(row.statement?.trim() ? { statement: row.statement.trim() } : {}),
      }));
  }, [draft.rows, electionId]);

  const offBallotPositions = useMemo<Position[]>(
    () =>
      offBallot.map((entry) => ({
        subject: entry.subject,
        stance: entry.stance,
        ...(entry.choice ? { choice: entry.choice } : {}),
        ...(entry.statement?.trim() ? { statement: entry.statement.trim() } : {}),
      })),
    [offBallot],
  );

  const allPositions = useMemo(
    () => [...ballotPositions, ...offBallotPositions],
    [ballotPositions, offBallotPositions],
  );

  const selectedElection = electionsQuery.data?.find((e) => e.id === electionId);

  function commitAddress() {
    const next = addressDraft.trim();
    if (next !== address) setAddress(next);
  }
  function clearAddress() {
    setAddress("");
    setAddressDraft("");
  }

  function addOffBallot() {
    if (!pickedSubject) {
      setError("pick or enter a subject");
      return;
    }
    setOffBallot((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        subject: pickedSubject,
        stance: offBallotStance,
        ...(offBallotChoice.trim() ? { choice: offBallotChoice.trim() } : {}),
        ...(offBallotStatement.trim() ? { statement: offBallotStatement.trim() } : {}),
      },
    ]);
    setPickedSubject(null);
    setOffBallotStance("endorse");
    setOffBallotChoice("");
    setOffBallotStatement("");
    setPickerSeq((n) => n + 1);
    setError(null);
    setToken("");
  }

  function removeOffBallot(id: string) {
    setOffBallot((current) => current.filter((e) => e.id !== id));
    setToken("");
  }

  function generate() {
    if (!identity) {
      setError("create an identity first (Identity tab)");
      return;
    }
    if (allPositions.length === 0) {
      setError("set a stance on at least one race or add an off-ballot position");
      return;
    }
    try {
      const id = deserializeIdentity(identity);
      const payload = buildSlate({ issuer: identityToIssuer(id), positions: allPositions });
      setToken(signSlate(payload, id.keyPair.secretKey));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to sign");
    }
  }

  async function copyToken() {
    await navigator.clipboard.writeText(token);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function printSummary() {
    window.print();
  }

  function exportBallot(format: "json" | "csv") {
    if (ballot.contests.length === 0) return;
    const electionInfo = selectedElection
      ? {
          id: selectedElection.id,
          name: selectedElection.name,
          electionDay: selectedElection.electionDay,
        }
      : null;

    // Pre-compute imported endorsements grouped by subject key + candidate name.
    interface Endorsement {
      issuer: string;
      issuerName?: string;
      stance: Stance;
      choice?: string;
      statement?: string;
    }
    const endorsementsBySubject = new Map<string, Endorsement[]>();
    if (exportEndorsements) {
      for (const slate of importedSlates) {
        const result = verifySlate(slate.token);
        if (!result.payload) continue;
        const issuer = result.payload.issuer.key;
        const issuerName = result.payload.issuer.name;
        for (const position of result.payload.positions) {
          const skey = subjectKey(position.subject);
          const list = endorsementsBySubject.get(skey) ?? [];
          list.push({
            issuer,
            ...(issuerName ? { issuerName } : {}),
            stance: position.stance,
            ...(position.choice ? { choice: position.choice } : {}),
            ...(position.statement ? { statement: position.statement } : {}),
          });
          endorsementsBySubject.set(skey, list);
        }
      }
    }

    // My rows for current election, indexed by subjectKey + choice for fast lookup.
    type MySelection = { stance?: Stance; statement?: string; privateNote?: string };
    const myBy = new Map<string, MySelection>();
    if (exportSelections || exportPrivateNotes) {
      for (const row of Object.values(draft.rows)) {
        if (row.electionId !== electionId) continue;
        myBy.set(`${subjectKey(row.subject)}|${row.choice ?? ""}`, {
          stance: row.stance,
          statement: row.statement,
          privateNote: row.privateNote,
        });
      }
    }

    let blob: Blob;
    if (format === "json") {
      const contests = ballot.contests.map((contest) => {
        const skey = subjectKey(contest.subject);
        const base = {
          title: contest.subject.title,
          id: contest.subject.id,
          kind: contest.subject.kind,
          jurisdiction: contest.subject.jurisdiction,
          election: contest.subject.election,
          voteFor: contest.voteFor,
          candidates: contest.candidates,
        };
        const extras: Record<string, unknown> = {};
        if (exportSelections || exportPrivateNotes) {
          const choices =
            contest.candidates.length > 0 ? contest.candidates.map((c) => c.name) : [""];
          const mySelections = choices
            .map((choice) => {
              const my = myBy.get(`${skey}|${choice}`);
              if (!my) return null;
              const entry: Record<string, unknown> = { choice: choice || undefined };
              if (exportSelections) {
                if (my.stance) entry.stance = my.stance;
                if (my.statement?.trim()) entry.statement = my.statement.trim();
              }
              if (exportPrivateNotes && my.privateNote?.trim()) {
                entry.privateNote = my.privateNote.trim();
              }
              return Object.keys(entry).length > 1 ? entry : null;
            })
            .filter(Boolean);
          if (mySelections.length > 0) extras.mySelections = mySelections;
        }
        if (exportEndorsements) {
          const endorsements = endorsementsBySubject.get(skey) ?? [];
          if (endorsements.length > 0) extras.endorsements = endorsements;
        }
        return { ...base, ...extras };
      });
      const payload = {
        election: electionInfo,
        address: address || undefined,
        exportedAt: new Date().toISOString(),
        contests,
      };
      blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    } else {
      const csvCell = (value: string) => `"${value.replace(/"/g, '""')}"`;
      const headers = [
        "ElectionId",
        "ElectionDay",
        "RaceId",
        "Race",
        "Kind",
        "Jurisdiction",
        "VoteFor",
        "Candidate",
        "Party",
      ];
      if (exportSelections) headers.push("MyStance", "MyStatement");
      if (exportPrivateNotes) headers.push("MyPrivateNote");
      const rows: string[][] = [headers];
      for (const contest of ballot.contests) {
        const skey = subjectKey(contest.subject);
        const meta = [
          electionInfo?.id ?? "",
          electionInfo?.electionDay ?? "",
          contest.subject.id ?? "",
          contest.subject.title,
          contest.subject.kind ?? "",
          contest.subject.jurisdiction ?? "",
          contest.voteFor ? String(contest.voteFor) : "",
        ];
        const choices =
          contest.candidates.length > 0
            ? contest.candidates
            : [{ name: "", party: undefined as string | undefined }];
        for (const candidate of choices) {
          const row = [...meta, candidate.name, candidate.party ?? ""];
          if (exportSelections) {
            const my = myBy.get(`${skey}|${candidate.name}`);
            row.push(my?.stance ?? "", my?.statement?.trim() ?? "");
          }
          if (exportPrivateNotes) {
            const my = myBy.get(`${skey}|${candidate.name}`);
            row.push(my?.privateNote?.trim() ?? "");
          }
          rows.push(row);
        }
      }
      blob = new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], {
        type: "text/csv",
      });
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const slug =
      (selectedElection?.name ?? selectedElection?.id ?? "ballot").replace(/[^a-z0-9]+/gi, "_") ||
      "ballot";
    link.download = `openslate.ballot.${slug}.${format}`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="panel">
      <div className="no-print">
        <h2>Compose a slate</h2>
        <p className="hint">
          Set a stance on each race you care about. Public stances + statements become part of your
          signed slate; private notes stay on your device.
        </p>

        <div className="card signing-as">
          {myIdentities.length === 0 ? (
            <p className="hint">
              <strong>No identity yet.</strong> Create one in the Identity tab before signing.
            </p>
          ) : myIdentities.length === 1 ? (
            <p className="hint">
              Signing as <strong>{identity?.name ?? "(unnamed)"}</strong>{" "}
              <code className="key">{identity?.publicKey}</code>
            </p>
          ) : (
            <label className="row">
              <span>Signing as:</span>
              <select
                className="grow"
                value={activeKey || (identity?.publicKey ?? "")}
                onChange={(e) => setActiveKey(e.target.value)}
              >
                {myIdentities.map((id) => (
                  <option key={id.publicKey} value={id.publicKey}>
                    {id.name ?? "(unnamed)"} — {id.publicKey.slice(0, 20)}…
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="card">
          <div className="row">
            <label className="grow">
              Address (optional, for ballot lookup)
              <input
                type="text"
                placeholder="1600 Amphitheatre Pkwy, Mountain View CA"
                value={addressDraft}
                onChange={(e) => setAddressDraft(e.target.value)}
                onBlur={commitAddress}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitAddress();
                  }
                }}
              />
            </label>
            <button
              type="button"
              onClick={commitAddress}
              disabled={addressDraft.trim() === address}
            >
              Load ballot
            </button>
            {address && (
              <button type="button" className="link" onClick={clearAddress}>
                clear
              </button>
            )}
          </div>
          <div className="row">
            <ElectionCombobox
              value={electionId}
              onChange={setElectionId}
              elections={electionsQuery.data ?? []}
              isLoading={electionsQuery.isLoading}
              error={electionsQuery.error ?? null}
            />
          </div>
          {selectedElection?.electionDay &&
            selectedElection.electionDay < new Date().toISOString().slice(0, 10) && (
              <p className="warning">
                ⚠ This is a <strong>past election</strong> ({selectedElection.electionDay}). Any
                ballot data + your draft selections are historical.
              </p>
            )}
          {selectedElection?.id === "2000" && (
            <p className="hint">
              ⓘ This is the VIP <strong>Test Election</strong>. Contest data is sample/historical
              and may reference older dates.
            </p>
          )}
          <p className="hint">
            Address is forwarded to the server's stateless ballot proxy; never stored server-side.
          </p>
        </div>

        <BallotComposer
          contests={ballot.contests}
          electionId={electionId}
          rows={draft.rows}
          patch={draft.patch}
          rankings={ranking.rankings}
          setRanking={ranking.setRanking}
          isLoading={ballot.isLoading}
          error={ballot.error}
          enabled={ballot.enabled}
        />

        <div className="card">
          <h3>Off-ballot positions</h3>
          <p className="hint">
            For anything not on your ballot (e.g. an internal vote, an issue, a candidate already
            decided). Free text or pick from your imported slates' subjects.
          </p>
          <SubjectPicker key={pickerSeq} imported={imported} onChange={setPickedSubject} />
          <div className="grid">
            <label>
              Stance
              <select
                value={offBallotStance}
                onChange={(e) => setOffBallotStance(e.target.value as Stance)}
              >
                {STANCES.map((value) => (
                  <option key={value} value={value}>
                    {STANCE_LABEL[value]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Choice (optional)
              <input
                type="text"
                placeholder="e.g. A. Candidate"
                value={offBallotChoice}
                onChange={(e) => setOffBallotChoice(e.target.value)}
              />
            </label>
          </div>
          <label>
            Public statement (optional)
            <textarea
              rows={2}
              placeholder="why you take this position"
              value={offBallotStatement}
              onChange={(e) => setOffBallotStatement(e.target.value)}
            />
          </label>
          <button type="button" onClick={addOffBallot} disabled={!pickedSubject}>
            Add off-ballot position
          </button>
          {offBallot.length > 0 && (
            <ul className="position-list">
              {offBallot.map((entry) => (
                <li key={entry.id}>
                  <span className={`stance stance-${entry.stance}`}>{entry.stance}</span>
                  <span className="position-subject">
                    {entry.subject.title}
                    {entry.choice ? ` → ${entry.choice}` : ""}
                  </span>
                  <button
                    type="button"
                    className="link danger"
                    onClick={() => removeOffBallot(entry.id)}
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="row">
          <button type="button" className="primary" onClick={generate}>
            Generate signed block ({allPositions.length} position
            {allPositions.length === 1 ? "" : "s"})
          </button>
          <button
            type="button"
            onClick={printSummary}
            disabled={ballotPositions.length === 0 && offBallot.length === 0}
          >
            Print my ballot
          </button>
        </div>

        <div className="card">
          <h3>Export ballot</h3>
          <p className="hint">
            The ballot structure (races + candidates) is always included. Toggle what else to embed:
          </p>
          <div className="row export-options">
            <label>
              <input
                type="checkbox"
                checked={exportSelections}
                onChange={(e) => setExportSelections(e.target.checked)}
              />{" "}
              My selections + public statements
            </label>
            <label>
              <input
                type="checkbox"
                checked={exportPrivateNotes}
                onChange={(e) => setExportPrivateNotes(e.target.checked)}
              />{" "}
              Private notes
            </label>
            <label>
              <input
                type="checkbox"
                checked={exportEndorsements}
                onChange={(e) => setExportEndorsements(e.target.checked)}
              />{" "}
              Imported endorsements <span className="hint">(JSON only)</span>
            </label>
          </div>
          <div className="row">
            <button
              type="button"
              onClick={() => exportBallot("json")}
              disabled={ballot.contests.length === 0}
            >
              Download JSON
            </button>
            <button
              type="button"
              onClick={() => exportBallot("csv")}
              disabled={ballot.contests.length === 0}
            >
              Download CSV
            </button>
          </div>
        </div>
        {error && <p className="error">{error}</p>}

        {token && (
          <div className="card">
            <label>
              Shareable block
              <textarea readOnly rows={6} value={token} className="token" />
            </label>
            <div className="row">
              <button type="button" onClick={copyToken}>
                {copied ? "Copied!" : "Copy"}
              </button>
              <button type="button" onClick={() => setShowQr(true)}>
                Show QR
              </button>
            </div>
            <RawInspector token={token} />
          </div>
        )}
      </div>

      {showQr && token && (
        <QrDialog text={token} label="Share this slate" onClose={() => setShowQr(false)} />
      )}

      <PrintSummary
        electionName={selectedElection?.name}
        electionDay={selectedElection?.electionDay}
        address={address}
        contests={ballot.contests}
        rows={Object.values(draft.rows).filter((r) => r.electionId === electionId)}
        rankings={ranking.rankings}
        electionId={electionId}
        offBallot={offBallot}
      />
    </section>
  );
}

function PrintSummary({
  electionName,
  electionDay,
  address,
  contests,
  rows,
  rankings,
  electionId,
  offBallot,
}: {
  electionName?: string;
  electionDay?: string;
  address: string;
  contests: BallotContest[];
  rows: DraftRow[];
  rankings: Record<string, string[]>;
  electionId: string;
  offBallot: OffBallotEntry[];
}) {
  // Index draft rows by subject for fast per-contest lookup.
  const rowsBySubject = new Map<string, DraftRow[]>();
  for (const row of rows) {
    const key = subjectKey(row.subject);
    const bucket = rowsBySubject.get(key) ?? [];
    bucket.push(row);
    rowsBySubject.set(key, bucket);
  }
  const contestKeys = new Set(contests.map((c) => subjectKey(c.subject)));
  const orphanRows = rows.filter((r) => !contestKeys.has(subjectKey(r.subject)));

  return (
    <div className="print-only print-summary">
      <h1>My Ballot</h1>
      <p>
        {electionName ? <strong>{electionName}</strong> : <em>(no election selected)</em>}
        {electionDay ? ` — ${electionDay}` : ""}
      </p>
      {address && (
        <p>
          <em>Address:</em> {address}
        </p>
      )}

      {contests.length === 0 && orphanRows.length === 0 && offBallot.length === 0 && (
        <p>
          <em>No selections yet.</em>
        </p>
      )}

      {contests.length > 0 && (
        <>
          <h2>Ballot</h2>
          {contests.map((contest) => (
            <PrintContest
              key={contest.subject.id ?? contest.subject.title}
              contest={contest}
              rows={rowsBySubject.get(subjectKey(contest.subject)) ?? []}
              ranking={rankings[`${electionId}|${subjectKey(contest.subject)}`]}
            />
          ))}
        </>
      )}

      {orphanRows.length > 0 && (
        <>
          <h2>Other selections</h2>
          <ul className="print-list">
            {orphanRows.map((row) => (
              <li key={row.id}>
                <strong>{row.subject.title}</strong>
                {row.choice ? ` → ${row.choice}` : ""}
                {row.stance && ` — ${STANCE_LABEL[row.stance]}`}
                {row.statement && (
                  <div>
                    <em>Statement:</em> {row.statement}
                  </div>
                )}
                {row.privateNote && (
                  <div>
                    <em>Private note:</em> {row.privateNote}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {offBallot.length > 0 && (
        <>
          <h2>Off-ballot</h2>
          <ul className="print-list">
            {offBallot.map((entry) => (
              <li key={entry.id}>
                <strong>{entry.subject.title}</strong>
                {entry.choice ? ` → ${entry.choice}` : ""}
                {` — ${STANCE_LABEL[entry.stance]}`}
                {entry.statement && (
                  <div>
                    <em>Statement:</em> {entry.statement}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <p>
        <em>
          Generated by OpenSlate. Private notes are visible on this printout but never signed or
          shared.
        </em>
      </p>
    </div>
  );
}

function PrintContest({
  contest,
  rows,
  ranking,
}: {
  contest: BallotContest;
  rows: DraftRow[];
  ranking?: string[];
}) {
  const { subject, candidates, voteFor } = contest;

  // Collect annotations (non-endorse stances + statements + private notes) per row.
  const annotation = new Map<string, string[]>();
  for (const row of rows) {
    const key = row.choice ?? "Your stance";
    const notes: string[] = [];
    if (row.stance) notes.push(STANCE_LABEL[row.stance].toLowerCase());
    if (row.statement?.trim()) notes.push(`note: ${row.statement.trim()}`);
    if (row.privateNote?.trim()) notes.push(`private: ${row.privateNote.trim()}`);
    if (notes.length) annotation.set(key, notes);
  }

  // Measures (no candidates) collapse to a single "Your stance" row.
  if (candidates.length === 0) {
    const ann = annotation.get("Your stance");
    return (
      <div className="print-contest">
        <h3>{subject.title}</h3>
        <p className="print-contest-meta">{subject.jurisdiction ?? ""}</p>
        <ul className="print-ballot">
          <li>
            <span className="print-rank">—</span> Your stance
            {ann && <span className="print-annotation"> — {ann.join("; ")}</span>}
          </li>
        </ul>
      </div>
    );
  }

  const defaultOrder = candidates.map((c) => c.name);
  const order = effectiveOrder(ranking, defaultOrder);
  const limit = voteFor ?? 1;

  return (
    <div className="print-contest">
      <h3>{subject.title}</h3>
      <p className="print-contest-meta">
        {subject.jurisdiction}
        {subject.jurisdiction && voteFor ? " · " : ""}
        {voteFor ? (voteFor === 1 ? "Vote for one" : `Vote for up to ${voteFor}`) : ""}
        {ranking && ranking.length > 0 ? " · ranked" : " · unranked (default order)"}
      </p>
      <ul className="print-ballot">
        {order.map((name, index) => {
          const candidate = candidates.find((c) => c.name === name);
          const topN = index < limit;
          const ann = annotation.get(name);
          return (
            <li key={name} className={topN ? "print-top-n" : ""}>
              <span className="print-rank">{index + 1}.</span>{" "}
              {topN && <span className="print-pick">★</span>}
              {name}
              {candidate?.party ? ` (${candidate.party})` : ""}
              {ann && <span className="print-annotation"> — {ann.join("; ")}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
