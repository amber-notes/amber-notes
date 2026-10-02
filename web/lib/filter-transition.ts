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

type Box = { left: number; top: number; right: number; bottom: number };

/// Each card on screen now, by its view-transition name.
function cards(): Map<string, Box> {
  const out = new Map<string, Box>();
  for (const el of document.querySelectorAll<HTMLElement>(".filter-card")) {
    if (!el.getClientRects().length) continue;
    const name = el.style.getPropertyValue("--vt").trim();
    const r = el.getBoundingClientRect();
    if (name) out.set(name, { left: r.left, top: r.top, right: r.right, bottom: r.bottom });
  }
  return out;
}

const area = (b: Box) => Math.max(0, b.right - b.left) * Math.max(0, b.bottom - b.top);
const overlap = (a: Box, b: Box) => area({ left: Math.max(a.left, b.left), top: Math.max(a.top, b.top), right: Math.min(a.right, b.right), bottom: Math.min(a.bottom, b.bottom) });
const onScreen = (b: Box, height: number) => b.bottom > 0 && b.top < height;

/// The per-card rules for one change, from where the cards were and where they are now. Cards that
/// move paint on top and glide; cards that arrive (or come from off screen, so they'd travel across
/// the others) appear in place under them, fading and rising; cards that leave paint at the bottom
/// and fade, except where another card lands on their place: there they stay until it has
/// covered them, so the slot never dips to the page colour. What follows the grid paints under the cards.
export function filterRules(before: Map<string, Box>, after: Map<string, Box>, height: number): string {
  const sel = (part: string, name: string) => `html[data-vt="filter"]::view-transition-${part}(${name})`;
  const rules: string[] = [];
  for (const name of after.keys()) {
    const was = before.get(name);
    if (was && onScreen(was, height)) { rules.push(`${sel("group", name)} { z-index: 3; }`); continue; }
    rules.push(`${sel("group", name)} { z-index: 2; }`);
    // From off screen: no glide across the page, just the arrival in place.
    if (was) rules.push(`${sel("group", name)} { animation: none; }`, `${sel("old", name)} { display: none; }`, `${sel("new", name)} { animation: filter-in 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }`);
  }
  for (const [name, was] of before) {
    if (after.has(name)) continue;
    rules.push(`${sel("group", name)} { z-index: 0; }`);
    if ([...after.values()].some((b) => overlap(b, was) > area(was) / 2)) rules.push(`${sel("old", name)}:only-child { animation: none; }`);
  }
  return rules.join("\n");
}

/// Waits until the cover pictures on screen are decoded, so no card is captured without its picture
/// (at most `ms`; a slow picture never holds the change up longer).
async function decoded(ms = 300): Promise<void> {
  const imgs = [...document.querySelectorAll<HTMLImageElement>(".filter-card img")].filter((img) => {
    const r = img.getBoundingClientRect();
    return r.height > 0 && r.bottom > 0 && r.top < innerHeight;
  });
  imgs.forEach((img) => { img.loading = "eager"; });
  await Promise.race([Promise.all(imgs.map((img) => img.decode().catch(() => {}))), new Promise((r) => setTimeout(r, ms))]);
}

/// Runs `update` (it must leave the new cards in the DOM by the time it returns or resolves) inside
/// the filter transition, or straight away when it won't animate.
export function filterTransition(update: () => Promise<void> | void): void {
  if (!filterAnimates()) { void update(); return; }
  const root = document.documentElement;
  const before = cards();
  const style = document.createElement("style");
  root.dataset.vt = "filter";
  (document as Doc).startViewTransition!(async () => {
    await update();
    await decoded();
    style.textContent = filterRules(before, cards(), innerHeight);
    document.head.append(style);
  }).finished.finally(() => { style.remove(); if (root.dataset.vt === "filter") delete root.dataset.vt; });
}
