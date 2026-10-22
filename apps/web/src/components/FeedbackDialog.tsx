import { useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  FEEDBACK_KINDS,
  type FeedbackKind,
  MAX_MESSAGE_LENGTH,
  buildFeedbackReport,
  closeFeedback,
  githubIssueUrl,
  privateFeedbackConfig,
  sendPrivateFeedback,
} from "../lib/feedback";
import { captureViewport, fitImage } from "../lib/screenshot";
import type { RouteTemplate } from "../lib/usage";
import { Checkbox } from "./ui/Checkbox";
import { FileDrop } from "./ui/FileDrop";
import { Segmented } from "./ui/Segmented";
import { TextArea, TextField } from "./ui/TextField";

/**
 * Kept across closing and reopening the dialog (but not a reload), so an
 * accidental Escape doesn't throw away what was typed. Cleared once sent.
 */
const draft: { kind: FeedbackKind; message: string; email: string } = {
  kind: "problem",
  message: "",
  email: "",
};

interface Screenshot {
  blob: Blob;
  /** Object URL for the preview; revoked when replaced or removed. */
  url: string;
  source: "page" | "file";
}

type Sending = { state: "idle" } | { state: "sending" } | { state: "error"; error: string };

/**
 * "Send feedback": one message, sent privately to the developer or opened as
 * a public GitHub issue. A screenshot is offered for private reports only,
 * never taken unless asked for, and shown before it can be sent.
 */
