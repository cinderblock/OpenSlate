import type { ReactNode } from "react";
import {
  Radio as AriaRadio,
  RadioGroup as AriaRadioGroup,
  type RadioGroupProps as AriaRadioGroupProps,
  type RadioProps as AriaRadioProps,
  Label,
} from "react-aria-components";
import { cx } from "./cx";

export interface RadioGroupProps extends Omit<AriaRadioGroupProps, "children" | "className"> {
  /** Visible group label. Without one, pass `aria-label`. */
  label?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Pick exactly one. Arrow keys move between options; Tab leaves the group.
 * Options can sit anywhere inside (list rows, cards), not just as siblings.
 */
export function RadioGroup({ label, children, className, ...props }: RadioGroupProps) {
  return (
    <AriaRadioGroup {...props} className={cx("ui-radio-group", className)}>
      {label != null && <Label className="ui-group-label">{label}</Label>}
      {children}
    </AriaRadioGroup>
  );
}

export interface RadioProps extends Omit<AriaRadioProps, "children" | "className"> {
  children?: ReactNode;
  className?: string;
  /** `card`: the whole row is the control and lights up when chosen. */
  variant?: "plain" | "card";
}

export function Radio({ children, className, variant = "plain", ...props }: RadioProps) {
  return (
    <AriaRadio
      {...props}
      className={cx("ui-radio", variant === "card" && "ui-option-card", className)}
    >
      <span className="ui-radio-dot" aria-hidden="true" />
      {children}
    </AriaRadio>
  );
}
