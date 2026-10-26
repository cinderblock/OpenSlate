import { ThumbsDown, UserCheck } from "lucide-react";
import type { Standing } from "../lib/sources";
import { ToggleGroup } from "./ui/ToggleGroup";

/**
 * Follow a source, follow it to disagree, or neither (both released). The
 * same control on the Sources page, in the catalog and in setup.
 */
export function StandingToggle({
  name,
  value,
  onChange,
  isDisabled,
}: {
  /** The source's name, for the group's label. */
  name: string;
  value: Standing;
  onChange: (next: Standing) => void;
  isDisabled?: boolean;
}) {
  return (
    <ToggleGroup
      aria-label={`How ${name} counts on My ballot`}
      className="standing-toggle"
      value={value === "off" ? null : value}
      onChange={(next) => onChange(next ?? "off")}
      {...(isDisabled ? { isDisabled } : {})}
      options={[
        {
          id: "follow",
          className: "standing-follow",
          label: (
            <>
              <UserCheck className="icon" aria-hidden="true" /> Follow
            </>
          ),
        },
        {
          id: "disagree",
          className: "standing-disagree",
          label: (
            <>
              <ThumbsDown className="icon" aria-hidden="true" /> Disagree
            </>
          ),
        },
      ]}
    />
  );
}
