import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../next.config";
import sitemap from "../app/sitemap";
import { analyticsEvent } from "./analytics";
import { DEV_ONLY_PATHS, devOnly } from "./dev-only";
import { posthogAllowed } from "./posthog";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NEXT_NOT_FOUND"); } }));

afterEach(() => vi.unstubAllEnvs());

describe("the Dev-only preview pages", () => {
  it("are not found on the production site, and render on preview and local builds", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    expect(() => devOnly()).toThrow("NEXT_NOT_FOUND");
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(() => devOnly()).not.toThrow();
    vi.stubEnv("VERCEL_ENV", "");
    expect(() => devOnly()).not.toThrow();
  });

  it.each(DEV_ONLY_PATHS)("%s calls devOnly before it renders", async (path) => {
    vi.stubEnv("VERCEL_ENV", "production");
    const file = { "/n/preview": "../app/n/preview/page", "/dev/account": "../app/dev/account/page" }[path];
    const page = (await import(/* @vite-ignore */ file)).default as (p: { searchParams: Promise<object> }) => unknown;
    await expect(Promise.resolve().then(() => page({ searchParams: Promise.resolve({}) }))).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("are never in the sitemap", () => {
    const urls = sitemap().map((e) => new URL(e.url).pathname);
    for (const p of [...DEV_ONLY_PATHS, "/dev"]) expect(urls.some((u) => u === p || u.startsWith(p + "/"))).toBe(false);
  });

  it("are sent with noindex", async () => {
    const rules = await nextConfig.headers!();
    const noindex = rules.find((r) => r.headers.some((h) => h.key === "X-Robots-Tag" && h.value.includes("noindex")) && r.source.startsWith("/((?!"))!;
    const re = new RegExp(`^${noindex.source.replace("/(", "/(?:")}$`);
    for (const p of DEV_ONLY_PATHS) expect(re.test(p), p).toBe(true);
  });
});

describe("analytics on the private pages", () => {
  it.each(["/n/abc", "/n/abc/def", "/n/preview", "/connect", "/open/connect", "/open/copy/abc", "/open/template/trip-plan", "/report/abc"])("never loads on %s", (path) => {
    expect(posthogAllowed(path)).toBe(false);
    expect(analyticsEvent({ url: `https://pintonotes.com${path}?x=1` })).toBeNull();
  });
});
