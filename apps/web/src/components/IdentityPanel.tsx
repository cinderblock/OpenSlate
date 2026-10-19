import { type StoredIdentity, createIdentity, serializeIdentity } from "@openslate/core";
import { useState } from "react";
import { addIdentity, forgetIdentity } from "../lib/collections";
import { useActiveIdentity } from "../lib/identities";
import { contactToQrText } from "../lib/qr";
import { track } from "../lib/usage";
import { QrDialog } from "./Qr";

export function IdentityPanel() {
  const { all: myIdentities, activeKey, setActiveKey } = useActiveIdentity();

  const [genName, setGenName] = useState("");
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);

  const [qrShare, setQrShare] = useState<{ text: string; label: string } | null>(null);

  function shareIdentity(identity: StoredIdentity) {
    setQrShare({
      text: contactToQrText(identity.publicKey, identity.name),
      label: `Share ${identity.name ?? "identity"} as a contact`,
    });
  }

  const effectiveActive =
    activeKey || (myIdentities.length === 1 ? (myIdentities[0]?.publicKey ?? "") : "");

  function generate() {
    const meta = genName.trim()
      ? { name: genName.trim(), kind: "individual" }
      : { kind: "individual" };
    const stored = serializeIdentity(createIdentity(meta));
    addIdentity(stored);
    track({ name: "identity.create" });
    setGenName("");
    if (!activeKey) setActiveKey(stored.publicKey);
  }

  function importIdentity() {
    try {
      const parsed = JSON.parse(importText) as StoredIdentity;
      if (!parsed.secretKey || !parsed.publicKey) throw new Error("missing publicKey/secretKey");
      addIdentity(parsed);
      track({ name: "identity.import" });
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
    track({ name: "identity.export" });
    URL.revokeObjectURL(url);
  }

  function forget(identity: StoredIdentity) {
    forgetIdentity(identity.publicKey);
    if (activeKey === identity.publicKey) setActiveKey("");
  }

  return (
    <section className="panel">
      <h2>Identities</h2>
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

      {qrShare && (
        <QrDialog text={qrShare.text} label={qrShare.label} onClose={() => setQrShare(null)} />
      )}
    </section>
  );
}
