import type { ReactNode } from "react";
import { ProgressBar as AriaProgressBar, Label } from "react-aria-components";
import { cx } from "./cx";

/**
 * How far along a wait is. Screen readers hear the label and a percentage.
 * Without a `maxValue` (the total isn't known yet) the bar is indeterminate:
 * it slides rather than fills.
 */
export function ProgressBar({
  label,
  value,
  maxValue,
  className,
}: {
  /** What is loading, shown above the bar. */
  label: ReactNode;
  value: number;
  maxValue?: number;
  className?: string;
}) {
  const indeterminate = !maxValue;
  return (
    <AriaProgressBar
      className={cx("ui-progress", className)}
      value={value}
      maxValue={maxValue || 1}
      isIndeterminate={indeterminate}
    >
      {({ percentage, valueText }) => (
        <>
          <span className="ui-progress-label">
            <Label>{label}</Label>
            {!indeterminate && <span className="ui-progress-value">{valueText}</span>}
          </span>
          <span className="ui-progress-track" aria-hidden="true">
            <span
              className="ui-progress-fill"
              style={indeterminate ? undefined : { width: `${percentage ?? 0}%` }}
            />
          </span>
        </>
      )}
    </AriaProgressBar>
  );
}
