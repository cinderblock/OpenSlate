import { lazy, Suspense } from "react";
import { useFeedbackOpen } from "../lib/feedback";

// The dialog (and, through it, the screenshot renderer) is fetched the first
// time someone opens it, not with every page.
const FeedbackDialog = lazy(() =>
  import("./FeedbackDialog").then((module) => ({ default: module.FeedbackDialog })),
);

/** Mounted once in the layout; "Send feedback" in the footer opens it. */
export function FeedbackHost() {
  const open = useFeedbackOpen();
  return open ? (
    <Suspense fallback={null}>
      <FeedbackDialog />
    </Suspense>
  ) : null;
}
