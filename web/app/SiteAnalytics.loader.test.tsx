// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

// The real Vercel component, mounted in a document: its loader <script> goes into the page on /,
// and never on the private pages.
const nav = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useParams: () => ({}), useSearchParams: () => new URLSearchParams() }));

import SiteAnalytics from "./SiteAnalytics";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const loaders = () => [...document.querySelectorAll("script")].filter((s) => /script\.js/.test(s.getAttribute("src") ?? "") || s.dataset.sdkn?.includes("analytics"));

async function mount(path: string) {
  nav.path = path;
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  await act(async () => root.render(<SiteAnalytics />));
  return () => act(() => root.unmount());
}

afterEach(() => { document.head.innerHTML = ""; document.body.innerHTML = ""; });

describe("Vercel's loader script", () => {
  it("is added on /", async () => {
    const done = await mount("/");
    expect(loaders().length).toBeGreaterThan(0);
    await done();
  });

  it.each(["/n/abc123", "/n/abc123/sub", "/connect", "/open/connect", "/open/template/standup", "/open/copy/abc123", "/report/abc123"])("is never added on %s", async (path) => {
    const done = await mount(path);
    expect(loaders()).toHaveLength(0);
    await done();
  });
});
