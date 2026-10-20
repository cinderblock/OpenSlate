import {
  type Position,
  STANCES,
  type Stance,
  type Subject,
  buildSlate,
  deserializeIdentity,
  identityToIssuer,
  signSlate,
} from "@openslate/core";
import { Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { type DraftRow, NOTE_CHOICE, useBallotDraft } from "../lib/ballotDraft";
import { type ElectionSummary, defaultElection, electionsOf } from "../lib/collate";
import { rememberPublished } from "../lib/collections";
import { formatElectionDate } from "../lib/dates";
import { useActiveIdentity } from "../lib/identities";
import { jurisdictionLabel, jurisdictionRank } from "../lib/jurisdictions";
import { localToday, useDecodedSlates, useFollows, useMyElection } from "../lib/myVote";
import { subjectKey, useImportedSubjects } from "../lib/subjects";
import { track } from "../lib/usage";
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

interface OtherEntry {
  id: string;
  subject: Subject;
  stance: Stance;
  choice?: string;
  statement?: string;
}

/** Draft rows are keyed by election date; anything else is from before that (ignored). */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/**
 * Compose: turn My-ballot picks into a signed slate. Publishing isn't tied to
 * where you vote, so any race can be added here too, on the ballot or not.
 */
export function ComposePanel() {
  const { active: identity, all: myIdentities, activeKey, setActiveKey } = useActiveIdentity();
  const { slates } = useDecodedSlates();
  const [follows] = useFollows();
  const [chosenElection, setChosenElection] = useMyElection();
  const draft = useBallotDraft();
  const imported = useImportedSubjects();

  const today = localToday();
  const elections = useMemo(() => {
    const list: ElectionSummary[] = electionsOf(slates, follows);
    const known = new Set(list.map((e) => e.date));
    for (const row of Object.values(draft.rows)) {
      if (!row.stance || !DATE.test(row.electionId) || known.has(row.electionId)) continue;
      known.add(row.electionId);
      list.push({ date: row.electionId, races: 0, sources: 0, followedSources: 0 });
    }
    return list.sort((a, b) => a.date.localeCompare(b.date));
  }, [slates, follows, draft.rows]);
  const election = elections.some((e) => e.date === chosenElection)
    ? chosenElection
    : defaultElection(elections, today);

  const picks = useMemo(
    () =>
      Object.values(draft.rows)
        .filter((row) => row.electionId === election && row.stance && row.choice !== NOTE_CHOICE)
        .sort(
          (a, b) =>
            jurisdictionRank(a.subject.jurisdiction) - jurisdictionRank(b.subject.jurisdiction) ||
            collator.compare(
              jurisdictionLabel(a.subject.jurisdiction),
              jurisdictionLabel(b.subject.jurisdiction),
            ) ||
            collator.compare(a.subject.title, b.subject.title) ||
            collator.compare(a.choice ?? "", b.choice ?? ""),
        ),
    [draft.rows, election],
  );
  const [leftOut, setLeftOut] = useState<ReadonlySet<string>>(new Set());

  const [others, setOthers] = useState<OtherEntry[]>([]);
  const [pickedSubject, setPickedSubject] = useState<Subject | null>(null);
  const [otherStance, setOtherStance] = useState<Stance>("endorse");
  const [otherChoice, setOtherChoice] = useState("");
  const [otherStatement, setOtherStatement] = useState("");
  const [pickerSeq, setPickerSeq] = useState(0);

  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showQr, setShowQr] = useState(false);

  const positions = useMemo<Position[]>(() => {
    const fromPicks = picks
      .filter((row): row is DraftRow & { stance: Stance } => Boolean(row.stance))
      .filter((row) => !leftOut.has(row.id))
      .map((row) => ({
        subject: row.subject,
        stance: row.stance,
        ...(row.choice ? { choice: row.choice } : {}),
        ...(row.statement?.trim() ? { statement: row.statement.trim() } : {}),
      }));
    const fromOthers = others.map((entry) => ({
      subject: entry.subject,
      stance: entry.stance,
      ...(entry.choice ? { choice: entry.choice } : {}),
      ...(entry.statement?.trim() ? { statement: entry.statement.trim() } : {}),
    }));
    return [...fromPicks, ...fromOthers];
  }, [picks, leftOut, others]);

  function toggleLeftOut(id: string) {
    setLeftOut((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setToken("");
  }

  function addOther() {
    if (!pickedSubject) {
      setError("pick or enter a subject");
      return;
    }
    setOthers((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        subject: pickedSubject,
        stance: otherStance,
        ...(otherChoice.trim() ? { choice: otherChoice.trim() } : {}),
        ...(otherStatement.trim() ? { statement: otherStatement.trim() } : {}),
      },
    ]);
    setPickedSubject(null);
    setOtherStance("endorse");
    setOtherChoice("");
    setOtherStatement("");
    setPickerSeq((n) => n + 1);
    setError(null);
    setToken("");
  }

  function removeOther(id: string) {
    setOthers((current) => current.filter((e) => e.id !== id));
    setToken("");
  }

  function sign() {
    if (!identity) {
      setError("create an identity first (Identities)");
      return;
    }
    if (positions.length === 0) {
      setError("pick something on My ballot, or add a position below");
      return;
    }
    try {
      const id = deserializeIdentity(identity);
      const payload = buildSlate({
        issuer: identityToIssuer(id),
        ...(election ? { context: { election } } : {}),
        positions,
      });
      const signed = signSlate(payload, id.keyPair.secretKey);
      setToken(signed);
      rememberPublished({
        token: signed,
        issuerKey: payload.issuer.key,
        publishedAt: new Date().toISOString(),
      });
      track({ name: "slate.sign" });
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

  return (
    <section className="panel">
      <h2>Compose a slate</h2>
      <p className="hint">
        Your picks from My ballot, signed as a slate others can import. Public stances and
        statements go in; private notes never do. Add any other race or issue below.
      </p>

      <div className="card signing-as">
        {myIdentities.length === 0 ? (
          <p className="hint">
            <strong>No identity yet.</strong>{" "}
            <Link to="/publish/identities">Create one in Identities</Link> before signing.
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
        <div className="card-title">
          <h3>My picks</h3>
          <span className="grow" />
          {elections.length > 0 && (
            <label className="ballot-election">
              Election
              <select value={election ?? ""} onChange={(e) => setChosenElection(e.target.value)}>
                {elections.map((e) => (
                  <option key={e.date} value={e.date}>
                    {formatElectionDate(e.date)}
                    {e.date < today ? " (past)" : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
        {picks.length === 0 ? (
          <p className="hint">
            Nothing picked{election ? ` for ${formatElectionDate(election)}` : ""} yet.{" "}
            <Link to="/">Make your picks on My ballot</Link>, or add positions below.
          </p>
        ) : (
          <>
            <p className="hint">
              Untick a pick to keep it private. Change picks on <Link to="/">My ballot</Link>.
            </p>
            <ul className="pick-list">
              {picks.map((row) => (
                <PickRow
                  key={row.id}
                  row={row}
                  included={!leftOut.has(row.id)}
                  onToggle={() => toggleLeftOut(row.id)}
                  onChange={(fields) => {
                    draft.patch(row.electionId, row.subject, row.choice, fields);
                    setToken("");
                  }}
                />
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="card">
        <h3>Other positions</h3>
        <p className="hint">
          Any race or issue, on your ballot or not: pick a subject your imported slates know, or
          enter a new one.
        </p>
        <SubjectPicker key={pickerSeq} imported={imported} onChange={setPickedSubject} />
        <div className="grid">
          <label>
            Stance
            <select value={otherStance} onChange={(e) => setOtherStance(e.target.value as Stance)}>
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
              value={otherChoice}
              onChange={(e) => setOtherChoice(e.target.value)}
            />
          </label>
        </div>
        <label>
          Public statement (optional)
          <textarea
            rows={2}
            placeholder="why you take this position"
            value={otherStatement}
            onChange={(e) => setOtherStatement(e.target.value)}
          />
        </label>
        <button type="button" onClick={addOther} disabled={!pickedSubject}>
          Add position
        </button>
        {others.length > 0 && (
          <ul className="position-list">
            {others.map((entry) => (
              <li key={entry.id}>
                <span className={`stance stance-${entry.stance}`}>{entry.stance}</span>
                <span className="position-subject">
                  {entry.subject.title}
                  {entry.choice ? ` → ${entry.choice}` : ""}
                </span>
                <button type="button" className="link danger" onClick={() => removeOther(entry.id)}>
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="row">
        <button type="button" className="primary" onClick={sign}>
          Sign slate ({positions.length} position{positions.length === 1 ? "" : "s"})
        </button>
      </div>
      {error && <p className="error">{error}</p>}

      {token && (
        <div className="card">
          <label>
            Shareable block
            <textarea readOnly rows={6} value={token} className="token" />
          </label>
          <p className="hint">
            Kept in this browser (Identities → My slates); My ballot shows it on each race.
          </p>
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

      {showQr && token && (
        <QrDialog text={token} label="Share this slate" onClose={() => setShowQr(false)} />
      )}
    </section>
  );
}

function PickRow({
  row,
  included,
  onToggle,
  onChange,
}: {
  row: DraftRow;
  included: boolean;
  onToggle: () => void;
  onChange: (fields: { stance?: Stance; statement?: string }) => void;
}) {
  const [statement, setStatement] = useState(row.statement ?? "");
  const place = jurisdictionLabel(row.subject.jurisdiction);
  return (
    <li className={`pick-row${included ? "" : " left-out"}`}>
      <label className="pick-include">
        <input type="checkbox" checked={included} onChange={onToggle} />
        <span>
          <Link
            to="/race/$key"
            params={{ key: subjectKey(row.subject) }}
            className="race-link"
            title={place}
          >
            {row.subject.title}
          </Link>
          {row.choice ? (
            <>
              {" → "}
              <strong>{row.choice}</strong>
            </>
          ) : (
            <em> (as a whole)</em>
          )}
        </span>
      </label>
      <select
        className="pick-stance"
        value={row.stance ?? "endorse"}
        disabled={!included}
        onChange={(e) => onChange({ stance: e.target.value as Stance })}
        aria-label={`Stance on ${row.choice || row.subject.title}`}
      >
        {STANCES.map((value) => (
          <option key={value} value={value}>
            {STANCE_LABEL[value]}
          </option>
        ))}
      </select>
      <input
        type="text"
        className="pick-statement"
        placeholder="public statement (optional)"
        value={statement}
        disabled={!included}
        onChange={(e) => setStatement(e.target.value)}
        onBlur={() => {
          if ((row.statement ?? "") !== statement) onChange({ statement: statement || undefined });
        }}
        aria-label={`Statement on ${row.choice || row.subject.title}`}
      />
    </li>
  );
}
