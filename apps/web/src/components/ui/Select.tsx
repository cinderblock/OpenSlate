import type { ReactNode } from "react";
import {
  ComboBox as AriaComboBox,
  Select as AriaSelect,
  Button,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  Popover,
  SelectValue,
  Text,
  useFilter,
} from "react-aria-components";
import { cx } from "./cx";

/** One choice in a Select or ComboBox. Everything but `id` and `label` is optional. */
export interface SelectOption<K extends string = string> {
  id: K;
  /** Main line, shown in the list and (unless `valueLabel` is set) on the closed control. */
  label: ReactNode;
  /** Plain text for typeahead, filtering and screen readers. Required when `label` isn't a string. */
  textValue?: string;
  /** Second, quieter line in the list. */
  description?: ReactNode;
  /** Right-aligned extra (a count, a tag). */
  badge?: ReactNode;
  /** What the closed control shows, when it should differ from `label`. */
  valueLabel?: ReactNode;
  className?: string;
  isDisabled?: boolean;
}

function textOf(option: SelectOption): string {
  if (option.textValue) return option.textValue;
  if (typeof option.label === "string") return option.label;
  return option.id;
}

function Chevron() {
  return (
    <svg className="ui-chevron" viewBox="0 0 16 16" aria-hidden="true">
      <polyline points="4 6 8 10 12 6" />
    </svg>
  );
}

function OptionContent({ option, isSelected }: { option: SelectOption; isSelected: boolean }) {
  return (
    <>
      <span className="ui-option-check" aria-hidden="true">
        {isSelected && (
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <polyline points="3.5 8.5 6.5 11.5 12.5 4.5" />
          </svg>
        )}
      </span>
      <span className="ui-option-main">
        <Text slot="label" className="ui-option-label">
          {option.label}
        </Text>
        {option.description != null && (
          <Text slot="description" className="ui-option-description">
            {option.description}
          </Text>
        )}
      </span>
      {option.badge != null && <span className="ui-option-badge">{option.badge}</span>}
    </>
  );
}

function OptionList<K extends string>({ options }: { options: SelectOption<K>[] }) {
  return (
    <ListBox className="ui-listbox" items={options}>
      {(option) => (
        <ListBoxItem
          id={option.id}
          textValue={textOf(option)}
          isDisabled={option.isDisabled}
          className={cx("ui-option", option.className)}
        >
          {({ isSelected }) => <OptionContent option={option} isSelected={isSelected} />}
        </ListBoxItem>
      )}
    </ListBox>
  );
}

interface CommonProps<K extends string> {
  /** Visible label above the control. Without one, pass `aria-label`. */
  label?: ReactNode;
  "aria-label"?: string;
  options: SelectOption<K>[];
  /** The chosen id; null or undefined shows the placeholder. */
  value: K | null | undefined;
  onChange: (value: K) => void;
  placeholder?: string;
  isDisabled?: boolean;
  className?: string;
}

/**
 * Pick one from a short list. Unlike a native <select>, each option can carry
 * a description, a badge and its own styling.
 */
export function Select<K extends string>({
  label,
  options,
  value,
  onChange,
  placeholder,
  isDisabled,
  className,
  "aria-label": ariaLabel,
}: CommonProps<K>) {
  return (
    <AriaSelect<SelectOption<K>>
      className={cx("ui-field ui-select", className)}
      value={value ?? null}
      onChange={(key) => {
        if (key != null) onChange(key as K);
      }}
      placeholder={placeholder}
      isDisabled={isDisabled}
      aria-label={ariaLabel}
    >
      {label != null && <Label className="ui-label">{label}</Label>}
      <Button className="ui-select-trigger">
        <SelectValue<SelectOption<K>> className="ui-select-value">
          {({ selectedItem, isPlaceholder }) =>
            isPlaceholder || !selectedItem ? (
              <span className="ui-placeholder">{placeholder}</span>
            ) : (
              <>
                <span className={cx("ui-select-value-label", selectedItem.className)}>
                  {selectedItem.valueLabel ?? selectedItem.label}
                </span>
                {selectedItem.badge != null && (
                  <span className="ui-option-badge">{selectedItem.badge}</span>
                )}
              </>
            )
          }
        </SelectValue>
        <Chevron />
      </Button>
      <Popover className="ui-popover" offset={4}>
        <OptionList options={options} />
      </Popover>
    </AriaSelect>
  );
}

export interface ComboBoxProps<K extends string> extends CommonProps<K> {
  /** Options that stay in the list whatever is typed (e.g. "+ New …"). */
  alwaysShow?: (option: SelectOption<K>) => boolean;
  /** Called as the user types, e.g. to carry the text into a "new item" form. */
  onInputChange?: (text: string) => void;
}

/** A Select you can type into to filter a long list. */
export function ComboBox<K extends string>({
  label,
  options,
  value,
  onChange,
  placeholder,
  isDisabled,
  className,
  alwaysShow,
  onInputChange,
  "aria-label": ariaLabel,
}: ComboBoxProps<K>) {
  const { contains } = useFilter({ sensitivity: "base" });
  return (
    <AriaComboBox
      className={cx("ui-field ui-combobox", className)}
      defaultItems={options}
      selectedKey={value ?? null}
      onSelectionChange={(key) => {
        if (key != null) onChange(key as K);
      }}
      onInputChange={onInputChange}
      defaultFilter={(text, input) =>
        // Every typed word, in any order: "schools proposition" finds "Proposition 3 (… Schools …)".
        input
          .trim()
          .split(/\s+/)
          .every((word) => contains(text, word)) ||
        (alwaysShow != null && options.some((o) => textOf(o) === text && alwaysShow(o)))
      }
      menuTrigger="focus"
      isDisabled={isDisabled}
      aria-label={ariaLabel}
    >
      {label != null && <Label className="ui-label">{label}</Label>}
      <div className="ui-input-group">
        <Input className="ui-input" placeholder={placeholder} />
        <Button className="ui-combobox-button">
          <Chevron />
        </Button>
      </div>
      <Popover className="ui-popover" offset={4}>
        <ListBox<SelectOption<K>> className="ui-listbox" renderEmptyState={() => "No matches"}>
          {(option) => (
            <ListBoxItem
              id={option.id}
              textValue={textOf(option)}
              isDisabled={option.isDisabled}
              className={cx("ui-option", option.className)}
            >
              {({ isSelected }) => <OptionContent option={option} isSelected={isSelected} />}
            </ListBoxItem>
          )}
        </ListBox>
      </Popover>
    </AriaComboBox>
  );
}
