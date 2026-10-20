import type { ReactNode } from "react";
import {
  Checkbox as AriaCheckbox,
  type CheckboxProps as AriaCheckboxProps,
} from "react-aria-components";
import { cx } from "./cx";

export interface CheckboxProps extends Omit<AriaCheckboxProps, "children" | "className"> {
  children?: ReactNode;
  className?: string;
  /**
   * `card`: the whole row is the control and lights up when checked, for
   * picking several items from a list.
   */
  variant?: "plain" | "card";
}

/** Include or leave out one item. For a setting that takes effect, use Switch. */
export function Checkbox({ children, className, variant = "plain", ...props }: CheckboxProps) {
  return (
    <AriaCheckbox
      {...props}
      className={cx("ui-checkbox", variant === "card" && "ui-option-card", className)}
    >
      <span className="ui-checkbox-box" aria-hidden="true">
        <svg viewBox="0 0 16 16" className="ui-checkbox-mark" aria-hidden="true">
          <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
        </svg>
      </span>
      {children}
    </AriaCheckbox>
  );
}
