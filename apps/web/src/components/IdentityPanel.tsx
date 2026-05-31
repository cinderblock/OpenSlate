import { type StoredIdentity, createIdentity, serializeIdentity } from "@openslate/core";
import { useMemo, useState } from "react";
import {
  addIdentity,
  forgetIdentity,
  removeKnownIdentity,
  upsertKnownIdentity,
} from "../lib/collections";
import type { KnownIdentity } from "../lib/db";
import { shortKey, useActiveIdentity, useKnownIdentities } from "../lib/identities";
import { contactToQrText, parseScanned } from "../lib/qr";
import { QrDialog, ScanQrButton } from "./Qr";

export function IdentityPanel() {
  const { all: myIdentities, activeKey, setActiveKey } = useActiveIdentity();
  const knownIdentities = useKnownIdentities();

  const [genName, setGenName] = useState("");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const [contactSearch, setContactSearch] = useState("");
  const [newContactKey, setNewContactKey] = useState("");
  const [newContactName, setNewContactName] = useState("");
  const [contactError, setContactError] = useState<string | null>(null);

  const [qrShare, setQrShare] = useState<{ text: string; label: string } | null>(null);

  function shareIdentity(identity: StoredIdentity) {
    setQrShare({
      text: contactToQrText(identity.publicKey, identity.name),
      label: `Share ${identity.name ?? "identity"} as a contact`,
    });
  }

  function handleContactScan(raw: string) {
    const parsed = parseScanned(raw);
    if (parsed.kind === "contact") {
      upsertKnownIdentity(parsed.publicKey, {
        displayName: parsed.name,
        source: "manual",
      });
      setContactError(null);
    } else if (parsed.kind === "slate") {
      setContactError("Scanned a slate token — use the Import & verify tab for that.");
    } else {
      setContactError("Couldn't recognise that QR code.");
    }
  }

  const effectiveActive =
    activeKey || (myIdentities.length === 1 ? (myIdentities[0]?.publicKey ?? "") : "");

  function generate() {
    const meta = genName.trim()
      ? { name: genName.trim(), kind: "individual" }
      : { kind: "individual" };
    const stored = serializeIdentity(createIdentity(meta));
    addIdentity(stored);
    setGenName("");
    if (!activeKey) setActiveKey(stored.publicKey);
  }

  function importIdentity() {
    try {
      const parsed = JSON.parse(importText) as StoredIdentity;
      if (!parsed.secretKey || !parsed.publicKey) throw new Error("missing publicKey/secretKey");
      addIdentity(parsed);
      setImportText("");
      setImportError(null);
      if (!activeKey) setActiveKey(parsed.publicKey);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "invalid identity JSON");
    }
  }

  function exportBackup(identity: StoredIdentity) {
    const blob = new Blob([JSON.stringify(identity, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const safe = (identity.name ?? "anon").replace(/[^a-z0-9]+/gi, "_");
    const link = document.createElement("a");
    link.href = url;
    link.download = `openslate.identity.${safe}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function forget(identity: StoredIdentity) {
    forgetIdentity(identity.publicKey);
    if (activeKey === identity.publicKey) setActiveKey("");
  }

  function addContact() {
    const key = newContactKey.trim();
    if (!key.startsWith("ed25519:")) {
      setContactError("public key must start with ed25519:");
      return;
    }
    upsertKnownIdentity(key, {
      displayName: newContactName.trim() || undefined,
      source: "manual",
    });
    setNewContactKey("");
    setNewContactName("");
    setContactError(null);
  }

  const filteredContacts = useMemo(() => {
    if (!contactSearch.trim()) return knownIdentities;
    const q = contactSearch.toLowerCase();
    return knownIdentities.filter(
      (c) =>
        (c.displayName ?? "").toLowerCase().includes(q) ||
        c.publicKey.toLowerCase().includes(q) ||
        (c.notes ?? "").toLowerCase().includes(q),
    );
  }, [knownIdentities, contactSearch]);

  return (
    <section className="panel">
      <h2>Identity</h2>
      <p className="hint">
        Your Ed25519 key pair is your identity. Each key's secret half lives only in this browser's
        localStorage — anyone with access to this browser can sign as you. Export backups and store
        them somewhere safe.
      </p>

      <div className="card">
        <h3>My identities</h3>
        {myIdentities.length === 0 ? (
          <p className="hint">No identities yet — generate one below.</p>
        ) : (
          <ul className="identity-list">
            {myIdentities.map((identity) => (
              <li key={identity.publicKey} className="identity-row">
                <label className="identity-radio">
                  <input
                    type="radio"
                    name="active-identity"
                    checked={effectiveActive === identity.publicKey}
                    onChange={() => setActiveKey(identity.publicKey)}
                  />
                  <span className="grow">
                    <strong>{identity.name ?? "(unnamed)"}</strong>{" "}
                    <span className="tag">{identity.kind ?? "individual"}</span>
                    <br />
                    <code className="key">{identity.publicKey}</code>
                  </span>
                </label>
                <div className="row">
                  <button type="button" onClick={() => shareIdentity(identity)}>
                    Share QR
                  </button>
                  <button type="button" onClick={() => exportBackup(identity)}>
                    Export
                  </button>
                  <button type="button" className="danger" onClick={() => forget(identity)}>
                    Forget
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="row">
          <input
            type="text"
            className="grow"
            placeholder="display name (optional)"
            value={genName}
            onChange={(e) => setGenName(e.target.value)}
          />
          <button type="button" onClick={generate}>
            + Generate new identity
          </button>
        </div>
        <details>
          <summary>Import an existing identity (backup JSON)</summary>
          <textarea
            rows={5}
            placeholder="paste identity JSON (contains secret key)"
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
          />
          <button type="button" onClick={importIdentity} disabled={!importText.trim()}>
            Import
          </button>
          {importError && <p className="error">{importError}</p>}
        </details>
      </div>

      <div className="card">
        <h3>Known contacts</h3>
        <p className="hint">
          Public keys of others. Auto-added when you save a slate. Local nicknames help you
          recognize them but are never shared. You cannot edit their endorsements — those are signed
          by them.
        </p>
        <div className="row">
          <input
            type="search"
            className="grow"
            placeholder={`search ${knownIdentities.length} contact(s) by name, key, or notes…`}
            value={contactSearch}
            onChange={(e) => setContactSearch(e.target.value)}
          />
          {contactSearch && (
            <button type="button" className="link" onClick={() => setContactSearch("")}>
              clear
            </button>
          )}
        </div>
        {filteredContacts.length === 0 ? (
          <p className="hint">{contactSearch ? "No matches." : "No contacts yet."}</p>
        ) : (
          <ul className="identity-list">
            {filteredContacts.map((contact) => (
              <ContactRow key={contact.publicKey} contact={contact} />
            ))}
          </ul>
        )}
        <details>
          <summary>+ Add public identity manually</summary>
          <div className="grid">
            <label>
              Public key
              <input
                type="text"
                placeholder="ed25519:..."
                value={newContactKey}
                onChange={(e) => setNewContactKey(e.target.value)}
              />
            </label>
            <label>
              Nickname (optional)
              <input
                type="text"
                placeholder="e.g. neighbor"
                value={newContactName}
                onChange={(e) => setNewContactName(e.target.value)}
              />
            </label>
          </div>
          <div className="row">
            <button type="button" onClick={addContact}>
              Add contact
            </button>
            <ScanQrButton onScan={handleContactScan} label="Scan QR contact" />
          </div>
          {contactError && <p className="error">{contactError}</p>}
        </details>
      </div>

      {qrShare && (
        <QrDialog text={qrShare.text} label={qrShare.label} onClose={() => setQrShare(null)} />
      )}
    </section>
  );
}

function ContactRow({ contact }: { contact: KnownIdentity }) {
  const [name, setName] = useState(contact.displayName ?? "");
  const [notes, setNotes] = useState(contact.notes ?? "");

  function saveName() {
    if ((contact.displayName ?? "") !== name.trim()) {
      upsertKnownIdentity(contact.publicKey, { displayName: name.trim() || undefined });
    }
  }
  function saveNotes() {
    if ((contact.notes ?? "") !== notes.trim()) {
      upsertKnownIdentity(contact.publicKey, { notes: notes.trim() || undefined });
    }
  }

  return (
    <li className="identity-row">
      <div className="grow">
        <input
          type="text"
          placeholder="nickname"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
        />
        <code className="key">{shortKey(contact.publicKey)}</code>
        <span className="tag">{contact.source}</span>
        <input
          type="text"
          placeholder="private notes (never shared)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          onBlur={saveNotes}
        />
      </div>
      <button
        type="button"
        className="link danger"
        onClick={() => removeKnownIdentity(contact.publicKey)}
      >
        remove
      </button>
    </li>
  );
}
