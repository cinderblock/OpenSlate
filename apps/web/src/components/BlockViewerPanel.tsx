import { decodeToken } from "@openslate/core";
import { useMemo, useState } from "react";

export function BlockViewerPanel() {
  const [input, setInput] = useState("");
  const token = input.trim();

  const view = useMemo(() => {
    if (!token) return { state: "empty" as const };
    const segments = token.split(".");
    const [headerSeg = "", payloadSeg = "", signatureSeg = ""] = segments;
    try {
      const decoded = decodeToken(token);
      return {
        state: "ok" as const,
        headerSeg,
        payloadSeg,
        signatureSeg,
        segCount: segments.length,
        decoded,
      };
    } catch (err) {
      return {
        state: "error" as const,
        message: err instanceof Error ? err.message : String(err),
        headerSeg,
        payloadSeg,
        signatureSeg,
        segCount: segments.length,
      };
    }
  }, [token]);

  return (
    <section className="panel">
      <h2>Block viewer</h2>
      <p className="hint">
        Paste any OpenSlate block to inspect its three base64url segments and the decoded JSON.
        Verification + position-list views live in <em>Import & verify</em>; this view is for the
        encoded text itself.
      </p>

      <div className="card">
        <label>
          Block
          <textarea
            rows={6}
            className="token"
            placeholder="paste an OpenSlate block here…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
        </label>
      </div>

      {view.state === "empty" && <p className="hint">Nothing pasted yet.</p>}

      {view.state !== "empty" && (
        <div className="card">
          <h3>Encoded</h3>
          <p className="token jws-encoded">
            <span className="jws-header">{view.headerSeg}</span>
            <span className="jws-sep">.</span>
            <span className="jws-payload">{view.payloadSeg}</span>
            <span className="jws-sep">.</span>
            <span className="jws-signature">{view.signatureSeg}</span>
          </p>
          <p className="hint">
            {token.length} chars · {view.segCount} segments
            {view.segCount !== 3 && (
              <span className="error"> — expected 3 (header.payload.signature)</span>
            )}
            {view.headerSeg && <> · header {view.headerSeg.length}</>}
            {view.payloadSeg && <> · payload {view.payloadSeg.length}</>}
            {view.signatureSeg && <> · signature {view.signatureSeg.length}</>}
          </p>
        </div>
      )}

      {view.state === "error" && (
        <div className="card result bad">
          <p className="error">{view.message}</p>
        </div>
      )}

      {view.state === "ok" && (
        <>
          <div className="card">
            <h3 className="jws-header">Header (decoded)</h3>
            <pre className="token raw-decoded">{JSON.stringify(view.decoded.header, null, 2)}</pre>
          </div>
          <div className="card">
            <h3 className="jws-payload">Payload (decoded)</h3>
            <pre className="token raw-decoded">{JSON.stringify(view.decoded.payload, null, 2)}</pre>
          </div>
          <div className="card">
            <h3 className="jws-signature">Signature</h3>
            <p className="hint">{view.decoded.signature.length} bytes (Ed25519 is 64)</p>
            <p className="token raw-decoded">
              hex:{" "}
              {Array.from(view.decoded.signature, (b) => b.toString(16).padStart(2, "0")).join("")}
            </p>
            <p className="token raw-decoded">base64url: {view.signatureSeg}</p>
          </div>
        </>
      )}
    </section>
  );
}
