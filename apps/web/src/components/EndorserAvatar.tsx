import { useState } from "react";
import { hueOf, initialsOf, useEndorser } from "../lib/endorsers";
import { cx } from "./ui/cx";

/**
 * An endorser's logo, or a coloured monogram when the catalog has none (or it
 * fails to load). Decorative: the name always sits beside it.
 */
export function EndorserAvatar({
  sourceId,
  name,
  size = "sm",
  logo: given,
  className,
}: {
  sourceId: string;
  name: string;
  size?: "sm" | "md" | "lg";
  /** A logo URL to use instead of the directory's (a catalog row from another catalog). */
  logo?: string;
  className?: string;
}) {
  const known = useEndorser(sourceId).logo;
  const logo = given ?? known;
  // Remember which logo failed, so a different one gets a fresh try.
  const [failed, setFailed] = useState<string>();
  if (logo && failed !== logo) {
    return (
      <span className={cx("avatar", `avatar-${size}`, "avatar-logo", className)} aria-hidden="true">
        <img
          src={logo}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setFailed(logo)}
        />
      </span>
    );
  }
  return (
    <span
      className={cx("avatar", `avatar-${size}`, "avatar-monogram", className)}
      style={{ "--avatar-hue": hueOf(sourceId) } as React.CSSProperties}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}
