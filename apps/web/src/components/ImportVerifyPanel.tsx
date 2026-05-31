import { type VerifyResult, decodeToken, verifySlate } from "@openslate/core";
import { useLiveQuery } from "@tanstack/react-db";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { slatesCollection, upsertKnownIdentity } from "../lib/collections";
import { parseScanned } from "../lib/qr";
import { slateFromUrlOptions } from "../lib/query";
import { ScanQrButton } from "./Qr";

export function ImportVerifyPanel() {
  const { data: slates } = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  const queryClient = useQueryClient();
  const [input, setInput] = useState("");
  const [url, setUrl] = useState("");
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  function verify(token: string) {
    setSaved(null);
    setResult(verifySlate(token));
  }

  async function loadFromUrl() {
    try {
      const text = await queryClient.fetchQuery(slateFromUrlOptions(url));
      setInput(text);
      verify(text);
    } catch (err) {
      setResult({
        valid: false,
        errors: [err instanceof Error ? err.message : String(err)],
        warnings: [],
      });
    }
  }

  async function loadFromFile(file: File | undefined) {
    if (!file) return;
    const text = (await file.text()).trim();
    setInput(text);
    verify(text);
  }

  function handleQrScan(raw: string) {
    const parsed = parseScanned(raw);
    if (parsed.kind === "slate") {
      setInput(parsed.token);
      verify(parsed.token);
    } else if (parsed.kind === "contact") {
      setResult({
        valid: false,
        errors: ["Scanned a contact key, not a slate — use the Identity tab to add contacts."],
        warnings: [],
      });
    } else {
      setResult({
        valid: false,
        errors: ["Couldn't recognise that QR code."],
        warnings: [],
      });
    }
  }

  function save() {
    const token = input.trim();
    if (!token) {
      setSaved("Nothing to save.");
      return;
    }
    if (slates.some((slate) => slate.token === token)) {
      setSaved("Already in your collection.");
      return;
    }
    slatesCollection.insert({ token, importedAt: new Date().toISOString() });
    // Auto-register the issuer as a known contact so they show up in the directory
    // and we can recognize their future slates. Only first-time inserts seed a name.
    if (result?.valid && result.issuerKey) {
      upsertKnownIdentity(result.issuerKey, {
        displayName: result.payload?.issuer.name,
        source: "from-slate",
      });
    }
    setSaved("Saved to your collection.");
  }

  return (
    <section className="panel">
      <h2>Import &amp; verify</h2>
      <p className="hint">
        Paste a block, load one from a URL, or open a file. Verification is cryptographic and
        happens entirely in your browser.
      </p>

      <div className="card">
        <label>
          Block
          <textarea
            rows={6}
            className="token"
            placeholder="paste an OpenSlate block here"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
        <div className="row">
          <button type="button" className="primary" onClick={() => verify(input)}>
            Verify
          </button>
          <button type="button" onClick={save} disabled={!result?.valid}>
            Save to collection
          </button>
          <ScanQrButton onScan={handleQrScan} label="Scan QR slate" />
          <input
            type="file"
            accept=".txt,.json,application/json,text/plain"
            onChange={(e) => loadFromFile(e.target.files?.[0])}
          />
        </div>
        <div className="row">
          <input
            type="url"
            placeholder="https://example.org/my-slate.txt"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <button type="button" onClick={loadFromUrl} disabled={!url.trim()}>
            Load from URL
          </button>
        </div>
        {saved && <p className="hint">{saved}</p>}
      </div>

      {result && <VerifyResultView result={result} token={input.trim()} />}
    </section>
  );
}

function VerifyResultView({ result, token }: { result: VerifyResult; token: string }) {
  return (
    <div className={`card result ${result.valid ? "ok" : "bad"}`}>
      <div className="card-title">
        <strong>{result.valid ? "VALID" : "INVALID"}</strong>
        {result.issuerKey && <code className="key">{result.issuerKey}</code>}
      </div>
      {result.payload?.issuer.name && (
        <div>
          {result.payload.issuer.name} <span className="hint">(self-asserted)</span>
        </div>
      )}
      {result.errors.map((error) => (
        <p key={error} className="error">
          {error}
        </p>
      ))}
      {result.warnings.map((warning) => (
        <p key={warning} className="warning">
          {warning}
        </p>
      ))}
      {result.payload && (
        <ul className="position-list">
          {result.payload.positions.map((position, index) => (
            <li key={`${position.subject.title}-${index}`}>
              <span className={`stance stance-${position.stance}`}>{position.stance}</span>
              <span className="position-subject">
                {position.subject.title}
                {position.choice ? ` → ${position.choice}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {token && <RawInspector token={token} />}
    </div>
  );
}

/** Collapsible peek at the JWS decoded header + payload, for the curious. */
export function RawInspector({ token }: { token: string }) {
  let decoded: string;
  try {
    const { header, payload, signature } = decodeToken(token);
    decoded = JSON.stringify(
      {
        header,
        payload,
        signatureBytes: signature.length,
      },
      null,
      2,
    );
  } catch (err) {
    decoded = `Could not decode: ${err instanceof Error ? err.message : String(err)}`;
  }
  return (
    <details>
      <summary>Show raw decoded data</summary>
      <pre className="token raw-decoded">{decoded}</pre>
    </details>
  );
}
