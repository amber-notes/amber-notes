import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";
import OpenConnect from "../app/open/connect/page";
import { universalLink } from "./connect";

const APP = "4UM3XVUN9Y.dev.emilwagman.pane";
const ID = "5a0f6c1e-2b1d-4c36-9e0a-6b6f0c1a2b3c";

describe("universal links", () => {
  const aasa = JSON.parse(readFileSync(new URL("../public/.well-known/apple-app-site-association", import.meta.url), "utf8"));

  it("claims /open/* for the app, in both formats", () => {
    const [detail] = aasa.applinks.details;
    expect(aasa.applinks.details).toHaveLength(1);
    expect(detail.appIDs).toEqual([APP]);
    expect(detail.components.map((c: { "/": string }) => c["/"])).toEqual(["/open/*"]);
    expect(detail.appID).toBe(APP);
    expect(detail.paths).toEqual(["/open/*"]);
  });

  it("only claims what the connect page links to", () => {
    const path = new URL(universalLink(ID)).pathname;
    expect(path.startsWith("/open/")).toBe(true);
    expect(new URL(universalLink(ID)).host).toBe("ambernotes.app");
  });

  it("is served as JSON, not with the pages' noindex and CSP", async () => {
    const rules = await nextConfig.headers!();
    const own = rules.find((r) => r.source === "/.well-known/apple-app-site-association");
    expect(own?.headers).toContainEqual({ key: "Content-Type", value: "application/json" });
    const catchAll = new RegExp(`^${rules[0].source}$`);
    expect(catchAll.test("/.well-known/apple-app-site-association")).toBe(false);
    expect(catchAll.test("/open/connect")).toBe(false);
    expect(catchAll.test("/n/some-shared-note")).toBe(true);
    const redirects = await nextConfig.redirects!();
    expect(redirects.some((r) => r.source.includes("well-known") || r.source.startsWith("/open"))).toBe(false);
  });
});

describe("the universal link's page in a browser", () => {
  const render = async (request?: string) => renderToStaticMarkup(await OpenConnect({ searchParams: Promise.resolve({ request }) }));

  it("offers the app's own scheme for the request, and the download", async () => {
    const html = await render(ID.toUpperCase());
    expect(html).toContain(`href="ambernotes://connect?request=${ID}"`);
    expect(html).toContain(">Open Amber Notes</a>");
    expect(html).toContain('href="/download"');
  });

  it("never echoes anything else from the address", async () => {
    const html = await render(`"><script>alert(1)</script>`);
    expect(html).not.toContain("alert");
    expect(html).not.toContain("ambernotes://");
    expect(html).toContain("This link isn&#x27;t complete");
  });
});
