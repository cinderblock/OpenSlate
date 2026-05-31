import { useEffect, useRef, useState } from "react";
import { scanImageFile, toQrSvg } from "../lib/qr";

/**
 * Modal-style QR display. Renders the QR for `text` plus a collapsible raw-text
 * fallback for users whose scanner can't decode (or to copy/paste manually).
 */
export function QrDialog({
  text,
  label,
  onClose,
}: {
  text: string;
  label?: string;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [svg, setSvg] = useState("");

  useEffect(() => {
    let cancelled = false;
    void toQrSvg(text).then((s) => {
      if (!cancelled) setSvg(s);
    });
    return () => {
      cancelled = true;
    };
  }, [text]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    function handleClose() {
      onClose();
    }
    dialog.addEventListener("close", handleClose);
    return () => dialog.removeEventListener("close", handleClose);
  }, [onClose]);

  return (
    <dialog ref={ref} className="qr-dialog">
      <div className="qr-dialog-inner">
        {label && <h3>{label}</h3>}
        <div
          className="qr-canvas"
          // qrcode generates trusted SVG output we just rendered above.
          // biome-ignore lint/security/noDangerouslySetInnerHtml: SVG is generated locally by qrcode lib
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <details>
          <summary>Raw text</summary>
          <textarea readOnly rows={3} value={text} className="token" />
        </details>
        <div className="row">
          <button type="button" onClick={() => ref.current?.close()}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}

/**
 * A button that opens the file picker (or camera on mobile via `capture`).
 * On a successful decode, calls onScan with the raw decoded text.
 */
export function ScanQrButton({
  onScan,
  label = "Scan QR",
  className = "",
}: {
  onScan: (text: string) => void;
  label?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function pickFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setBusy(true);
    try {
      const text = await scanImageFile(file);
      if (text) onScan(text);
      else setError("No QR code found in that image.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "scan failed");
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={() => inputRef.current?.click()}
        disabled={busy}
      >
        {busy ? "Scanning…" : label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => pickFile(e.target.files?.[0])}
      />
      {error && <p className="error">{error}</p>}
    </>
  );
}
