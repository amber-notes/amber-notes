// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { filterCard, filterTransition } from "./filter-transition";

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
    const block = css.slice(css.indexOf('html[data-vt="filter"] .filter-chips'), css.indexOf("@keyframes filter-in"));
    for (const ms of block.matchAll(/(\d+)ms/g)) expect(+ms[1]).toBeLessThanOrEqual(240);
    expect(block).toContain("::view-transition-old(*):only-child { animation: vt-out 120ms");
    expect(block).toContain("::view-transition-new(*):only-child { animation: filter-in 240ms");
    const outside = block.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/, "");
    expect(outside).not.toMatch(/animation/);
  });
});
