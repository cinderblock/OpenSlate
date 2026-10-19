import type { StoredIdentity } from "@openslate/core";
import { track } from "./usage";

/** Download an identity (including its secret key) as a backup JSON file. */
export function downloadIdentityBackup(identity: StoredIdentity): void {
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
