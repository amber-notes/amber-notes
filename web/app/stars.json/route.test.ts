import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, revalidate } from "./route";

afterEach(() => vi.unstubAllGlobals());

describe("/stars.json", () => {
  it("returns the repository's star count, cached at the CDN for 10 minutes", async () => {
    const fetch = vi.fn(async () => Response.json({ stargazers_count: 2 }));
    vi.stubGlobal("fetch", fetch);
    const res = await GET();
    expect(await res.json()).toEqual({ stars: 2 });
    expect(res.headers.get("cache-control")).toContain("s-maxage=600");
    expect(revalidate).toBe(600);
    expect(fetch).toHaveBeenCalledWith("https://api.github.com/repos/pinto-notes/pinto-notes", expect.objectContaining({ next: { revalidate: 600 } }));
  });

  it.each([
    ["GitHub errors", async () => new Response("rate limited", { status: 403 })],
    ["the network fails", async () => { throw new TypeError("fetch failed"); }],
    ["GitHub answers without a count", async () => Response.json({ message: "Not Found" })],
  ])("answers { stars: null } with 200 when %s", async (_, impl) => {
    vi.stubGlobal("fetch", vi.fn(impl));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stars: null });
  });
});
