import { type Stance, type Subject, verifySlate } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { Link, useParams } from "@tanstack/react-router";
import { useMemo } from "react";
import { useBallotDraft } from "../lib/ballotDraft";
import { slatesCollection } from "../lib/collections";
import { shortKey, useKnownIdentities } from "../lib/identities";
import { subjectKey } from "../lib/subjects";
import { PollsPanel } from "./PollsPanel";
import { ResultsPanel } from "./ResultsPanel";

const STANCE_LABEL: Record<Stance, string> = {
  endorse: "Endorse",
  oppose: "Oppose",
  lean_for: "Lean for",
  lean_against: "Lean against",
  neutral: "Neutral",
  abstain: "Abstain",
};

interface IssuerPosition {
  issuerKey: string;
  issuerName: string;
  stance: Stance;
  choice?: string;
  statement?: string;
  valid: boolean;
  importedAt: string;
}

export function RacePanel() {
  const { key: routeKey } = useParams({ from: "/race/$key" });
  // TanStack Router auto-decodes route params, so routeKey is already the raw subject key.
  const targetKey = routeKey;

  const { data: slates } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  const draft = useBallotDraft();
  const knownContacts = useKnownIdentities();
  const contactNames = useMemo(
    () => new Map(knownContacts.map((c) => [c.publicKey, c.displayName ?? ""])),
    [knownContacts],
  );

  const view = useMemo(() => {
    let title = targetKey;
    let kind: string | undefined;
    let id: string | undefined;
    let jurisdiction: string | undefined;
    let election: string | undefined;
    const positions: IssuerPosition[] = [];

    for (const slate of slates) {
      const result = verifySlate(slate.token);
      if (!result.payload) continue;
      const issuerKey = result.payload.issuer.key;
      const nickname = contactNames.get(issuerKey);
      const issuerName = nickname?.trim() || result.payload.issuer.name || shortKey(issuerKey);
      for (const position of result.payload.positions) {
        if (subjectKey(position.subject) !== targetKey) continue;
        title = position.subject.title;
        kind = position.subject.kind;
        id = position.subject.id;
        jurisdiction = position.subject.jurisdiction;
        election = position.subject.election;
        positions.push({
          issuerKey,
          issuerName,
          stance: position.stance,
          choice: position.choice,
          statement: position.statement,
          valid: result.valid,
          importedAt: slate.importedAt,
        });
      }
    }
    return { title, kind, id, jurisdiction, election, positions };
  }, [slates, targetKey, contactNames]);

  const myRows = useMemo(
    () => Object.values(draft.rows).filter((r) => subjectKey(r.subject) === targetKey),
    [draft.rows, targetKey],
  );

  const pollSubject = useMemo<Subject>(
    () => ({
      title: view.title,
      ...(view.id ? { id: view.id } : {}),
      ...(view.jurisdiction ? { jurisdiction: view.jurisdiction } : {}),
      ...(view.election ? { election: view.election } : {}),
    }),
    [view.title, view.id, view.jurisdiction, view.election],
  );

  const byChoice = useMemo(() => {
    const groups = new Map<string, IssuerPosition[]>();
    for (const position of view.positions) {
      const key = position.choice ?? "";
      const list = groups.get(key) ?? [];
      list.push(position);
      groups.set(key, list);
    }
    return [...groups.entries()]
      .map(([choice, items]) => ({
        choice,
        items: [...items].sort((a, b) => a.issuerName.localeCompare(b.issuerName)),
        endorse: items.filter((i) => i.stance === "endorse").length,
        oppose: items.filter((i) => i.stance === "oppose").length,
      }))
      .sort((a, b) => {
        // Order: most-endorsed first, then alphabetical by choice
        if (b.endorse !== a.endorse) return b.endorse - a.endorse;
        return a.choice.localeCompare(b.choice);
      });
  }, [view.positions]);

  return (
    <section className="panel">
      <p>
        <Link to="/collate">← back to Collate</Link>
      </p>
      <h2>{view.title}</h2>
      <p className="hint">
        {view.kind && <span className="tag">{view.kind}</span>}{" "}
        {view.jurisdiction && <span>{view.jurisdiction}</span>}
        {view.election && <span> · {view.election}</span>}
        {view.id && (
          <>
            {" · "}
            <code className="key">{view.id}</code>
          </>
        )}
      </p>

      {myRows.length > 0 && (
        <div className="card">
          <h3>My positions</h3>
          <ul className="position-list">
            {myRows.map((row) => (
              <li key={row.id}>
                <span className={`stance stance-${row.stance ?? "neutral"}`}>
                  {row.stance ? STANCE_LABEL[row.stance] : "—"}
                </span>
                <span className="position-subject">
                  {row.choice ?? <em>(overall)</em>}
                  {row.statement && (
                    <div className="hint">
                      <em>statement:</em> {row.statement}
                    </div>
                  )}
                  {row.privateNote && (
                    <div className="hint">
                      <em>private note:</em> {row.privateNote}
                    </div>
                  )}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <PollsPanel subject={pollSubject} />

      <ResultsPanel subject={pollSubject} />

      {view.positions.length === 0 ? (
        <div className="card">
          <p className="hint">No endorsements imported for this subject yet.</p>
        </div>
      ) : (
        byChoice.map((group) => (
          <div key={group.choice} className="card">
            <div className="card-title">
              <strong>{group.choice || <em>(no specific choice)</em>}</strong>
              <span className="tag">
                {group.endorse} for · {group.oppose} against
              </span>
            </div>
            <ul className="position-list">
              {group.items.map((position, index) => (
                <li key={`${position.issuerKey}-${index}`}>
                  <span className={`stance stance-${position.stance}`}>
                    {STANCE_LABEL[position.stance]}
                  </span>
                  <span className="position-subject">
                    <strong title={position.issuerKey}>{position.issuerName}</strong>
                    {!position.valid && <span className="warning"> (unverified)</span>}
                    {position.statement && <div className="hint">"{position.statement}"</div>}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </section>
  );
}
