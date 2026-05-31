import { type Stance, verifySlate } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { slatesCollection } from "../lib/collections";
import { shortKey, useKnownIdentities } from "../lib/identities";
import { SlatesList } from "./SlatesList";

interface Entry {
  issuerKey: string;
  issuerName?: string;
  stance: Stance;
  choice?: string;
  statement?: string;
  valid: boolean;
}

interface SubjectGroup {
  key: string;
  title: string;
  subjectId?: string;
  entries: Entry[];
}

function collate(tokens: string[], contactNames: Map<string, string | undefined>): SubjectGroup[] {
  const groups = new Map<string, SubjectGroup>();
  for (const token of tokens) {
    const result = verifySlate(token);
    if (!result.payload) continue;
    const issuerKey = result.payload.issuer.key;
    const nickname = contactNames.get(issuerKey);
    const issuerName = nickname?.trim() || result.payload.issuer.name;
    for (const position of result.payload.positions) {
      const { subject } = position;
      const key =
        subject.id ?? `${subject.title}|${subject.jurisdiction ?? ""}|${subject.election ?? ""}`;
      const group = groups.get(key) ?? {
        key,
        title: subject.title,
        subjectId: subject.id,
        entries: [],
      };
      group.entries.push({
        issuerKey,
        issuerName,
        stance: position.stance,
        choice: position.choice,
        statement: position.statement,
        valid: result.valid,
      });
      groups.set(key, group);
    }
  }
  return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
}

export function CollatePanel() {
  const { data: imported } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  const knownContacts = useKnownIdentities();
  const contactNames = useMemo(
    () => new Map(knownContacts.map((c) => [c.publicKey, c.displayName])),
    [knownContacts],
  );
  const groups = useMemo(
    () =>
      collate(
        imported.map((slate) => slate.token),
        contactNames,
      ),
    [imported, contactNames],
  );

  return (
    <section className="panel">
      <h2>Collate by race</h2>
      <p className="hint">
        Every endorsement you've imported, grouped by what's being voted on. Positions on the same
        subject line up so you can compare who endorsed what.
      </p>

      {imported.length === 0 ? (
        <div className="card">
          <p>Nothing imported yet. Use the Import &amp; verify tab to add slates.</p>
        </div>
      ) : (
        <>
          {groups.map((group) => (
            <div key={group.key} className="card">
              <div className="card-title">
                <Link to="/race/$key" params={{ key: group.key }} className="race-link">
                  <strong>{group.title}</strong>
                </Link>
                {group.subjectId && <span className="tag">{group.subjectId}</span>}
              </div>
              <ul className="position-list">
                {group.entries.map((entry, index) => (
                  <li key={`${entry.issuerKey}-${index}`}>
                    <span className={`stance stance-${entry.stance}`}>{entry.stance}</span>
                    <span className="position-subject">
                      {entry.choice ? `${entry.choice} — ` : ""}
                      <span title={entry.issuerKey}>
                        {entry.issuerName ?? shortKey(entry.issuerKey)}
                      </span>
                      {!entry.valid && <span className="warning"> (unverified)</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          <div className="card">
            <h3>All imported slates</h3>
            <SlatesList />
          </div>
        </>
      )}
    </section>
  );
}
