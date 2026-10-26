import { createIdentity, serializeIdentity } from "@openslate/core";
import { useState } from "react";
import { addIdentity } from "../lib/collections";
import { useActiveIdentity } from "../lib/identities";
import { downloadIdentityBackup } from "../lib/identityBackup";
import { IS_DESKTOP_APP, THIS_DEVICE } from "../lib/platform";
import { track } from "../lib/usage";
import { Radio, RadioGroup } from "./ui/Radio";
import { TextField } from "./ui/TextField";

/**
 * A publisher's first step, where Compose needs it: make a signing identity,
 * then back it up before signing anything with it. `onCreated` fires as soon as
 * the key exists (so the caller keeps this on screen for the backup step),
 * `onDone` once they move on.
 */
export function CreateIdentity({
  onCreated,
  onDone,
}: {
  onCreated: () => void;
  onDone: () => void;
}) {
  const { all, setActiveKey } = useActiveIdentity();
  const [name, setName] = useState("");
  const [kind, setKind] = useState<"individual" | "organization">("individual");
  const [createdKey, setCreatedKey] = useState<string | null>(null);
  const created = all.find((i) => i.publicKey === createdKey);
  const [backedUp, setBackedUp] = useState(false);

  function create() {
    const stored = serializeIdentity(
      createIdentity(name.trim() ? { name: name.trim(), kind } : { kind }),
    );
    addIdentity(stored);
    setActiveKey(stored.publicKey);
    track({ name: "identity.create" });
    setCreatedKey(stored.publicKey);
    onCreated();
  }

  if (created) {
    return (
      <div className="create-identity">
        <h3>Back up your identity</h3>
        <p>
          Created <strong>{created.name ?? "your identity"}</strong>. Download a backup now: if{" "}
          {IS_DESKTOP_APP ? "the app's" : "this browser's"} data is cleared, the backup is the only
          way to keep signing as {created.name ?? "you"}. Anyone with the file can sign as you, so
          keep it private.
        </p>
        <code className="key">{created.publicKey}</code>
        <div className="row">
          <button
            type="button"
            className={backedUp ? "" : "primary"}
            onClick={() => {
              downloadIdentityBackup(created);
              setBackedUp(true);
            }}
          >
            {backedUp ? "Downloaded ✓" : "Download backup"}
          </button>
          <button type="button" className={backedUp ? "primary" : "hollow"} onClick={onDone}>
            Continue to signing →
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="create-identity">
      <h3>Create your signing identity</h3>
      <p>
        Your identity is a key pair. It signs your endorsements so anyone can check they came from
        you and weren't changed. The secret half never leaves {THIS_DEVICE}.
      </p>
      <TextField
        label="Name people will see (optional)"
        value={name}
        placeholder="e.g. Jamie Rivera, or Elm Street Tenants Association"
        onChange={setName}
      />
      <RadioGroup
        aria-label="Who is publishing"
        className="create-identity-kind"
        orientation="horizontal"
        value={kind}
        onChange={(value) => setKind(value as typeof kind)}
      >
        <Radio value="individual" variant="card">
          <span>
            <strong>Just me</strong>
            <span className="hint ui-option-note">My own recommendations</span>
          </span>
        </Radio>
        <Radio value="organization" variant="card">
          <span>
            <strong>An organization</strong>
            <span className="hint ui-option-note">A group's endorsements</span>
          </span>
        </Radio>
      </RadioGroup>
      <div className="row">
        <button type="button" className="primary" onClick={create}>
          Create identity
        </button>
      </div>
    </div>
  );
}
