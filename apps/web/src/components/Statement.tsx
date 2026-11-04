import { ExternalLink } from "lucide-react";
import { httpHref } from "../lib/httpHref";

/** "eastbaytimes.com" from a page's URL: who the link goes to, before it's opened. */
export function linkHost(href: string): string {
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return href;
  }
}

/**
 * A source's statement, with a link to the page it came from. A statement quotes its source, and
 * the page is the whole of what was said (SPEC §3.4): it's always one click away, never hidden
 * behind a shortened quote.
 */
export function Statement({
  text,
  source,
  className = "statement",
}: {
  text: string;
  /** The position's `source` URL. Only http(s) links are shown. */
  source?: string;
  className?: string;
}) {
  const href = httpHref(source);
  return (
    <figure className="statement-figure">
      <blockquote className={className} {...(href ? { cite: href } : {})}>
        {text}
      </blockquote>
      {href && (
        <figcaption className="statement-source">
          <a href={href} target="_blank" rel="noreferrer">
            Read it at {linkHost(href)}
            <ExternalLink className="icon" aria-hidden="true" />
          </a>
        </figcaption>
      )}
    </figure>
  );
}
