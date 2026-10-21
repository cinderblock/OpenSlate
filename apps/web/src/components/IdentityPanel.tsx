import { type StoredIdentity, createIdentity, serializeIdentity } from "@openslate/core";
import { useState } from "react";
import { addIdentity, forgetIdentity, forgetPublished } from "../lib/collections";
import { formatElectionDate, formatLocalDate } from "../lib/dates";
import { shortKey, useActiveIdentity } from "../lib/identities";
import { downloadIdentityBackup } from "../lib/identityBackup";
import { usePublishedSlates } from "../lib/published";
import { contactToQrText } from "../lib/qr";
import { track } from "../lib/usage";
import { QrDialog } from "./Qr";
import { Radio, RadioGroup } from "./ui/Radio";
import { TextArea, TextField } from "./ui/TextField";

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

      <div className="card-columns">
        <div className="card">
          <h3>My identities</h3>
          {myIdentities.length === 0 ? (
            <p className="hint">No identities yet — generate one below.</p>
          ) : (
            <RadioGroup
              aria-label="Sign as"
              value={effectiveActive || null}
              onChange={setActiveKey}
              className="identity-list"
            >
              {myIdentities.map((identity) => (
                <div key={identity.publicKey} className="identity-row">
                  <Radio value={identity.publicKey} variant="card" className="identity-radio">
                    <span className="grow">
                      <strong>{identity.name ?? "(unnamed)"}</strong>{" "}
                      <span className="tag">{identity.kind ?? "individual"}</span>
                      {effectiveActive === identity.publicKey && (
                        <span className="tag tag-inline tag-on">signing as</span>
                      )}
                      <br />
                      <code className="key">{identity.publicKey}</code>
                    </span>
                  </Radio>
                  <div className="row">
                    <button type="button" onClick={() => shareIdentity(identity)}>
                      Share QR
                    </button>
                    <button type="button" onClick={() => downloadIdentityBackup(identity)}>
                      Export
                    </button>
                    <button type="button" className="danger" onClick={() => forget(identity)}>
                      Forget
                    </button>
                  </div>
                </div>
              ))}
            </RadioGroup>
          )}

          <div className="row">
            <TextField
              className="grow"
              aria-label="Display name for a new identity"
              placeholder="display name (optional)"
              value={genName}
              onChange={setGenName}
            />
            <button type="button" onClick={generate}>
              + Generate new identity
            </button>
          </div>
          <details>
            <summary>Import an existing identity (backup JSON)</summary>
            <TextArea
              monospace
              rows={4}
              aria-label="Identity backup JSON"
              placeholder="paste identity JSON (contains secret key)"
              value={importText}
              onChange={setImportText}
            />
            <button type="button" onClick={importIdentity} disabled={!importText.trim()}>
              Import
            </button>
            {importError && <p className="error">{importError}</p>}
          </details>
        </div>

        <MySlatesCard identities={myIdentities} />
      </div>

      {qrShare && (
        <QrDialog text={qrShare.text} label={qrShare.label} onClose={() => setQrShare(null)} />
      )}
    </section>
  );
}

/** Slates signed in this browser, newest first. */
function MySlatesCard({ identities }: { identities: StoredIdentity[] }) {
  const { slates, isReady } = usePublishedSlates();
  const [copied, setCopied] = useState<string | null>(null);
  if (!isReady) return null;

  const nameOf = (key: string) =>
    identities.find((i) => i.publicKey === key)?.name ?? shortKey(key);

  async function copy(token: string) {
    await navigator.clipboard.writeText(token);
    setCopied(token);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="card">
      <h3>My slates</h3>
      {slates.length === 0 ? (
        <p className="hint">Nothing signed yet. Compose turns your My-ballot picks into a slate.</p>
      ) : (
        <>
          <p className="hint">
            Signed in this browser, newest first. On any race, your newest slate is the one that
            speaks for you.
          </p>
          <ul className="position-list">
            {slates.map((slate) => (
              <li key={slate.token}>
                <span className="position-subject">
                  <strong>{nameOf(slate.issuerKey)}</strong> · {formatLocalDate(slate.publishedAt)}
                  {slate.payload.context?.election &&
                    ` · ${formatElectionDate(slate.payload.context.election)}`}
                  {" · "}
                  {slate.payload.positions.length} position
                  {slate.payload.positions.length === 1 ? "" : "s"}
                </span>
                <button type="button" onClick={() => void copy(slate.token)}>
                  {copied === slate.token ? "Copied!" : "Copy"}
                </button>
                <button
                  type="button"
                  className="link danger"
                  onClick={() => forgetPublished(slate.token)}
                >
                  forget
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
