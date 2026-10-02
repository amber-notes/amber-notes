/// One motion for the site's two filter rows, the blog's category chips (separate pages, so a client
/// navigation) and the templates gallery's chips (the same page, filtered in place). The header,
/// title and chips stay still; the chip's pick crossfades; cards that stay glide to their new place,
/// cards that leave fade out quickly, cards that arrive fade in rising a little, and what's below the
/// grid follows its new height. site.css has the timings, keyed on data-vt="filter"; the pieces carry
/// the classes below. With reduced motion, or no view transitions, the change is instant.

/// The chip row, each card (with its own --vt name, set by filterCard), and whatever follows the grid.
export const FILTER_CHIPS = "filter-chips";
export const FILTER_AFTER = "filter-after";
export const filterCard = (id: string) => ({ className: "filter-card", style: { "--vt": `card-${id}` } as React.CSSProperties });

type Doc = Document & { startViewTransition?: (update: () => Promise<void> | void) => { finished: Promise<void> } };

/// Whether a filter change will animate (else callers just apply it).
export const filterAnimates = () => typeof document !== "undefined" && !!(document as Doc).startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches;

/// Runs `update` (it must leave the new cards in the DOM by the time it returns or resolves) inside
/// the filter transition, or straight away when it won't animate.
export function filterTransition(update: () => Promise<void> | void): void {
  if (!filterAnimates()) { void update(); return; }
  const root = document.documentElement;
  root.dataset.vt = "filter";
  (document as Doc).startViewTransition!(update).finished.finally(() => { if (root.dataset.vt === "filter") delete root.dataset.vt; });
}
