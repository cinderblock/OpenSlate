import type { ReactNode } from "react";
import { ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { cx } from "./cx";

export interface ToggleGroupProps<K extends string> {
  "aria-label": string;
  options: Array<{ id: K; label: ReactNode; className?: string; isDisabled?: boolean }>;
  /** The pressed option, or null for none. */
  value: K | null;
  /** Pressing the pressed option again releases it: `null`. */
  onChange: (value: K | null) => void;
  isDisabled?: boolean;
  className?: string;
}

/**
 * Two or three joined toggle buttons, at most one pressed, where none pressed
 * is a choice too (follow a source, disagree with it, or neither). When one
 * must always be chosen, use Segmented.
 */
export function ToggleGroup<K extends string>({
  options,
  value,
  onChange,
  isDisabled,
  className,
  "aria-label": ariaLabel,
}: ToggleGroupProps<K>) {
  return (
    <ToggleButtonGroup
      className={cx("ui-toggle-group", className)}
      aria-label={ariaLabel}
      selectionMode="single"
      selectedKeys={value === null ? [] : [value]}
      onSelectionChange={(keys) => onChange(([...keys][0] as K | undefined) ?? null)}
      {...(isDisabled ? { isDisabled } : {})}
    >
      {options.map((option) => (
        <ToggleButton
          key={option.id}
          id={option.id}
          className={cx("ui-toggle", option.className)}
          {...(option.isDisabled ? { isDisabled: true } : {})}
        >
          {option.label}
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}
