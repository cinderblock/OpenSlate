import { type CivicLookup, type CivicRoute, civicProblemReport } from "../lib/civic";
import { reportFeedback } from "../lib/feedback";

/** "Report it" beside a failed Google lookup: opens the feedback dialog with the error written up. */
export function ReportCivicProblem({
  lookup,
  route,
  message,
}: {
  lookup: CivicLookup;
  route: CivicRoute;
  message: string;
}) {
  return (
    <button
      type="button"
      className="link"
      onClick={() => reportFeedback("problem", civicProblemReport(lookup, route, message))}
    >
      Report it
    </button>
  );
}
