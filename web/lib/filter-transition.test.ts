// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { filterCard, filterRules, filterTransition, pickChip } from "./filter-transition";

afterEach(() => { vi.unstubAllGlobals(); delete document.documentElement.dataset.vt; delete (document as { startViewTransition?: unknown }).startViewTransition; });
const motion = (reduce: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") && reduce }));

describe("the filter motion", () => {
  it("applies the change at once with reduced motion, or without view transitions", () => {
    motion(true);
    const start = vi.fn();
    (document as { startViewTransition?: unknown }).startViewTransition = start;
    const update = vi.fn();
    filterTransition(update);
    expect(update).toHaveBeenCalledOnce();
    expect(start).not.toHaveBeenCalled();
    motion(false);
    delete (document as { startViewTransition?: unknown }).startViewTransition;
    filterTransition(update);
    expect(update).toHaveBeenCalledTimes(2);
    expect(document.documentElement.dataset.vt).toBeUndefined();
  });

  it("marks the page for its timings while the transition runs, then clears it", async () => {
    motion(false);
    let finish!: () => void;
    const finished = new Promise<void>((r) => { finish = r; });
    const update = vi.fn();
    (document as { startViewTransition?: unknown }).startViewTransition = (u: () => void) => { u(); return { finished }; };
    filterTransition(update);
    expect(update).toHaveBeenCalledOnce();
    expect(document.documentElement.dataset.vt).toBe("filter");
    finish();
    await finished; await Promise.resolve();
    expect(document.documentElement.dataset.vt).toBeUndefined();
  });

  it("names each card for itself", () => {
    expect(filterCard("habit-tracker")).toEqual({ className: "filter-card", style: { "--vt": "card-habit-tracker" } });
  });

  it("keeps every timing at 240ms or under, exits shorter, and all of it behind reduced motion", () => {
    const css = readFileSync(resolve(__dirname, "../app/site.css"), "utf8");
    const block = css.slice(css.indexOf('html[data-vt="filter"] .filter-card'), css.indexOf("@keyframes filter-in"));
    for (const ms of block.matchAll(/(\d+)ms/g)) expect(+ms[1]).toBeLessThanOrEqual(240);
    expect(block).toContain("::view-transition-old(*):only-child { animation: vt-out 120ms");
    expect(block).toContain("::view-transition-new(*):only-child { animation: filter-in 240ms");
    const outside = block.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/, "");
    expect(outside).not.toMatch(/animation/);
  });

  it("layers the cards: movers on top, arrivals in place under them, a covered leaver held until covered", () => {
    const box = (left: number, top: number) => ({ left, top, right: left + 100, bottom: top + 100 });
    const before = new Map([["card-a", box(0, 0)], ["card-b", box(110, 0)], ["card-c", box(220, 0)], ["card-far", box(0, 2000)]]);
    const after = new Map([["card-b", box(0, 0)], ["card-d", box(110, 0)], ["card-far", box(220, 0)]]);
    const rules = filterRules(before, after, 800).split("\n");
    const v = (part: string, name: string) => `html[data-vt="filter"]::view-transition-${part}(${name})`;
    expect(rules).toContain(`${v("group", "card-b")} { z-index: 3; }`); // moved, was on screen: glides on top
    expect(rules).toContain(`${v("group", "card-d")} { z-index: 2; }`); // new: in place, under the movers
    expect(rules).toContain(`${v("old", "card-far")} { display: none; }`); // from off screen: no glide across the page
    expect(rules).toContain(`${v("new", "card-far")} { animation: filter-in 240ms cubic-bezier(0.2, 0.8, 0.2, 1) both; }`);
    expect(rules).toContain(`${v("group", "card-a")} { z-index: 0; }`);
    expect(rules).toContain(`${v("old", "card-a")}:only-child { animation: none; }`); // b lands on a's place: a waits under it
    expect(rules).toContain(`${v("old", "card-c")}:only-child { animation: none; }`); // far lands on c's place
    const lone = filterRules(new Map([["card-x", box(0, 0)]]), new Map(), 800);
    expect(lone).not.toContain("animation: none"); // nothing lands there: it just fades
  });

  it("moves a chip row's pick in one step, before the change runs", () => {
    document.body.innerHTML = '<nav><a href="/blog" aria-current="page">All</a><a href="/blog/category/guides">Guides</a></nav><div role="group"><button aria-pressed="true">All</button><button aria-pressed="false">Work</button></div>';
    motion(true);
    const [all, guides] = document.querySelectorAll("a");
    let seen = "";
    filterTransition(() => { seen = `${all.getAttribute("aria-current")}/${guides.getAttribute("aria-current")}`; }, guides);
    expect(seen).toBe("null/page");
    const [pAll, work] = document.querySelectorAll("button");
    pickChip(work);
    expect([pAll.getAttribute("aria-pressed"), work.getAttribute("aria-pressed")]).toEqual(["false", "true"]);
  });

  it("never animates the chips", () => {
    const css = readFileSync(resolve(__dirname, "../app/site.css"), "utf8");
    expect(css).not.toMatch(/filter-chips/);
    for (const f of ["../app/blog/blog.module.css", "../app/templates/templates.module.css"]) {
      const c = readFileSync(resolve(__dirname, f), "utf8");
      expect(c, f).not.toMatch(/\.(filters a|chip) \{ transition:[^}]*(background|color)/);
    }
  });
});
