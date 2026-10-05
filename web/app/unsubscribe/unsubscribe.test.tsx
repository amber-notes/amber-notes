import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Unsubscribe from "./page";
import { GET, POST } from "./confirm/route";

const U = "0b6f6a5e-1d2c-4a8e-9f3b-2c1d0e9f8a7b";
const T = "Qm9vbXNoYWthbGFrYS10b2tlbi1mb3ItdGVzdHM";
const page = async (q: Record<string, string | undefined>) => renderToStaticMarkup(await Unsubscribe({ searchParams: Promise.resolve(q) }));

describe("the unsubscribe page", () => {
  it("changes nothing when opened: it offers one button that posts the link", async () => {
    const html = await page({ u: U, t: T });
    expect(html).toContain("Stop these emails?</h1>");
    expect(html).toContain(`<form action="/unsubscribe/confirm?u=${U}&amp;t=${T}" method="post">`);
    expect(html.match(/<button /g)).toHaveLength(1);
  });

  it("says when it's done, and that account emails still come", async () => {
    const html = await page({ done: "1" });
    expect(html).toContain("You won&#x27;t get these emails again</h1>");
    expect(html).toContain("password reset");
    expect(html).not.toContain("<form");
  });

  it("refuses a mangled link instead of offering a button that can't work", async () => {
    for (const q of [{}, { u: "nope", t: T }, { u: U, t: "short" }, { u: U, t: "has spaces in it which tokens never do" }]) {
      const html = await page(q);
      expect(html).toContain("This link isn&#x27;t complete</h1>");
      expect(html).not.toContain("<form");
    }
  });

  it("says a failed try and keeps the button", async () => {
    const html = await page({ u: U, t: T, failed: "1" });
    expect(html).toContain("didn&#x27;t go through");
    expect(html).toContain("<form");
  });
});

describe("POST /unsubscribe/confirm", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const post = (q: string, body = "") => POST(new Request(`https://ambernotes.app/unsubscribe/confirm?${q}`, { method: "POST", body, headers: { "content-type": "application/x-www-form-urlencoded" } }));

  it("asks the lifecycle function, then sends the page's button back to the page", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", f);
    const res = await post(`u=${U}&t=${T}`);
    expect(f).toHaveBeenCalledWith(`https://example.supabase.co/functions/v1/lifecycle/unsubscribe?u=${U}&t=${T}&via=link`, expect.objectContaining({ method: "POST" }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/unsubscribe?done=1");
  });

  it("answers a mail app's one-click post (RFC 8058) with a plain 200", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    const f = vi.fn(async (_url: string) => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", f);
    const res = await post(`u=${U}&t=${T}`, "List-Unsubscribe=One-Click");
    expect(f.mock.calls[0][0]).toContain("&via=header");
    expect(res.status).toBe(200);
  });

  it("says when the function refused or couldn't be reached", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 400 })));
    expect((await post(`u=${U}&t=${T}`)).headers.get("location")).toBe(`/unsubscribe?u=${U}&t=${T}&failed=1`);
    expect((await post(`u=${U}&t=${T}`, "List-Unsubscribe=One-Click")).status).toBe(502);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect((await post(`u=${U}&t=${T}`)).headers.get("location")).toContain("failed=1");
  });

  it("never calls out for a mangled link", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect((await post("u=nope&t=x", "List-Unsubscribe=One-Click")).status).toBe(400);
    expect(f).not.toHaveBeenCalled();
  });

  it("does nothing on GET (mail scanners open links)", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(GET().status).toBe(303);
    expect(f).not.toHaveBeenCalled();
  });
});
