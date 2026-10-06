/// One motion for the site's two filter rows, the blog's category chips (separate pages, so a client
/// navigation) and the templates gallery's chips (the same page, filtered in place): a fade-through
/// of the grid. The chips' pick moves at the click; the grid fades out (90ms), its content is swapped
/// while it can't be seen, and it fades back in rising 6px (200ms, the standard curve), so two cards
/// never show in one place. What follows the grid glides to its new place over the same 200ms. The
/// header and title don't move. With reduced motion the change is instant.

/// The grid that fades, and whatever follows it. The page marks them with these classes.
export const FILTER_GRID = "filter-grid";
export const FILTER_AFTER = "filter-after";

const OUT_MS = 90;
const IN_MS = 200;
const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

/// Whether a filter change will animate (else callers just apply it).
export const filterAnimates = () => typeof document !== "undefined" && !matchMedia("(prefers-reduced-motion: reduce)").matches;

/// Moves the pick in a chip row to `chip` right away, before anything else happens: the page's own
/// render then lands on the same state, so the pick changes once, at the click.
export function pickChip(chip: Element | null): void {
  const row = chip?.closest("[role=group], nav");
  if (!chip || !row) return;
  for (const el of row.querySelectorAll("[aria-current], [aria-pressed]")) {
    if (el.hasAttribute("aria-pressed")) el.setAttribute("aria-pressed", String(el === chip));
    else if (el !== chip) el.removeAttribute("aria-current");
  }
  if (chip.tagName === "A") chip.setAttribute("aria-current", "page");
}

const grid = () => document.querySelector<HTMLElement>(`.${FILTER_GRID}`);
const after = () => document.querySelector<HTMLElement>(`.${FILTER_AFTER}`);

/// Waits until the pictures in the grid's first screen are decoded, so none pops in after the fade
/// (at most `ms`; a slow picture never holds the change up longer).
async function decoded(ms = 200): Promise<void> {
  const imgs = [...(grid()?.querySelectorAll("img") ?? [])].filter((img) => {
    const r = img.getBoundingClientRect();
    return r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  });
  imgs.forEach((img) => { img.loading = "eager"; });
  await Promise.race([Promise.all(imgs.map((img) => img.decode().catch(() => {}))), new Promise((r) => setTimeout(r, ms))]);
}

let current = 0;

/// Runs `update` (it must leave the new cards in the DOM by the time it returns or resolves) between
/// the grid's fade out and fade in, or straight away when it won't animate. `chip` is the one clicked.
/// A second change during the first takes over: the grid stays hidden until the last one is in.
export async function filterTransition(update: () => Promise<void> | void, chip: Element | null = null): Promise<void> {
  pickChip(chip);
  if (!filterAnimates()) { await update(); return; }
  const me = ++current;
  const root = document.documentElement;
  const old = grid();
  if (old && root.dataset.filter !== "out") {
    await old.animate([{ opacity: 1 }, { opacity: 0 }], { duration: OUT_MS, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" }).finished.catch(() => {});
  }
  // Hidden by site.css from here until the fade in, including a new grid that mounts in between.
  root.dataset.filter = "out";
  old?.getAnimations().forEach((a) => a.cancel());
  const below = after() ? after()!.getBoundingClientRect().top + scrollY : undefined; // on the page, not the screen: a page number scrolls
  await update();
  await decoded();
  if (me !== current) return;
  const next = grid();
  // Both start before the attribute goes, in the same frame, so the new grid is never seen unfaded.
  next?.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { duration: IN_MS, easing: EASE, fill: "backwards" });
  const tail = after();
  if (tail && below !== undefined) {
    const moved = below - (tail.getBoundingClientRect().top + scrollY);
    if (Math.abs(moved) > 0.5) tail.animate([{ transform: `translateY(${moved}px)` }, { transform: "none" }], { duration: IN_MS, easing: EASE });
  }
  delete root.dataset.filter;
}
