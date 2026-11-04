import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { raceSlug } from "../lib/raceSlug";

export interface RaceLinkProps {
  /** The race's subject key (`subjectKey`). */
  raceKey: string;
  /** `?all`: every slate in the public catalog on the race. */
  all?: boolean;
  /** `?k`: name the exact race, for when another race shares its slug. */
  pin?: boolean;
  /** A section of the race page: `official`, `articles`, `all-slates`. */
  hash?: string;
  className?: string;
  title?: string;
  "aria-label"?: string;
  children: ReactNode;
}

/**
 * A link to a race's page at its readable address (lib/raceSlug.ts), e.g.
 * `#/race/2026-11-03/us/ca/governor`. A race known only by an `id` has no
 * slug and links by key.
 */
export function RaceLink({ raceKey, all, pin, hash, ...rest }: RaceLinkProps) {
  const slug = raceSlug(raceKey);
  const search = { ...(all ? { all: true as const } : {}), ...(pin && slug ? { k: raceKey } : {}) };
  const section = hash ? { hash } : {};
  return slug ? (
    <Link to="/race/$" params={{ _splat: slug }} search={search} {...section} {...rest} />
  ) : (
    <Link to="/race/$key" params={{ key: raceKey }} search={search} {...section} {...rest} />
  );
}
