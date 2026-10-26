import { FlaskConical } from "lucide-react";
import { forwardRef } from "react";
import { REPO_URL, openFeedback } from "../lib/feedback";

const BANNER_ID = "alpha-banner";

/** The page-top notice: alpha, AI-written, check what matters, help when it's wrong. */
export function AlphaBanner({ onClose }: { onClose: () => void }) {
  return (
    <aside id={BANNER_ID} className="alpha-banner" aria-label="Alpha software">
      <FlaskConical className="alpha-banner-icon" />
      <div className="alpha-banner-text">
        <p>
          <strong>OpenSlate is alpha software, written by AI with a human watching over it.</strong>{" "}
          While it's in alpha, things here might be wrong, change, or break. Check anything that
          matters (a name, a district, what an endorser actually said) against your official voter
          guide and the original source.
        </p>
        <p>
          Found a problem?{" "}
          <button type="button" className="link" onClick={openFeedback}>
            Tell us
          </button>
          , or come help fix it{" "}
          <a href={REPO_URL} target="_blank" rel="noreferrer">
            on GitHub
          </a>
          .
        </p>
      </div>
      <button type="button" className="alpha-banner-close" onClick={onClose}>
        Got it
      </button>
    </aside>
  );
}

/** Beside the brand: always says "Alpha", and opens or closes the banner. */
export const AlphaBadge = forwardRef<HTMLButtonElement, { open: boolean; onToggle: () => void }>(
  function AlphaBadge({ open, onToggle }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className="alpha-badge"
        aria-expanded={open}
        aria-controls={open ? BANNER_ID : undefined}
        onClick={onToggle}
      >
        Alpha
      </button>
    );
  },
);