export function FeedbackDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const config = useMemo(() => privateFeedbackConfig(), []);
  const route = useRouterState({
    select: (state): RouteTemplate | null => {
      const id = state.matches.at(-1)?.routeId;
      return id && id !== "__root__" ? id : null;
    },
  });

  const [kind, setKind] = useState(draft.kind);
  const [message, setMessage] = useState(draft.message);
  const [email, setEmail] = useState(draft.email);
  const [shot, setShot] = useState<Screenshot | null>(null);
  const [shotWanted, setShotWanted] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [shotError, setShotError] = useState<string | null>(null);
  const [sending, setSending] = useState<Sending>({ state: "idle" });
  const [sent, setSent] = useState(false);

  useEffect(() => {
    draft.kind = kind;
    draft.message = message;
    draft.email = email;
  }, [kind, message, email]);

  // A modal <dialog> traps focus, makes the page behind it inert and turns
  // Escape into `cancel`. `showModal` focuses the first control (the type
  // picker), so move on to the message box, which is what people came to use.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    dialog?.querySelector("textarea")?.focus();
    return () => dialog?.close();
  }, []);

  // Free the preview's memory when it's replaced and when the dialog closes.
  useEffect(() => {
    return () => {
      if (shot) URL.revokeObjectURL(shot.url);
    };
  }, [shot]);

  useEffect(() => {
    if (sent) headingRef.current?.focus();
  }, [sent]);

  const info = FEEDBACK_KINDS.find((k) => k.id === kind) ?? FEEDBACK_KINDS[0];
  const trimmed = message.trim();
  const tooLong = message.length > MAX_MESSAGE_LENGTH;
  const issueUrl = githubIssueUrl({ kind, message, route });

  function keepImage(blob: Blob, source: Screenshot["source"]) {
    setShot({ blob, url: URL.createObjectURL(blob), source });
    setShotError(null);
  }

  async function takeScreenshot() {
    setCapturing(true);
    setShotError(null);
    const blob = await captureViewport(dialogRef.current);
    setCapturing(false);
    if (blob) keepImage(blob, "page");
    else setShotError("Couldn't take a screenshot of this page. You can attach an image instead.");
  }

  async function attachFile(file: File) {
    if (!file.type.startsWith("image/")) {
      setShotError("That isn't an image.");
      return;
    }
    const blob = await fitImage(file);
    if (blob) keepImage(blob, "file");
    else setShotError("Couldn't read that image, or it's too big to send.");
  }

  function setShotWantedAndCapture(wanted: boolean) {
    setShotWanted(wanted);
    if (!wanted) {
      setShot(null);
      setShotError(null);
    } else if (!shot) {
      void takeScreenshot();
    }
  }

  async function send() {
    if (!config || !trimmed || tooLong) return;
    setSending({ state: "sending" });
    const report = buildFeedbackReport({ kind, message, email, route });
    const result = await sendPrivateFeedback(config, report, shotWanted ? shot?.blob : null);
    if (result.ok) {
      draft.message = "";
      draft.email = "";
      setSent(true);
      setSending({ state: "idle" });
    } else {
      setSending({ state: "error", error: result.error });
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="feedback-dialog"
      aria-labelledby="feedback-heading"
      onCancel={(e) => {
        e.preventDefault();
        closeFeedback();
      }}
    >
      {sent ? (
        <>
          <h2 id="feedback-heading" ref={headingRef} tabIndex={-1}>
            Thanks, it's sent
          </h2>
          <p>Your feedback went to the OpenSlate developer.</p>
          <div className="feedback-footer">
            <button type="button" className="primary" onClick={closeFeedback}>
              Close
            </button>
          </div>
        </>
      ) : (
        <>
          <h2 id="feedback-heading">Send feedback</h2>

          <Segmented
            aria-label="What kind of feedback"
            options={FEEDBACK_KINDS.map((k) => ({ id: k.id, label: k.label }))}
            value={kind}
            onChange={setKind}
          />

          <TextArea
            label="Your message"
            value={message}
            onChange={setMessage}
            placeholder={info?.placeholder}
            rows={5}
            errorMessage={
              tooLong ? `Keep it under ${MAX_MESSAGE_LENGTH.toLocaleString()} characters.` : null
            }
          />

          <section className="feedback-route" aria-labelledby="feedback-private">
            <h3 id="feedback-private">Send it privately</h3>
            {config ? (
              <>
                <p className="hint">
                  Only the developer sees it. Along with your message we send which screen you were
                  on (not what was on it), this version of OpenSlate, the feedback type, and
                  anything you add below. The server also records your browser type and country.
                </p>

                <TextField
                  label="Email (optional)"
                  description="Only if you'd like a reply."
                  type="email"
                  inputMode="email"
                  value={email}
                  onChange={setEmail}
                />

                <Checkbox isSelected={shotWanted} onChange={setShotWantedAndCapture}>
                  Include a screenshot
                </Checkbox>

                {shotWanted && (
                  <div className="feedback-shot">
                    {capturing && <p className="hint">Taking a screenshot…</p>}
                    {shot && (
                      <>
                        <p className="warning">
                          This is exactly what will be sent. Check it first: it may show your picks,
                          your address or other things you'd rather keep private.
                        </p>
                        <a href={shot.url} target="_blank" rel="noreferrer">
                          <img
                            className="feedback-shot-preview"
                            src={shot.url}
                            alt={
                              shot.source === "page"
                                ? "Screenshot of this page, to be sent with your feedback"
                                : "Your image, to be sent with your feedback"
                            }
                          />
                        </a>
                      </>
                    )}
                    {shotError && (
                      <p className="error" role="alert">
                        {shotError}
                      </p>
                    )}
                    <div className="row">
                      <button type="button" onClick={takeScreenshot} disabled={capturing}>
                        {shot?.source === "page" ? "Retake" : "Screenshot this page"}
                      </button>
                      <FileDrop
                        accept={["image/png", "image/jpeg", "image/webp", "image/gif"]}
                        onFile={attachFile}
                        label="Attach an image instead"
                        hint="or drop one here"
                      />
                    </div>
                  </div>
                )}

                {sending.state === "error" && (
                  <p className="error" role="alert">
                    {sending.error} Nothing was lost: try again, or post it on GitHub below.
                  </p>
                )}
                <div className="row">
                  <button
                    type="button"
                    className="primary"
                    onClick={send}
                    disabled={!trimmed || tooLong || capturing || sending.state === "sending"}
                  >
                    {sending.state === "sending" ? "Sending…" : "Send privately"}
                  </button>
                </div>
              </>
            ) : (
              <p className="hint">
                This copy of OpenSlate isn't set up to receive private feedback.
              </p>
            )}
          </section>

          <section className="feedback-route" aria-labelledby="feedback-public">
            <h3 id="feedback-public">Or post it on GitHub</h3>
            <p className="hint">
              Opens a new issue with your message filled in. Nothing is posted until you submit it
              there. Issues are public, and you need a GitHub account. To add a screenshot, paste it
              into the issue.
            </p>
            <div className="row">
              <a className="button-link" href={issueUrl} target="_blank" rel="noreferrer">
                Open a GitHub issue
              </a>
            </div>
          </section>

          <div className="feedback-footer">
            <button type="button" onClick={closeFeedback}>
              Close
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}
