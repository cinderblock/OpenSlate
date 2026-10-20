import { type KeyboardEvent, type ReactNode, useLayoutEffect, useRef, useState } from "react";
import {
  SearchField as AriaSearchField,
  TextArea as AriaTextArea,
  TextField as AriaTextField,
  Button,
  FieldError,
  Input,
  Label,
  Text,
} from "react-aria-components";
import { cx } from "./cx";

interface FieldProps {
  /** Visible label above the field. Without one, pass `aria-label`. */
  label?: ReactNode;
  "aria-label"?: string;
  /** Help text under the field. */
  description?: ReactNode;
  /** Shown under the field, in red, and marks the field invalid. */
  errorMessage?: string | null;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onKeyDown?: (event: KeyboardEvent) => void;
  placeholder?: string;
  isDisabled?: boolean;
  isReadOnly?: boolean;
  autoFocus?: boolean;
  /** Monospace text, for keys, tokens and JSON. */
  monospace?: boolean;
  /** No box until hovered or focused: for editing in place inside a list row. */
  quiet?: boolean;
  className?: string;
}

function FieldFooter({
  description,
  errorMessage,
}: Pick<FieldProps, "description" | "errorMessage">) {
  return (
    <>
      {description != null && !errorMessage && (
        <Text slot="description" className="ui-description">
          {description}
        </Text>
      )}
      <FieldError className="ui-error">{errorMessage}</FieldError>
    </>
  );
}

function fieldClass(props: FieldProps, kind: string) {
  return cx(
    "ui-field",
    kind,
    props.monospace && "ui-mono",
    props.quiet && "ui-quiet",
    props.className,
  );
}

export interface TextFieldProps extends FieldProps {
  type?: "text" | "url" | "email";
  /** Inside the box, before the text: an icon or a fixed part of the value. */
  prefix?: ReactNode;
  /** Inside the box, after the text: a unit, a status mark, a small button. */
  suffix?: ReactNode;
  inputMode?: "text" | "url" | "email" | "search" | "numeric";
}

/** One line of text, with optional decoration inside the box. */
export function TextField(props: TextFieldProps) {
  const { label, description, errorMessage, prefix, suffix } = props;
  return (
    <AriaTextField
      className={fieldClass(props, "ui-textfield")}
      value={props.value}
      onChange={props.onChange}
      onBlur={props.onBlur}
      onKeyDown={props.onKeyDown}
      type={props.type}
      inputMode={props.inputMode}
      isDisabled={props.isDisabled}
      isReadOnly={props.isReadOnly}
      isInvalid={!!errorMessage}
      autoFocus={props.autoFocus}
      aria-label={props["aria-label"]}
    >
      {label != null && <Label className="ui-label">{label}</Label>}
      <div className="ui-input-group">
        {prefix != null && <span className="ui-affix ui-prefix">{prefix}</span>}
        <Input className="ui-input" placeholder={props.placeholder} />
        {suffix != null && <span className="ui-affix ui-suffix">{suffix}</span>}
      </div>
      <FieldFooter description={description} errorMessage={errorMessage} />
    </AriaTextField>
  );
}

function isWebUrl(text: string): boolean {
  try {
    const { protocol } = new URL(text);
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

/** A web link. Shows a link mark, and says so if what was typed isn't a full http(s) URL. */
export function UrlField(props: Omit<TextFieldProps, "type" | "prefix" | "errorMessage">) {
  const [touched, setTouched] = useState(false);
  const text = props.value.trim();
  const bad = touched && text !== "" && !isWebUrl(text);
  return (
    <TextField
      {...props}
      type="url"
      inputMode="url"
      prefix={
        <svg className="ui-link-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6.5 9.5l3-3M7 4.5l1-1a2.8 2.8 0 0 1 4 4l-1 1M9 11.5l-1 1a2.8 2.8 0 0 1-4-4l1-1" />
        </svg>
      }
      onBlur={() => {
        setTouched(true);
        props.onBlur?.();
      }}
      errorMessage={bad ? "Enter a full link, starting with https://" : undefined}
    />
  );
}

export interface SearchFieldProps
  extends Omit<FieldProps, "monospace" | "quiet" | "isReadOnly" | "errorMessage"> {
  onSubmit?: (value: string) => void;
}

/** A filter box: magnifier, and a clear button once there's text. Escape clears too. */
export function SearchField(props: SearchFieldProps) {
  const { label, description } = props;
  return (
    <AriaSearchField
      className={cx("ui-field ui-searchfield", props.className)}
      value={props.value}
      onChange={props.onChange}
      onSubmit={props.onSubmit}
      onBlur={props.onBlur}
      onKeyDown={props.onKeyDown}
      isDisabled={props.isDisabled}
      autoFocus={props.autoFocus}
      aria-label={props["aria-label"] ?? props.placeholder}
    >
      {label != null && <Label className="ui-label">{label}</Label>}
      <div className="ui-input-group">
        <svg className="ui-affix ui-search-icon" viewBox="0 0 16 16" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" />
          <line x1="10.5" y1="10.5" x2="14" y2="14" />
        </svg>
        <Input className="ui-input" placeholder={props.placeholder} />
        <Button className="ui-search-clear" aria-label="Clear search">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <line x1="4.5" y1="4.5" x2="11.5" y2="11.5" />
            <line x1="11.5" y1="4.5" x2="4.5" y2="11.5" />
          </svg>
        </Button>
      </div>
      <FieldFooter description={description} />
    </AriaSearchField>
  );
}

export interface TextAreaProps extends FieldProps {
  /** Starting height in lines; the box grows with its content. */
  rows?: number;
  /** Stop growing at this many lines and scroll instead. */
  maxRows?: number;
}

/** Several lines of text. Grows as you type, so nothing hides behind a scrollbar. */
export function TextArea(props: TextAreaProps) {
  const { label, description, errorMessage, rows = 2, maxRows = 16 } = props;
  const ref = useRef<HTMLTextAreaElement>(null);

  // Fit the box to its content. Runs after every value change, including ones
  // that come from outside (a cleared form, a loaded file).
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-measure when the text changes
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const style = getComputedStyle(el);
    const px = (value: string) => Number.parseFloat(value) || 0;
    const line = px(style.lineHeight) || 20;
    const border = px(style.borderTopWidth) + px(style.borderBottomWidth);
    // border-box sizing: scrollHeight covers content + padding, not border.
    const max = line * maxRows + px(style.paddingTop) + px(style.paddingBottom) + border;
    const wanted = el.scrollHeight + border;
    el.style.height = `${Math.min(wanted, max)}px`;
    el.style.overflowY = wanted > max ? "auto" : "hidden";
  }, [props.value, maxRows]);

  return (
    <AriaTextField
      className={fieldClass(props, "ui-textareafield")}
      value={props.value}
      onChange={props.onChange}
      onBlur={props.onBlur}
      onKeyDown={props.onKeyDown}
      isDisabled={props.isDisabled}
      isReadOnly={props.isReadOnly}
      isInvalid={!!errorMessage}
      autoFocus={props.autoFocus}
      aria-label={props["aria-label"]}
    >
      {label != null && <Label className="ui-label">{label}</Label>}
      <AriaTextArea ref={ref} className="ui-textarea" rows={rows} placeholder={props.placeholder} />
      <FieldFooter description={description} errorMessage={errorMessage} />
    </AriaTextField>
  );
}
