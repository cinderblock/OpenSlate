import type {
  Argument,
  Block,
  CandidateInfo,
  GuideDocument,
  Inline,
  Passage,
} from "@openslate/core";
import { Fragment, type ReactNode } from "react";
import { formatLocalDate } from "../lib/dates";
import { type GuideForSubject, useGuideFileUrl } from "../lib/guides";

/**
 * A voter guide's material on the race page: what the office or measure is,
 * the candidates' own statements and photos, and for a measure its official
 * summary, analysis, arguments and full text. Everything is rendered from the
 * guide's block model; there is never raw HTML.
 */

type Guide = Pick<GuideForSubject, "entry" | "manifest">;

function InlineText({ runs }: { runs: Inline[] }) {
  return (
    <>
      {runs.map((run, i) => {
        // biome-ignore lint/suspicious/noArrayIndexKey: runs are static text, never reordered
        if (typeof run !== "string") return <InlineRun key={i} run={run} />;
        const lines = run.split("\n");
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: runs are static text, never reordered
          <Fragment key={i}>
            {lines.map((line, j) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: lines of one run, never reordered
              <Fragment key={j}>
                {j > 0 && <br />}
                {line}
              </Fragment>
            ))}
          </Fragment>
        );
      })}
    </>
  );
}

function InlineRun({ run }: { run: Exclude<Inline, string> }) {
  if ("em" in run) {
    return (
      <em>
        <InlineText runs={run.em} />
      </em>
    );
  }
  return (
    <strong>
      <InlineText runs={run.strong} />
    </strong>
  );
}

export function GuideBlocks({ blocks, guide }: { blocks: Block[]; guide: Guide }) {
  return (
    <>
      {blocks.map((block, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: published content, never reordered
        <GuideBlock key={i} block={block} guide={guide} />
      ))}
    </>
  );
}

