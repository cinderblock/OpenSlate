import type { ReactNode } from "react";
import { Button, Dialog, DialogTrigger, Popover } from "react-aria-components";
import { cx } from "./cx";

/**
 * Detail that opens on tap or click, for what would otherwise hide in a hover
 * tooltip (which touch screens never show). The trigger is a real button, so it
 * works from the keyboard too; Escape or a tap outside closes it.
 */
export function InfoPopover({
  trigger,
  label,
  className,
  bare = true,
  children,
}: {
  /** What the button shows: a chip, a meter, an icon. */
  trigger: ReactNode;
  /** The button's accessible name: what tapping it tells you about. */
  label: string;
  className?: string;
  /** No button look of its own: just its contents. Off when `className` styles it (a chip). */
  bare?: boolean;
  children: ReactNode;
}) {
  return (
    <DialogTrigger>
      <Button
        className={cx("ui-info-trigger", bare && "ui-info-bare", className)}
        aria-label={label}
      >
        {trigger}
      </Button>
      <Popover className="ui-popover ui-info-popover" offset={6}>
        <Dialog className="ui-info-dialog" aria-label={label}>
          {children}
        </Dialog>
      </Popover>
    </DialogTrigger>
  );
}
