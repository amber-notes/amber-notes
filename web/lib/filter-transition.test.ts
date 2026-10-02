// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FILTER_GRID, filterTransition, pickChip } from "./filter-transition";

afterEach(() => { vi.unstubAllGlobals(); delete document.documentElement.dataset.filter; document.body.innerHTML = ""; });
const motion = (reduce: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({ matches: q.includes("reduce") && reduce }));

/// A grid whose animations are recorded and finish at once.
function stage() {
  document.body.innerHTML = `<ul class="${FILTER_GRID}"><li>a</li></ul><nav class="filter-after"></nav>`;
  const calls: { el: string; frames: Keyframe[]; options: KeyframeAnimationOptions; hidden: boolean }[] = [];
  Element.prototype.animate = function (frames, options) {
    calls.push({ el: this.className, frames: frames as Keyframe[], options: options as KeyframeAnimationOptions, hidden: document.documentElement.dataset.filter === "out" });
    return { finished: Promise.resolve(), cancel() {} } as unknown as Animation;
  };
  Element.prototype.getAnimations = () => [];
  return calls;
}

describe("the filter motion", () => {
  it("swaps at once with reduced motion", async () => {
    motion(true);
    const calls = stage();
    const update = vi.fn();
    await filterTransition(update);
    expect(update).toHaveBeenCalledOnce();
    expect(calls).toEqual([]);
  });

  it("fades the grid out, swaps it while hidden, and fades the new one in rising 6px", async () => {
    motion(false);
    const calls = stage();
    let hiddenAtSwap = false;
    await filterTransition(() => {
      hiddenAtSwap = document.documentElement.dataset.filter === "out";
      document.body.innerHTML = `<ul class="${FILTER_GRID}"><li>b</li></ul><nav class="filter-after"></nav>`;
    });
    expect(hiddenAtSwap).toBe(true);
    const [out, inn] = calls;
    expect(out.frames).toEqual([{ opacity: 1 }, { opacity: 0 }]);
    expect(out.options.duration).toBe(90);
    expect(inn.frames).toEqual([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }]);
    expect(inn.options).toMatchObject({ duration: 200, easing: "cubic-bezier(0.4, 0, 0.2, 1)" });
    expect(inn.hidden).toBe(true); // started before the grid is shown, so it's never seen unfaded
    expect(document.documentElement.dataset.filter).toBeUndefined();
  });

  it("keeps the grid hidden until the last of two quick changes is in", async () => {
    motion(false);
    const calls = stage();
    let release!: () => void;
    const first = filterTransition(() => new Promise<void>((r) => { release = r; }));
    await Promise.resolve(); await Promise.resolve();
    const second = filterTransition(() => {});
    release();
    await Promise.all([first, second]);
    expect(calls.filter((c) => c.frames[0].opacity === 0)).toHaveLength(1);
  });

  it("hides a new grid while the swap runs, from site.css", () => {
    const css = readFileSync(resolve(__dirname, "../app/site.css"), "utf8");
    expect(css).toContain(`html[data-filter="out"] .${FILTER_GRID} { opacity: 0; }`);
    expect(css).not.toMatch(/data-vt="filter"/);
  });

  it("moves a chip row's pick in one step, before the change runs", async () => {
    motion(true);
    document.body.innerHTML = '<nav><a href="/blog" aria-current="page">All</a><a href="/blog/category/guides">Guides</a></nav><div role="group"><button aria-pressed="true">All</button><button aria-pressed="false">Work</button></div>';
    const [all, guides] = document.querySelectorAll("a");
    let seen = "";
    await filterTransition(() => { seen = `${all.getAttribute("aria-current")}/${guides.getAttribute("aria-current")}`; }, guides);
    expect(seen).toBe("null/page");
    const [pAll, work] = document.querySelectorAll("button");
    pickChip(work);
    expect([pAll.getAttribute("aria-pressed"), work.getAttribute("aria-pressed")]).toEqual(["false", "true"]);
  });

  it("never animates the chips", () => {
    for (const f of ["../app/blog/blog.module.css", "../app/templates/templates.module.css"]) {
      const c = readFileSync(resolve(__dirname, f), "utf8");
      expect(c, f).not.toMatch(/\.(filters a|chip) \{ transition:[^}]*(background|color)/);
    }
  });
});
