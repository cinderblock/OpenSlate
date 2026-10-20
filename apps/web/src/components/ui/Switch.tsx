import type { ReactNode } from "react";
import { Switch as AriaSwitch, type SwitchProps as AriaSwitchProps } from "react-aria-components";
import { cx } from "./cx";

export interface SwitchProps extends Omit<AriaSwitchProps, "children" | "className"> {
  /** Visible label beside the switch. Without one, pass `aria-label`. */
  children?: ReactNode;
  className?: string;
}

/**
 * An on/off setting that takes effect immediately (follow a source, share
 * usage statistics). For "include this item in a set", use Checkbox.
 */
export function Switch({ children, className, ...props }: SwitchProps) {
  return (
    <AriaSwitch {...props} className={cx("ui-switch", className)}>
      <span className="ui-switch-track" aria-hidden="true">
        <span className="ui-switch-thumb" />
      </span>
      {children != null && <span className="ui-switch-label">{children}</span>}
    </AriaSwitch>
  );
}
