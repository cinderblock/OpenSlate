import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAddress } from "../lib/address";
import { areaFromLookup } from "../lib/civicArea";
import type { AreaOptions } from "../lib/collate";
import type { Area } from "../lib/jurisdictions";
import { ballotQueryOptions, serverHealthOptions } from "../lib/query";
import { describeArea } from "./AreaPicker";
import { TextField } from "./ui/TextField";

/**
 * "Use my address": fills Where-you-vote from a Civic Info lookup through a
 * self-hosted OpenSlate server. Rendered only when such a server answers, so
 * the hosted app (no server, by design) never shows it. The address stays in
 * this browser; the server forwards it upstream and keeps nothing.
 */
export function AddressLookup({
  options,
  onFound,
}: {
  options: AreaOptions;
  onFound: (area: Area) => void;
}) {
  const health = useQuery(serverHealthOptions());
  const queryClient = useQueryClient();
  const [address, setAddress] = useAddress();
  const [draft, setDraft] = useState(address);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  if (!health.data?.ballotLookup) return null;

  async function lookUp() {
    const next = draft.trim();
    if (!next) return;
    setAddress(next);
    setBusy(true);
    setNote(null);
    try {
      const lookup = await queryClient.fetchQuery(ballotQueryOptions(next));
      const found = areaFromLookup(lookup, options);
      if (!found) throw new Error("the lookup didn't say which state that address is in");
      onFound(found.area);
      const extra = found.unknownLocalities.length
        ? ` (${found.unknownLocalities.join(", ")}: no imported races there, left out)`
        : "";
      setNote({ kind: "ok", text: `${describeArea(found.area) || "nothing recognised"}${extra}` });
    } catch (err) {
      setNote({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="address-lookup">
      <div className="row">
        <TextField
          className="grow"
          label="Use my address"
          placeholder="street address, city"
          value={draft}
          onChange={setDraft}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void lookUp();
            }
          }}
        />
        <button type="button" onClick={() => void lookUp()} disabled={busy || !draft.trim()}>
          {busy ? "Looking up…" : "Look up"}
        </button>
      </div>
      <p className="hint">
        Looked up through your self-hosted server (Google Civic Information); the address isn't
        stored anywhere but this browser. You can still adjust the result below.
      </p>
      {note && <p className={note.kind === "error" ? "error" : "hint"}>{note.text}</p>}
    </div>
  );
}
