/**
 * Fitting the printed ballot (components/PrintBallot.tsx) onto one page, or
 * onto the front and back of one sheet. DOM measurement, so not unit-tested;
 * checked in the browser and in headless Chrome's print-to-PDF.
 */

/**
 * The paper US Letter and A4 have in common (A4's width, 8.27in, less a
 * hair for rounding; Letter's height), inside the 0.25in `--print-pad` that
 * stands in for page margins (`.print-ballot` in styles.css).
 */
const PRINT_PAD = 0.25 * 96;
const PAGE_WIDTH = 8.25 * 96 - 2 * PRINT_PAD;
const PAGE_HEIGHT = 11 * 96 - 2 * PRINT_PAD;
/**
 * Below this the text gets too small to read; the ballot spills onto more
 * pages instead. Relative to the 10pt print size, so about 7pt.
 */
export const MIN_PRINT_SCALE = 0.7;
/**
 * Room for the printer laying text out a hair wider than the screen does,
 * which wraps a name that just fit: measured this much narrower.
 */
const WIDTH_SAFETY = 0.97;
/** Line heights hold steady from screen to paper; a sliver for rounding. */
const HEIGHT_SAFETY = 0.99;
/** The size search's first, coarse steps down from full size. */
const SCALE_STEP = 0.05;

export interface PrintFit {
  /** Size relative to the normal print size (1 = full size). */
  scale: number;
  pages: number;
}

/**
 * Find the largest size at which the printout fits on `maxPages` pages, and
 * apply it. Widening the box (then zooming it back down) lets the columns
 * flow wider and shorter, so a long ballot shrinks evenly instead of being
 * cut off.
 *
 * Measured the way paper fills: `.measuring` gives the columns a page's
 * height and fills them in order (`column-fill: auto`), and whatever doesn't
 * fit runs into more columns to the side, which are counted. Balanced
 * columns can't be measured this way: a race never splits, so their height
 * jumps up and down as the size changes. The column count is fixed from the
 * full width (`--print-columns`), so the narrower measuring box keeps it.
 */
export function fitToPage(el: HTMLElement, maxPages = 1): PrintFit {
  const columns = el.querySelector<HTMLElement>(".pb-columns");
  el.style.removeProperty("--print-columns");
  const style = columns ? getComputedStyle(columns) : undefined;
  const gap = Number.parseFloat(style?.columnGap ?? "") || 0;
  const minWidth = Number.parseFloat(style?.columnWidth ?? "") || PAGE_WIDTH;
  const pagesAt = (scale: number) => {
    const width = PAGE_WIDTH / scale;
    const perPage = Math.max(1, Math.floor((width + gap) / (minWidth + gap)));
    el.style.setProperty("--print-columns", String(perPage));
    el.style.setProperty("--print-width", `${width * WIDTH_SAFETY}px`);
    if (!columns) return 1;
    // Every page as short as the first, below the header: a little cautious.
    const height = (PAGE_HEIGHT * HEIGHT_SAFETY) / scale - columns.offsetTop;
    el.style.setProperty("--measure-height", `${height}px`);
    const pitch = (columns.clientWidth + gap) / perPage;
    const count = Math.round((columns.scrollWidth + gap) / pitch);
    return Math.max(1, Math.ceil(count / perPage));
  };
  el.classList.add("measuring");
  let fit: PrintFit;
  try {
    // Step down from full size, then halve the last step: the largest size
    // that fits, even where wrapping makes the height jump about. `scale`
    // only ever holds a size measured to fit (or the floor).
    let scale = 1;
    if (pagesAt(1) > maxPages) {
      let hi = 1;
      scale = hi - SCALE_STEP;
      while (scale > MIN_PRINT_SCALE && pagesAt(scale) > maxPages) {
        hi = scale;
        scale -= SCALE_STEP;
      }
      if (scale <= MIN_PRINT_SCALE) scale = MIN_PRINT_SCALE;
      if (scale > MIN_PRINT_SCALE || pagesAt(scale) <= maxPages) {
        for (let i = 0; i < 4; i++) {
          const mid = (scale + hi) / 2;
          if (pagesAt(mid) <= maxPages) scale = mid;
          else hi = mid;
        }
      }
    }
    fit = { scale, pages: pagesAt(scale) };
  } finally {
    el.classList.remove("measuring");
    el.style.removeProperty("--measure-height");
  }
  el.style.setProperty("--print-width", `${PAGE_WIDTH / fit.scale}px`);
  el.style.setProperty("--print-zoom", String(fit.scale));
  return fit;
}
