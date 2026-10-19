import { useMemo, useState } from "react";
import { removeKnownIdentity, upsertKnownIdentity } from "../lib/collections";
import type { KnownIdentity } from "../lib/db";
import { shortKey, useKnownIdentities } from "../lib/identities";
import { parseScanned } from "../lib/qr";
import { ScanQrButton } from "./Qr";

/**
 * Other people's public keys, with private nicknames and notes. Moved here from
 * the Identity page: these are sources, not the user's own signing keys.
 */
export function ContactsCard() {
  const knownIdentities = useKnownIdentities();
  const [contactSearch, setContactSearch] = useState("");
  const [newContactKey, setNewContactKey] = useState("");
  const [newContactName, setNewContactName] = useState("");
  const [contactError, setContactError] = useState<string | null>(null);

  function handleContactScan(raw: string) {
    const parsed = parseScanned(raw);
    if (parsed.kind === "contact") {
      upsertKnownIdentity(parsed.publicKey, {
        displayName: parsed.name,
        source: "manual",
      });
      setContactError(null);
    } else if (parsed.kind === "slate") {
      setContactError("That QR code is a slate. Import it under “Add sources” above.");
    } else {
      setContactError("Couldn't recognise that QR code.");
    }
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
    <div className="card">
      <h3>People’s keys</h3>
      <p className="hint">
        Public keys of people and groups whose slates you import, added automatically. Local
        nicknames help you recognize them but are never shared. You cannot edit their endorsements —
        those are signed by them.
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
