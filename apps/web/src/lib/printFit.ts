/**
 * Fitting the printed ballot (components/PrintBallot.tsx) onto one page. DOM
 * measurement, so not unit-tested; checked in the browser.
 */

/** Printable area common to US Letter and A4 with the 0.4in margins of `@page ballot`. */
const PAGE_WIDTH = 7.45 * 96;
const PAGE_HEIGHT = 10.15 * 96;
/** Below this the text gets too small to read; the ballot spills onto more pages instead. */
export const MIN_PRINT_SCALE = 0.62;

export interface PrintFit {
  /** Size relative to the normal print size (1 = full size). */
  scale: number;
  pages: number;
}

/**
 * Find the largest size at which the printout fits one page, and apply it.
 * Widening the box (then zooming it back down) lets the columns flow wider
 * and shorter, so a long ballot shrinks evenly instead of being cut off.
 */
export function fitToPage(el: HTMLElement): PrintFit {
  const heightAt = (scale: number) => {
    el.style.setProperty("--print-width", `${PAGE_WIDTH / scale}px`);
    return el.scrollHeight * scale;
  };
  el.classList.add("measuring");
  let fit: PrintFit;
  try {
    if (heightAt(1) <= PAGE_HEIGHT) fit = { scale: 1, pages: 1 };
    else {
      const smallest = heightAt(MIN_PRINT_SCALE);
      if (smallest > PAGE_HEIGHT) {
        fit = { scale: MIN_PRINT_SCALE, pages: Math.ceil(smallest / PAGE_HEIGHT) };
      } else {
        let lo = MIN_PRINT_SCALE;
        let hi = 1;
        for (let i = 0; i < 8; i++) {
          const mid = (lo + hi) / 2;
          if (heightAt(mid) <= PAGE_HEIGHT) lo = mid;
          else hi = mid;
        }
        fit = { scale: lo, pages: 1 };
      }
    }
  } finally {
    el.classList.remove("measuring");
  }
  el.style.setProperty("--print-width", `${PAGE_WIDTH / fit.scale}px`);
  el.style.setProperty("--print-zoom", String(fit.scale));
  return fit;
}
