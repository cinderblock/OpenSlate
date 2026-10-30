import { NumberField as AriaNumberField, Button, Group, Input, Label } from "react-aria-components";
import { cx } from "./cx";

export interface NumberFieldProps {
  /** Visible label above the field. Without one, pass `aria-label`. */
  label?: string;
  "aria-label"?: string;
  value: number;
  /** Called with a finite number, on Enter, on blur or on a step. */
  onChange: (value: number) => void;
  isDisabled?: boolean;
  className?: string;
}

/** Any number, typed or stepped by one. No limits, and fractions stay as typed. */
export function NumberField(props: NumberFieldProps) {
  const { label } = props;
  return (
    <AriaNumberField
      className={cx("ui-field ui-numberfield", props.className)}
      value={props.value}
      // Emptied: keep what it was. No `step`: one would round what's typed to it.
      onChange={(next) => {
        if (Number.isFinite(next)) props.onChange(next);
      }}
      formatOptions={{ useGrouping: false, maximumFractionDigits: 6 }}
      isDisabled={props.isDisabled}
      aria-label={props["aria-label"]}
    >
      {label != null && <Label className="ui-label">{label}</Label>}
      <Group className="ui-input-group">
        <Button slot="decrement" className="ui-numberfield-step">
          −
        </Button>
        <Input className="ui-input" />
        <Button slot="increment" className="ui-numberfield-step">
          +
        </Button>
      </Group>
    </AriaNumberField>
  );
}
