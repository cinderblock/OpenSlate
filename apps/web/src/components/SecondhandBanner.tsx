import type { Attribution } from "@openslate/core";
import { formatLocalDate } from "../lib/dates";

interface SecondhandBannerProps {
  attribution: Attribution;
  /** Display name of the slate's actual signer (the researcher), for the lede. */
  signerDisplay: string;
}

const MODE_LABEL: Record<Attribution["mode"], string> = {
  scraped: "scraped from public sources",
  transcribed: "transcribed from a non-machine-readable source",
  inferred: "inferred from indirect signals",
};

/**
 * Per SPEC §3.9 verifiers MUST surface attribution prominently so the viewer
 * sees "secondhand by <signer> about <of>" — not "from <of>". This banner is
 * the consumer-facing version of the CLI's "SECONDHAND REPORT" warning.
 */
export function SecondhandBanner({ attribution, signerDisplay }: SecondhandBannerProps) {
  const { of, mode, retrieved_at, sources } = attribution;
  const reportedName = of.name;
  return (
    <div className="card secondhand-banner">
      <p>
        <strong>Secondhand report.</strong> This slate is signed by <strong>{signerDisplay}</strong>{" "}
        reporting on{" "}
        {of.uri ? (
          <a href={of.uri} target="_blank" rel="noreferrer">
            <strong>{reportedName}</strong>
          </a>
        ) : (
          <strong>{reportedName}</strong>
        )}{" "}
        — not signed by {reportedName}.
      </p>
      <p className="hint">
        {MODE_LABEL[mode]} · retrieved {formatLocalDate(retrieved_at)}
        {of.kind && <> · {of.kind}</>}
      </p>
      {sources && sources.length > 0 && (
        <p className="hint">
          Sources:{" "}
          {sources.map((url, i) => (
            <span key={url}>
              {i > 0 && " · "}
              <a href={url} target="_blank" rel="noreferrer">
                {hostnameOf(url)}
              </a>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
