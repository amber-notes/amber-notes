// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ path: "/", push: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useRouter: () => ({ push: nav.push }) }));

import MobileMenu, { MENU_PAGES } from "./MobileMenu";
import SiteChrome from "./SiteChrome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const text = (html: string) => html.replace(/<[^>]+>/g, "");
const hrefs = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]);

describe("what the phone menu holds", () => {
  const menu = (appStoreLive = false, path = "/") => renderToStaticMarkup(<MobileMenu path={path} stars={7} appStoreLive={appStoreLive} />);
  const part = (html: string, cls: string) => { const from = html.indexOf(`<div class="site-sheet-for ${cls}`); return html.slice(from, html.indexOf("</div>", from)); };

  it("lists the desktop header's pages in its order, then GitHub with its stars", () => {
    const rows = menu().split('<nav class="site-sheet-rows" aria-label="Site menu">')[1].split("</nav>")[0];
    expect(hrefs(rows)).toEqual(["/templates", "/blog", "/changelog", "/help", "https://github.com/pinto-notes/pinto-notes"]);
    expect(text(rows)).toBe("TemplatesBlogChangelogHelpGitHub★ 7");
    expect(rows).toContain('aria-label="GitHub, 7 stars"');
  });

  it("has every text link the desktop header has", () => {
    const header = renderToStaticMarkup(<SiteChrome version="1.2" stars={7}>page</SiteChrome>).split('<nav class="site-nav"')[1].split("</nav>")[0];
    const pages = hrefs(header).filter((h) => h.startsWith("/") && h !== "/download" && h !== "/download/mac");
    expect(pages).toEqual(MENU_PAGES.map((p) => p.href));
    expect(header).toContain("https://github.com/pinto-notes/pinto-notes");
    expect(header).toContain(">For iPhone and Mac</a>");
  });

  it("marks the current page, on the pages under it too", () => {
    const current = (path: string) => [...menu(false, path).split('<nav class="site-sheet-rows" aria-label="Site menu">')[1].split("</nav>")[0].matchAll(/href="([^"]+)" aria-current="page"/g)].map((m) => m[1]);
    expect(current("/templates")).toEqual(["/templates"]);
    expect(current("/blog/apple-notes-mcp")).toEqual(["/blog"]);
    expect(current("/support")).toEqual(["/help"]);
    expect(current("/")).toEqual([]);
  });

  it("ends with the Mac download where that's some use, as the home page does", () => {
    expect(text(part(menu(), "pi-apple pi-not-ios"))).toBe(" Download for MaciPhone · coming soon");
    expect(part(menu(), "pi-apple pi-not-ios")).toContain('href="/download/mac" download="Amber-Notes.dmg"');
    expect(text(part(menu(true), "pi-apple pi-not-ios"))).toBe(" Get it for iPhone Download for Mac");
  });

  it("tells an iPhone where the iPhone app stands, and links the App Store only once it's there", () => {
    expect(text(part(menu(), "site-sheet-ios"))).toBe("Pinto Notes for iPhone is coming to the App Store soon. Download for Mac");
    expect(hrefs(part(menu(), "site-sheet-ios"))).toEqual(["/download"]);
    expect(menu()).not.toContain("apps.apple.com");
    expect(hrefs(part(menu(true), "site-sheet-ios"))).toEqual(["https://apps.apple.com/app/id6817253103", "/download"]);
  });

  it("says what the header says to Windows, Android and Linux", () => {
    expect(part(menu(), "site-sheet-other")).toContain('href="/download">For iPhone and Mac</a>');
  });

  it("shows one of the three by the visitor's platform", () => {
    const css = readFileSync(resolve(__dirname, "site.css"), "utf8");
    expect(css).toContain(".site-sheet-for.site-sheet-ios, .site-sheet-for.site-sheet-other { display: none; }");
    expect(css).toContain(':root[data-platform="ios"] .site-sheet-for.site-sheet-ios,');
    expect(css).toContain(':root:is([data-platform="windows"], [data-platform="android"], [data-platform="linux"]) .site-sheet-for.site-sheet-other { display: grid; }');
  });
});

describe("opening and closing the phone menu", () => {
  let host: HTMLDivElement;
  let root: Root;
  let reduced = true;
  const q = <T extends Element>(sel: string) => host.querySelector(sel) as T;
  const button = () => q<HTMLButtonElement>("button[aria-controls='site-menu']");
  const dialog = () => q<HTMLDialogElement>("#site-menu");
  const render = (path = "/") => act(() => { nav.path = path; root.render(<MobileMenu path={path} stars={7} />); });
  const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); });

  beforeEach(async () => {
    reduced = true;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ stars: 7 })));
    vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") ? reduced : false, addEventListener() {}, removeEventListener() {} }));
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
    await render();
  });
  afterEach(async () => {
    await act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts closed, with a named button that says so", () => {
    expect(button().getAttribute("aria-label")).toBe("Open menu");
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(button().getAttribute("aria-haspopup")).toBe("dialog");
    expect(dialog().open).toBe(false);
  });

  it("opens as a modal dialog, holds the page still and says it's expanded", async () => {
    const showModal = vi.spyOn(dialog(), "showModal");
    await click(button());
    expect(showModal).toHaveBeenCalledOnce();
    expect(dialog().open).toBe(true);
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(document.activeElement).toBe(q(".site-sheet"));
  });

  const closed = () => {
    expect(dialog().open).toBe(false);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(document.documentElement.style.overflow).toBe("");
    expect(document.activeElement).toBe(button());
  };

  it("closes on the Close button and gives focus back to the menu button", async () => {
    await click(button());
    await click(q("button[aria-label='Close menu']"));
    closed();
  });

  it("closes on Escape", async () => {
    await click(button());
    await act(() => { dialog().dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })); });
    closed();
  });

  it("closes on a tap outside the sheet, and not on a tap inside it", async () => {
    await click(button());
    await click(q(".site-sheet-top"));
    expect(dialog().open).toBe(true);
    await click(dialog());
    closed();
  });

  it("closes at once when a link is tapped, and when the page changes", async () => {
    reduced = false; // even with motion on, a followed link doesn't wait for the fade
    await click(button());
    const link = q<HTMLAnchorElement>(".site-sheet-rows a[href='/blog']");
    link.addEventListener("click", (e) => e.preventDefault());
    await click(link);
    closed();
    await click(button());
    await render("/blog");
    closed();
  });

  it("fades out before closing when motion is on", async () => {
    vi.useFakeTimers();
    reduced = false;
    await click(button());
    await click(q("button[aria-label='Close menu']"));
    expect(dialog().open).toBe(true);
    expect(dialog().hasAttribute("data-closing")).toBe(true);
    await act(() => { vi.advanceTimersByTime(150); });
    closed();
    expect(dialog().hasAttribute("data-closing")).toBe(false);
  });

  it("animates only when motion is welcome", () => {
    const css = readFileSync(resolve(__dirname, "site.css"), "utf8");
    const menu = css.slice(css.indexOf("/* ── Phones (600px and under)"), css.indexOf("/* Footer: identical on every page. */"));
    const outside = menu.replace(/@media \(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, "").replace(/@keyframes[^\n]*/g, "");
    expect(outside).not.toMatch(/animation|transition/);
  });
});
