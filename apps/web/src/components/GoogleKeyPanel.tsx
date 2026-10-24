import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { civicElections, useGoogleKey } from "../lib/civic";
import { ReportCivicProblem } from "./ReportCivicProblem";
import { TextField } from "./ui/TextField";

type Check =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "ok"; elections: number }
  | { state: "error"; message: string };

/** "AIzaSyD…f9Qc": enough to recognise a key without showing it. */
function masked(key: string): string {
  return key.length > 12 ? `${key.slice(0, 7)}…${key.slice(-4)}` : "…";
}

/**
 * Settings: the user's own Google API key, for Google's Civic Information
 * lookups straight from this browser (see lib/civic.ts). Without one, Google
 * is still offered through OpenSlate's relay when it can ask.
 */
export function GoogleKeyPanel() {
  const [key, setKey] = useGoogleKey();
  const [draft, setDraft] = useState("");
  const [check, setCheck] = useState<Check>({ state: "idle" });
  const queryClient = useQueryClient();

  function save(next: string) {
    setKey(next);
    setDraft("");
    setCheck({ state: "idle" });
    void queryClient.invalidateQueries({ queryKey: ["civic-elections"] });
  }

  async function checkKey() {
    setCheck({ state: "checking" });
    try {
      setCheck({ state: "ok", elections: (await civicElections("key", key)).length });
    } catch (err) {
      setCheck({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <section className="panel">
      <h2>Your Google API key</h2>
      <p className="hint">
        With your own key, Google's Civic Information lookups (the elections list, and the ballot
        for an address) go straight from this browser to Google. Nothing passes through OpenSlate.
        The key is kept in this browser and sent only to Google.
      </p>
      <div className="card">
        {key ? (
          <>
            <p>
              Saved: <code className="key">{masked(key)}</code>
            </p>
            <div className="row">
              <button
                type="button"
                onClick={() => void checkKey()}
                disabled={check.state === "checking"}
              >
                {check.state === "checking" ? "Checking…" : "Check it"}
              </button>
              <button type="button" className="danger" onClick={() => save("")}>
                Forget it
              </button>
            </div>
            {check.state === "ok" && (
              <p className="hint">
                It works: Google lists {check.elections} election{check.elections === 1 ? "" : "s"}.
              </p>
            )}
            {check.state === "error" && (
              <p className="error">
                {check.message}{" "}
                <ReportCivicProblem lookup="key-check" route="key" message={check.message} />
              </p>
            )}
          </>
        ) : (
          <>
            <TextField
              label="Google API key"
              placeholder="AIza…"
              value={draft}
              onChange={setDraft}
              onKeyDown={(e) => {
                if (e.key === "Enter" && draft.trim()) {
                  e.preventDefault();
                  save(draft);
                }
              }}
            />
            <div className="row">
              <button
                type="button"
                className="primary"
                onClick={() => save(draft)}
                disabled={!draft.trim()}
              >
                Save key
              </button>
            </div>
          </>
        )}
        <details>
          <summary>How to get a key</summary>
          <ol className="hint">
            <li>
              In the Google Cloud console, create a project (or pick one) and enable the{" "}
              <a
                href="https://console.cloud.google.com/apis/library/civicinfo.googleapis.com"
                target="_blank"
                rel="noreferrer"
              >
                Google Civic Information API
              </a>
              . It's free.
            </li>
            <li>
              Under{" "}
              <a
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
              >
                Credentials
              </a>
              , create an API key.
            </li>
            <li>
              Restrict it: under <em>API restrictions</em>, allow only the Civic Information API;
              under <em>Application restrictions</em>, pick <em>Websites</em> and add{" "}
              <code className="key">{`${window.location.origin}/*`}</code>. Then the key is no use
              to anyone else.
            </li>
          </ol>
        </details>
      </div>
    </section>
  );
}