function GuideBlock({ block, guide }: { block: Block; guide: Guide }): ReactNode {
  switch (block.type) {
    case "h":
      // Headings inside a passage sit below the passage's own heading.
      return block.level === 2 ? (
        <h4>
          <InlineText runs={block.text} />
        </h4>
      ) : (
        <h5>
          <InlineText runs={block.text} />
        </h5>
      );
    case "p":
      return (
        <p>
          <InlineText runs={block.text} />
        </p>
      );
    case "ul":
    case "ol": {
      const List = block.type;
      return (
        <List>
          {block.items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: published content, never reordered
            <li key={i}>
              <GuideBlocks blocks={item} guide={guide} />
            </li>
          ))}
        </List>
      );
    }
    case "table":
      return (
        <div className="guide-table">
          <table>
            {block.caption && <caption>{block.caption}</caption>}
            <tbody>
              {block.rows.map((row, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: published content, never reordered
                <tr key={i}>
                  {row.map((cell, j) => {
                    const Cell = cell.header ? "th" : "td";
                    return (
                      // biome-ignore lint/suspicious/noArrayIndexKey: published content, never reordered
                      <Cell key={j}>
                        <InlineText runs={cell.text} />
                      </Cell>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "img":
      return (
        <GuideImage
          guide={guide}
          file={block.file}
          alt={block.alt ?? ""}
          className="guide-figure"
        />
      );
  }
}

function GuideImage({
  guide,
  file,
  alt,
  className,
}: { guide: Guide; file: string; alt: string; className?: string }) {
  const { url, error } = useGuideFileUrl(guide, file);
  if (error) return <p className="hint warning">Image not shown: {error.message}</p>;
  if (!url) return <div className={`${className ?? ""} guide-image-pending`} aria-hidden="true" />;
  return <img className={className} src={url} alt={alt} />;
}

/** Where the material came from, who mirrored and signed it, and when. */
export function GuideAttribution({ guide }: { guide: Guide }) {
  const { manifest, entry } = guide;
  return (
    <p className="hint guide-attribution">
      From{" "}
      {manifest.attribution.of.uri ? (
        <a href={manifest.attribution.of.uri} target="_blank" rel="noreferrer">
          {manifest.attribution.of.name}
        </a>
      ) : (
        manifest.attribution.of.name
      )}
      's {manifest.context?.title ? <cite>{manifest.context.title}</cite> : "voter guide"}, as of{" "}
      {formatLocalDate(manifest.attribution.retrieved_at)}. Mirrored and signed by{" "}
      <span title={manifest.issuer.key}>{manifest.issuer.name ?? "a researcher"}</span>
      {entry.repo && (
        <>
          {" "}
          (
          <a href={entry.repo} target="_blank" rel="noreferrer">
            source
          </a>
          )
        </>
      )}
      .
    </p>
  );
}

function Source({
  passage,
  label = "Source",
}: { passage: Pick<Passage, "source">; label?: string }) {
  return (
    <a className="guide-source" href={passage.source} target="_blank" rel="noreferrer">
      {label}
    </a>
  );
}

/** A candidate's photo and own statement, inside their choice card. */
export function CandidateGuide({ candidate, guide }: { candidate: CandidateInfo; guide: Guide }) {
  return (
    <div className="guide-candidate">
      {candidate.photo && (
        <GuideImage
          guide={guide}
          file={candidate.photo.file}
          alt={candidate.photo.alt ?? candidate.choice}
          className="guide-photo"
        />
      )}
      {candidate.statement && (
        <details className="guide-statement">
          <summary>In their own words</summary>
          <GuideBlocks blocks={candidate.statement.blocks} guide={guide} />
          {candidate.contact && candidate.contact.length > 0 && (
            <p className="hint guide-contact">
              {candidate.contact.map((line, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: published lines, never reordered
                <Fragment key={i}>
                  {i > 0 && <br />}
                  {line}
                </Fragment>
              ))}
            </p>
          )}
          {candidate.statement.disclaimer && (
            <p className="hint guide-disclaimer">{candidate.statement.disclaimer}</p>
          )}
          <p className="hint">
            <Source passage={candidate.statement} label="Official voter guide" />
          </p>
        </details>
      )}
    </div>
  );
}

/** "A YES vote on this measure means: …", under the Yes choice. */
export function GuideMeans({ passage, guide }: { passage: Passage; guide: Guide }) {
  return (
    <div className="guide-means">
      <GuideBlocks blocks={passage.blocks} guide={guide} />
    </div>
  );
}

/** What the race or measure is: the office's duties, a measure's summary, a justice's record. */
export function GuideOverview({ guide }: { guide: GuideForSubject }) {
  const { item } = guide;
  return (
    <div className="card guide-overview">
      <div className="card-title">
        <strong>Official voter guide</strong>
        {item.about?.by && <span className="hint">{item.about.by}</span>}
      </div>
      {item.about && <GuideBlocks blocks={item.about.blocks} guide={guide} />}
      {item.about && (
        <p className="hint">
          <Source passage={item.about} label="Read it in the guide" />
        </p>
      )}
      <GuideAttribution guide={guide} />
    </div>
  );
}

function ArgumentText({ argument, guide }: { argument: Argument; guide: Guide }) {
  return (
    <>
      {argument.title && (
        <p>
          <strong>{argument.title}</strong>
        </p>
      )}
      <GuideBlocks blocks={argument.blocks} guide={guide} />
      {argument.signers.length > 0 && (
        <ul className="guide-signers">
          {argument.signers.map((signer) => (
            <li key={`${signer.name}|${signer.organization ?? ""}`}>
              <strong>{signer.name}</strong>
              {signer.title && `, ${signer.title}`}
              {signer.organization && (
                <>
                  <br />
                  <span className="hint">{signer.organization}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {argument.footnote && <p className="hint guide-funding">{argument.footnote}</p>}
      {argument.funding && <p className="hint guide-funding">{argument.funding}</p>}
    </>
  );
}

function sideLabel(argument: Argument): string {
  if (!argument.rebuttal) return argument.side === "Yes" ? "Argument in favor" : "Argument against";
  return argument.side === "Yes"
    ? "Rebuttal to the argument against"
    : "Rebuttal to the argument in favor";
}

/** A measure's official summary, analysis, arguments and full text. */
export function GuideDetails({ guide }: { guide: GuideForSubject }) {
  const { item } = guide;
  const official = (item.arguments ?? []).filter((a) => !a.paid);
  const paid = (item.arguments ?? []).filter((a) => a.paid);
  const sides = [...new Set(official.map((a) => a.side))];
  const paidSides = [...new Set(paid.map((a) => a.side))];
  const disclaimer = item.arguments?.find((a) => a.disclaimer)?.disclaimer;
  if (!item.summary && !item.analysis && !item.arguments && !item.documents) return null;
  return (
    <div className="card guide-details">
      <div className="card-title">
        <strong>From the official voter guide</strong>
      </div>

      {official.length > 0 && (
        <section aria-label="Arguments">
          <h4>Arguments</h4>
          <p className="hint">
            Written and signed by supporters and opponents; printed in the guide as submitted.
          </p>
          <div className="guide-arguments">
            {sides.map((side) => (
              <div key={side} className="guide-side">
                <h5>For “{side}”</h5>
                {official
                  .filter((a) => a.side === side)
                  // The argument first, then its side's rebuttal of the other.
                  .sort((a, b) => Number(a.rebuttal) - Number(b.rebuttal))
                  .map((argument) => (
                    <details
                      key={`${argument.side}-${argument.rebuttal}`}
                      open={!argument.rebuttal}
                    >
                      <summary>{sideLabel(argument)}</summary>
                      <ArgumentText argument={argument} guide={guide} />
                    </details>
                  ))}
              </div>
            ))}
          </div>
          {disclaimer && <p className="hint guide-disclaimer">{disclaimer}</p>}
        </section>
      )}

      {paid.length > 0 && (
        <details className="guide-paid">
          <summary>
            Paid arguments ({paid.length})
            <span className="hint"> · printed for a fee by whoever submitted them</span>
          </summary>
          <div className="guide-arguments">
            {paidSides.map((side) => (
              <div key={side} className="guide-side">
                <h5>For “{side}”</h5>
                {paid
                  .filter((a) => a.side === side)
                  .map((argument, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: published order, never reordered
                    <details key={i}>
                      <summary>{argument.title ?? `Paid argument ${i + 1}`}</summary>
                      <ArgumentText argument={{ ...argument, title: undefined }} guide={guide} />
                    </details>
                  ))}
              </div>
            ))}
          </div>
          {!official.length && disclaimer && <p className="hint guide-disclaimer">{disclaimer}</p>}
        </details>
      )}

      {item.summary && (
        <details>
          <summary>
            {item.summary.title ?? "Official title and summary"}
            {item.summary.by && <span className="hint"> · {item.summary.by}</span>}
          </summary>
          <GuideBlocks blocks={item.summary.blocks} guide={guide} />
          <p className="hint">
            <Source passage={item.summary} />
          </p>
        </details>
      )}

      {item.analysis && (
        <details>
          <summary>
            {item.analysis.title ?? "Analysis"}
            {item.analysis.by && <span className="hint"> · {item.analysis.by}</span>}
          </summary>
          <GuideBlocks blocks={item.analysis.blocks} guide={guide} />
          <p className="hint">
            <Source passage={item.analysis} />
          </p>
        </details>
      )}

      {item.documents && item.documents.length > 0 && (
        <ul className="guide-documents">
          {item.documents.map((doc) => (
            <li key={doc.file ?? `${doc.source}|${doc.page ?? ""}`}>
              {doc.file ? (
                <GuideDocumentLink
                  guide={guide}
                  file={doc.file}
                  title={doc.title}
                  mediaType={doc.mediaType}
                  source={doc.source}
                />
              ) : (
                <LinkedDocument doc={doc} />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A document only linked, at its page in the original (too large to mirror). */
function LinkedDocument({ doc }: { doc: GuideDocument }) {
  const href = doc.page ? `${doc.source.replace(/#.*$/, "")}#page=${doc.page}` : doc.source;
  return (
    <>
      <a href={href} target="_blank" rel="noreferrer">
        {doc.title}
      </a>{" "}
      <span className="hint">
        ({doc.page ? `page ${doc.page} of the original` : "the original"}, not mirrored here)
      </span>
    </>
  );
}

function GuideDocumentLink({
  guide,
  file,
  title,
  mediaType,
  source,
}: { guide: Guide; file: string; title: string; mediaType: string; source: string }) {
  const { url, error } = useGuideFileUrl(guide, file, mediaType);
  return (
    <>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer">
          {title}
        </a>
      ) : (
        <span>{title}</span>
      )}{" "}
      <span className="hint">
        {error
          ? `(couldn't check it: ${error.message})`
          : url
            ? "(checked against the signed guide)"
            : "(checking…)"}{" "}
        ·{" "}
        <a href={source} target="_blank" rel="noreferrer">
          original
        </a>
      </span>
    </>
  );
}
