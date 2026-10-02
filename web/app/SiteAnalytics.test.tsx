import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ path: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path }));
vi.mock("@vercel/analytics/next", () => ({ Analytics: () => <i data-vercel="" /> }));
vi.mock("./PostHogAnalytics", () => ({ default: ({ host, path }: { host: string; path: string }) => <i data-posthog={`${host} ${path}`} /> }));

import SiteAnalytics from "./SiteAnalytics";

const render = (path: string) => {
  nav.path = path;
  return renderToStaticMarkup(<SiteAnalytics />);
};

afterEach(() => vi.unstubAllEnvs());

describe("the layout's analytics", () => {
  it("loads no PostHog without a key", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
    expect(render("/")).not.toContain("data-posthog");
    expect(render("/")).toContain("data-vercel");
  });

  it("loads PostHog on public pages, on the EU host unless told otherwise", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    expect(render("/")).toContain('data-posthog="https://eu.i.posthog.com /"');
    expect(render("/blog/apple-notes-mcp")).toContain("data-posthog");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://ph.example.com");
    expect(render("/download")).toContain('data-posthog="https://ph.example.com /download"');
  });

  it("never loads PostHog on shared notes, connect, universal-link, report or download-redirect pages", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
    for (const path of ["/n/abc123", "/connect", "/open/connect", "/open/template/standup", "/report/abc123", "/download/mac"]) {
      expect(render(path), path).not.toContain("data-posthog");
    }
  });

  it("loads Vercel Web Analytics on public pages", () => {
    for (const path of ["/", "/download", "/blog/apple-notes-mcp", "/templates/trip-plan", "/help", "/notes", "/openings"]) {
      expect(render(path), path).toContain("data-vercel");
    }
  });

  it("never loads Vercel Web Analytics, or its loader, on shared notes, connect, universal-link or report pages", () => {
    for (const path of ["/n/abc123", "/n/abc123/sub", "/connect", "/connect/preview", "/open/connect", "/open/template/standup", "/open/copy/abc123", "/report/abc123"]) {
      expect(render(path), path).not.toContain("data-vercel");
    }
  });
});

