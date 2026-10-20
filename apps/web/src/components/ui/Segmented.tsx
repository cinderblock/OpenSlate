import type { ReactNode } from "react";
import { Label, Radio, RadioGroup } from "react-aria-components";
import { cx } from "./cx";

export interface SegmentedProps<K extends string> {
  /** Visible label before the segments. Without one, pass `aria-label`. */
  label?: ReactNode;
  "aria-label"?: string;
  options: Array<{ id: K; label: ReactNode }>;
  value: K;
  onChange: (value: K) => void;
  className?: string;
  /** `stacked`: label above, like the other fields in a form grid. Default `inline`. */
  layout?: "inline" | "stacked";
}

/** Two to four mutually exclusive choices shown side by side. A radio group underneath. */
export function Segmented<K extends string>({
  label,
  options,
  value,
  onChange,
  className,
  layout = "inline",
  "aria-label": ariaLabel,
}: SegmentedProps<K>) {
  return (
    <RadioGroup
      className={cx(
        "ui-segmented-field",
        layout === "stacked" && "ui-segmented-stacked",
        className,
      )}
      orientation="horizontal"
      value={value}
      onChange={(next) => onChange(next as K)}
      aria-label={ariaLabel}
    >
      {label != null && <Label className="ui-segmented-label">{label}</Label>}
      <span className="ui-segmented">
        {options.map((option) => (
          <Radio key={option.id} value={option.id} className="ui-segment">
            {option.label}
          </Radio>
        ))}
      </span>
    </RadioGroup>
  );
}
