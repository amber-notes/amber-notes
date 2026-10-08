import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, HEAD } from "./route";
import robots from "../../robots";
import { MAC_DOWNLOAD_PATH } from "@/lib/downloads";

const env = { SUPABASE_URL: "https://project.supabase.co", SUPABASE_ANON_KEY: "anon-key" };

function stubFetch(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const fetch = vi.fn(impl);
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

describe("/download/mac", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("adds one to today's Mac total, then redirects to the DMG", async () => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const fetch = stubFetch(async () => new Response(null, { status: 204 }));
    const res = await GET();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://project.supabase.co/rest/v1/rpc/count_download");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ p_product: "mac" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/downloads/Pinto-Notes.dmg");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("sends nothing about the person downloading", async () => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const fetch = stubFetch(async () => new Response(null, { status: 204 }));
    await GET();
    const [, init] = fetch.mock.calls[0];
    expect(Object.keys(init.headers as Record<string, string>).sort()).toEqual(["apikey", "authorization", "content-type"]);
    expect(Object.keys(JSON.parse(String(init.body)))).toEqual(["p_product"]);
  });

  it("still redirects when the count fails", async () => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    for (const failing of [
      async () => new Response(JSON.stringify({ message: "boom" }), { status: 500 }),
      async () => { throw new TypeError("network down"); },
    ]) {
      stubFetch(failing);
      const res = await GET();
      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/downloads/Pinto-Notes.dmg");
    }
  });

  it("still redirects when the count hangs", async () => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    stubFetch((_url, init) => new Promise((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))));
    const started = Date.now();
    const res = await GET();
    expect(Date.now() - started).toBeLessThan(3000);
    expect(res.headers.get("location")).toBe("/downloads/Pinto-Notes.dmg");
  });

  it("redirects without counting when Supabase isn't configured", async () => {
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_ANON_KEY", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "");
    const fetch = stubFetch(async () => new Response(null, { status: 204 }));
    const res = await GET();
    expect(fetch).not.toHaveBeenCalled();
    expect(res.headers.get("location")).toBe("/downloads/Pinto-Notes.dmg");
  });

  it("doesn't count a HEAD request", async () => {
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const fetch = stubFetch(async () => new Response(null, { status: 204 }));
    const res = HEAD();
    expect(fetch).not.toHaveBeenCalled();
    expect(res.status).toBe(302);
  });

  it("is off limits to crawlers", () => {
    for (const rule of robots().rules as { disallow?: string }[]) expect(rule.disallow).toBe(MAC_DOWNLOAD_PATH);
  });
});
