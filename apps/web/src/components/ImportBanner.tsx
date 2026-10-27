import { Link } from "@tanstack/react-router";
import { CircleCheck, CloudDownload, TriangleAlert } from "lucide-react";
import { useEffect } from "react";
import { ADDING_NEWS, backgroundImports } from "../lib/catalogImport";
import { type ImportStatus, useImportStatus } from "../lib/importQueue";
import { ProgressBar } from "./ui/ProgressBar";

/** How long "all in" stays up once an import finishes cleanly. */
const DONE_SHOWN_MS = 6000;

/**
 * Over every page while setup's import carries on in the
 * background: a bar, and a note that the ballot is still filling in. Says when
 * it's done, and lists what didn't import. Nothing is lost if the tab closes
 * part way: the next visit picks it up again (pendingSetup.ts). Also shows
 * sources being updated from the catalog (CatalogUpdater), more quietly.
 */
export function ImportBanner() {
  const status = useImportStatus(backgroundImports);
  const running = status?.state === "running";
  const clean = status?.state === "done" && status.errors.length === 0;
  const update = status?.kind === "update";

  useEffect(() => {
    if (!clean) return;
    const timer = setTimeout(backgroundImports.dismiss, DONE_SHOWN_MS);
    return () => clearTimeout(timer);
  }, [clean]);

  if (!status) return null;
  const Icon = running ? CloudDownload : clean ? CircleCheck : TriangleAlert;
  const sources = (n: number) => (n === 1 ? "1 source" : `${n} sources`);

  return (
    <aside
      className={`import-banner${running ? "" : clean ? " done" : " failed"}`}
      aria-label={update ? "Updating sources" : "Importing sources"}
    >
      <Icon className="import-banner-icon" />
      <div className="import-banner-text">
        {running && (
          <ProgressBar label={status.label} value={status.value} maxValue={status.maxValue} />
        )}
        {/* A live region: screen readers hear each change of state, not every tick of the bar. */}
        <output>
          {update ? (
            <UpdateText status={status} />
          ) : running ? (
            <>
              <strong>Still loading your sources.</strong> Your ballot fills in as they arrive, so
              some races may be missing endorsements for now. Close the tab and it carries on next
              time.
              {status.queued > 0 && " More you picked are queued after these."}
            </>
          ) : clean ? (
            <>
              <strong>Your sources are in.</strong> Added {sources(status.imported)} to your ballot.
            </>
          ) : (
            <>
              <strong>
                {status.errors.length === 1
                  ? "1 source didn't import."
                  : `${status.errors.length} sources didn't import.`}
              </strong>{" "}
              {status.imported > 0 &&
                `${sources(status.imported)} did, and ${status.imported === 1 ? "is" : "are"} on your ballot. `}
              You can try again from <Link to="/sources">Sources</Link>.
            </>
          )}
        </output>
        {!running && !clean && !update && (
          <ul className="error">
            {status.errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        )}
      </div>
      {!running && (
        <button type="button" className="import-banner-close" onClick={backgroundImports.dismiss}>
          {clean ? "OK" : "Dismiss"}
        </button>
      )}
    </aside>
  );
}

/** The banner's words while sources update from the catalog. */
function UpdateText({ status }: { status: ImportStatus }) {
  const sources = (n: number) => (n === 1 ? "1 source" : `${n} sources`);
  if (status.label === ADDING_NEWS) {
    return status.state === "running" ? (
      <strong>Adding news coverage of your races.</strong>
    ) : (
      <>
        <strong>Added news coverage from {sources(status.imported)}.</strong> Each race lists its
        articles.
      </>
    );
  }
  if (status.state === "running") {
    return (
      <>
        <strong>Updating your sources.</strong> The catalog has newer versions of some you imported.
      </>
    );
  }
  const failed = status.errors.length;
  return (
    <>
      <strong>
        {failed === 0
          ? `Updated ${sources(status.imported)}.`
          : `${sources(failed)} couldn't be updated.`}
      </strong>{" "}
      {failed === 0
        ? "Your ballot has their latest endorsements."
        : "You keep the versions you had; it tries again next time."}
    </>
  );
}
