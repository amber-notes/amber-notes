// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SITE_EVENT } from "@/lib/open-in-app";

const attempts = vi.hoisted(() => ({ calls: [] as { href: string; wait: number; done: (opened: boolean) => void }[], stops: 0 }));
vi.mock("./open/try-app", () => ({
  tryApp: (href: string, wait: number, done: (opened: boolean) => void) => {
    attempts.calls.push({ href, wait, done });
    return () => { attempts.stops++; };
  },
}));

import OpenInApp from "./OpenInApp";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const APP = "ambernotes://template/habit-tracker";
let host: HTMLDivElement, root: Root;
const events: unknown[] = [];
const onEvent = (e: Event) => events.push((e as CustomEvent).detail);

beforeEach(() => {
  attempts.calls = [];
  attempts.stops = 0;
  events.length = 0;
  window.addEventListener(SITE_EVENT, onEvent);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  window.removeEventListener(SITE_EVENT, onEvent);
  window.history.replaceState(null, "", "/");
  vi.useRealTimers();
});

const mount = (auto = false) => act(() => root.render(<OpenInApp href="/open/template/habit-tracker" app={APP} auto={auto}>Use template</OpenInApp>));
const button = () => host.querySelector("a")!;
const sheet = () => document.querySelector<HTMLElement>(".open-sheet");
const click = (init: MouseEventInit = {}) => {
  const e = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0, ...init });
  act(() => { button().dispatchEvent(e); });
  return e;
};

describe("Use template on the page", () => {
  it("keeps the universal link, and a click opens the app from the page instead", () => {
    mount();
    expect(button().getAttribute("href")).toBe("/open/template/habit-tracker");
    const e = click();
    expect(e.defaultPrevented).toBe(true);
    expect(attempts.calls.map((c) => [c.href, c.wait])).toEqual([[APP, 2000]]);
    expect(button().getAttribute("aria-busy")).toBe("true");
  });

  it("leaves a click for a new tab or window to the link", () => {
    mount();
    expect(click({ metaKey: true }).defaultPrevented).toBe(false);
    expect(attempts.calls).toHaveLength(0);
  });

  it("shows nothing more when Pinto Notes opened, and says so to analytics", () => {
    mount();
    click();
    act(() => attempts.calls[0].done(true));
    expect(sheet()).toBeNull();
    expect(button().hasAttribute("aria-busy")).toBe(false);
    expect(events).toEqual([{ event: "use_template_opened", properties: { path: "/", template: "habit-tracker" }, leaves: false }]);
  });

  it("offers the Mac app and another try when it didn't open, and puts the sheet away with Escape", () => {
    mount();
    click();
    act(() => attempts.calls[0].done(false));
    const s = sheet()!;
    expect(s.getAttribute("role")).toBe("dialog");
    expect(s.textContent).toContain("Didn't open?");
    expect(s.querySelector('a[href="/download/mac"]')?.textContent).toContain("Get Pinto Notes for Mac");
    expect(s.textContent).toContain("Already have it?");
    expect(document.activeElement).toBe(s);
    expect(events).toEqual([{ event: "use_template_not_found", properties: { path: "/", template: "habit-tracker" }, leaves: false }]);

    act(() => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(sheet()).toBeNull();
    expect(document.activeElement).toBe(button());
  });

  it("tries again from the sheet", () => {
    mount();
    click();
    act(() => attempts.calls[0].done(false));
    const again = [...sheet()!.querySelectorAll("button")].find((b) => b.textContent === "Try again")!;
    act(() => again.click());
    expect(sheet()).toBeNull();
    expect(attempts.calls).toHaveLength(2);
  });

  it("closes with its Close button", () => {
    mount();
    click();
    act(() => attempts.calls[0].done(false));
    act(() => sheet()!.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click());
    expect(sheet()).toBeNull();
  });

  it("tries the app as the page loads when an old link asked, once, and drops the ask from the address", () => {
    vi.useFakeTimers();
    window.history.replaceState(null, "", "/templates/habit-tracker?open=1");
    mount(true);
    expect(attempts.calls).toHaveLength(1);
    expect(window.location.pathname + window.location.search).toBe("/templates/habit-tracker");
    act(() => { vi.runAllTimers(); });
    expect(events).toEqual([{ event: "use_template_clicked", properties: { path: "/templates/habit-tracker", template: "habit-tracker", source: "link" }, leaves: false }]);
  });

  it("doesn't try the app on load without the ask, or on a button that isn't the page's own", () => {
    window.history.replaceState(null, "", "/templates/habit-tracker");
    mount(true);
    expect(attempts.calls).toHaveLength(0);
    act(() => root.unmount());
    root = createRoot(host);
    window.history.replaceState(null, "", "/templates/habit-tracker?open=1");
    mount(false);
    expect(attempts.calls).toHaveLength(0);
  });

  it("stops listening when the page goes", () => {
    mount();
    click();
    act(() => root.unmount());
    root = createRoot(host);
    expect(attempts.stops).toBe(1);
  });
});
