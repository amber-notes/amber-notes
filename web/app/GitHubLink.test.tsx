import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import GitHubLink, { fetchStars } from "./GitHubLink";

afterEach(() => vi.unstubAllGlobals());

describe("the header's GitHub link", () => {
  it("renders the built star count first, in the label too", () => {
    const html = renderToStaticMarkup(<GitHubLink stars={2} />);
    expect(html).toContain('aria-label="GitHub, 2 stars"');
    expect(html).toContain("★ 2</span>");
  });

  it("renders without a count when the build had none", () => {
    const html = renderToStaticMarkup(<GitHubLink stars={null} />);
    expect(html).toContain('aria-label="GitHub"');
    expect(html).not.toContain("site-stars");
  });

  it("reads the live count from /stars.json", async () => {
    const fetch = vi.fn(async () => Response.json({ stars: 7 }));
    vi.stubGlobal("fetch", fetch);
    expect(await fetchStars()).toBe(7);
    expect(fetch).toHaveBeenCalledWith("/stars.json");
  });

  it.each([
    ["the route fails", async () => new Response("", { status: 500 })],
    ["the network fails", async () => { throw new TypeError("Failed to fetch"); }],
    ["GitHub had no count", async () => Response.json({ stars: null })],
    ["the answer isn't a count", async () => Response.json({ stars: "2" })],
    ["the answer isn't JSON", async () => new Response("<html>")],
  ])("gives null, so the built number stays, when %s", async (_, impl) => {
    vi.stubGlobal("fetch", vi.fn(impl));
    expect(await fetchStars()).toBeNull();
  });
});
