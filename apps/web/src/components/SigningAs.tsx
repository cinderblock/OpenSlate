import { useState } from "react";
import { useActiveIdentity } from "../lib/identities";
import { CreateIdentity } from "./CreateIdentity";
import { Select } from "./ui/Select";

/** Who a signature will come from: make a first identity, or pick among several. */
export function SigningAs() {
  const { active: identity, all: myIdentities, activeKey, setActiveKey } = useActiveIdentity();
  // A first identity stays in its setup card until it's backed up (or passed over).
  const [settingUpIdentity, setSettingUpIdentity] = useState(false);

  if (myIdentities.length === 0 || settingUpIdentity) {
    return (
      <CreateIdentity
        onCreated={() => setSettingUpIdentity(true)}
        onDone={() => setSettingUpIdentity(false)}
      />
    );
  }
  if (myIdentities.length === 1) {
    return (
      <p className="hint">
        Signing as <strong>{identity?.name ?? "(unnamed)"}</strong>{" "}
        <code className="key">{identity?.publicKey}</code>
      </p>
    );
  }
  return (
    <Select
      label="Signing as"
      value={activeKey || (identity?.publicKey ?? null)}
      onChange={setActiveKey}
      options={myIdentities.map((id) => ({
        id: id.publicKey,
        label: id.name ?? "(unnamed)",
        description: <code className="key">{id.publicKey}</code>,
        badge: id.kind ?? "individual",
      }))}
    />
  );
}
