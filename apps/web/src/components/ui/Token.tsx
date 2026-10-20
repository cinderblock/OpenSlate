import { type ReactNode, useEffect, useId, useState } from "react";
import {
  TextArea as AriaTextArea,
  TextField as AriaTextField,
  Button,
  Label,
  Text,
} from "react-aria-components";
import { cx } from "./cx";

const SEGMENT_CLASS = ["jws-header", "jws-payload", "jws-signature"];

/**
 * A compact token (`header.payload.signature`) as coloured spans. Text after a
 * third dot is marked as extra. Whitespace is kept, so the spans line up with
 * the raw text character for character.
 */
function Segments({ text }: { text: string }) {
  const parts = text.split(".");
  return (
    <>
      {parts.map((part, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: segments are positional
        <span key={i}>
          {i > 0 && <span className="jws-sep">.</span>}
          <span className={SEGMENT_CLASS[i] ?? "jws-extra"}>{part}</span>
        </span>
      ))}
    </>
  );
}

const JWS_LIKE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

export interface TokenFieldProps {
  label?: ReactNode;
  "aria-label"?: string;
  description?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Starting height in lines. */
  rows?: number;
  className?: string;
}

/**
 * A box to paste a signed block into. As you type or paste, the header,
 * payload and signature segments take the same colours the block viewer
 * uses, so a truncated or doubled paste is visible at a glance.
 *
 * How: a transparent textarea sits exactly on top of a coloured copy of its
 * text. Both share font, padding and wrapping, so the caret and selection
 * line up with the colours underneath.
 */
export function TokenField({
  label,
  description,
  value,
  onChange,
  placeholder,
  rows = 4,
  className,
  "aria-label": ariaLabel,
}: TokenFieldProps) {
  return (
    <AriaTextField
      className={cx("ui-field ui-tokenfield", className)}
      value={value}
      onChange={onChange}
      aria-label={ariaLabel}
    >
      {label != null && <Label className="ui-label">{label}</Label>}
      <div className="ui-token-frame">
        <div className="ui-token-stack" style={{ minHeight: `${rows * 1.5}em` }}>
          <div className="ui-token-mirror token" aria-hidden="true">
            <Segments text={value} />
            {/* Keeps a trailing newline's empty last line in the height. */}
            {"​"}
          </div>
          <AriaTextArea
            className="ui-token-input token"
            placeholder={placeholder}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>
      </div>
      {description != null && (
        <Text slot="description" className="ui-description">
          {description}
        </Text>
      )}
    </AriaTextField>
  );
}

/** Copies `text` and says so for a moment. */
export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      className="ui-copy-button"
      onPress={() => {
        void navigator.clipboard.writeText(text).then(() => setCopied(true));
      }}
    >
      {copied ? "Copied!" : label}
    </Button>
  );
}

/**
 * Read-only display of a block or other long text: selectable with one click,
 * coloured by segment when it looks like a signed block, optional copy button.
 */
export function TokenBox({
  label,
  text,
  copyable = false,
  className,
}: {
  label?: ReactNode;
  text: string;
  copyable?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cx("ui-field ui-tokenbox", className)}>
      {label != null && (
        <span className="ui-label" id={id}>
          {label}
        </span>
      )}
      <div className="ui-token-frame">
        {/* A read-only textbox, as the old <textarea readonly> was; a textarea
            can't colour the segments. Focusable so keyboard users can scroll it. */}
        <div
          className="ui-token-display token"
          // biome-ignore lint/a11y/useSemanticElements: a <textarea> can't hold coloured spans
          role="textbox"
          aria-readonly="true"
          aria-multiline="true"
          aria-labelledby={label != null ? id : undefined}
          aria-label={label == null ? "Block" : undefined}
          tabIndex={0}
        >
          {JWS_LIKE.test(text) ? <Segments text={text} /> : text}
        </div>
        {copyable && <CopyButton text={text} />}
      </div>
    </div>
  );
}
