import { useLiveQuery } from "@tanstack/react-db";
import { Suspense, lazy, useEffect } from "react";
import { identityCollection, slatesCollection } from "../lib/collections";
import { useOnboarding } from "../lib/myVote";
import {
  DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG,
  catalogQueryOptions,
  queryClient,
} from "../lib/query";
import { openWizard, useWizardOpen } from "../lib/wizard";

// The wizard's own code (catalog import, area picker, its form controls) is
// fetched the first time it opens, not with every page.
const Wizard = lazy(() => import("./Wizard").then((module) => ({ default: module.Wizard })));

/**
 * Mounted once in the layout. Opens the wizard on a first visit (nothing
 * imported, no identity, never finished or skipped); "Get started" reopens it
 * any time.
 */
export function WizardHost() {
  const open = useWizardOpen();
  const [onboarding] = useOnboarding();
  const slates = useLiveQuery((q) => q.from({ slate: slatesCollection }));
  const identities = useLiveQuery((q) => q.from({ identity: identityCollection }));
  const firstVisit =
    onboarding === "" &&
    slates.isReady &&
    identities.isReady &&
    slates.data.length === 0 &&
    identities.data.length === 0;

  useEffect(() => {
    if (firstVisit) openWizard();
  }, [firstVisit]);

  // The catalog is the wizard's first need; fetch it while the wizard's own
  // code is still loading, so the election and source lists are there at once.
  useEffect(() => {
    if (open)
      void queryClient.prefetchQuery(catalogQueryOptions(DEFAULT_PUBLIC_ENDORSEMENTS_CATALOG));
  }, [open]);

  return open ? (
    <Suspense fallback={null}>
      <Wizard />
    </Suspense>
  ) : null;
}
