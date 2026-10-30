import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { memo } from "react";
import type { Alignment } from "../lib/alignment";
import { useAllRaces, useCatalogCopyReady } from "../lib/allSlates";
import type { DecodedSlate } from "../lib/collate";
import { useBallotComparison } from "../lib/comparison";

function record(a: Alignment): string {
  return `${a.source.name} (${a.agree} of ${a.shared})`;
}

/**
 * My ballot's line on who agrees with the voter, live as they mark. It never
 * fetches or lines up the catalog itself: until this visit has it, from Compare
 * or All races, it's a link.
 */
export const CompareStrip = memo(function CompareStrip({
  election,
  slates,
}: {
  election: string;
  slates: DecodedSlate[];
}) {
  const { all } = useAllRaces(useCatalogCopyReady());
  const result = useBallotComparison(election, slates, all, { fallback: false });

  const closest = result?.groups.aligned[0];
  const furthest = result?.groups.opposed[0];
  if (!closest && !furthest) {
    return (
      <p className="compare-strip no-print">
        <Link to="/compare">
          See which endorsers match your picks <ArrowRight className="icon" aria-hidden="true" />
        </Link>
      </p>
    );
  }
  return (
    <p className="compare-strip no-print">
      {closest && (
        <span>
          Closest so far: <strong>{record(closest)}</strong>
        </span>
      )}
      {furthest && (
        <span>
          Furthest: <strong>{record(furthest)}</strong>
        </span>
      )}
      <Link to="/compare">
        Everyone <ArrowRight className="icon" aria-hidden="true" />
      </Link>
    </p>
  );
});
