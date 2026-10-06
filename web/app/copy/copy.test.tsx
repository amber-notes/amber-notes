import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));

import PROMPTS from "@/lib/try-prompts.json";
import CopyPage from "./[id]/page";
import { GET } from "../go/route";

describe("the Ask Claude copy page", () => {
  it("has the same prompts as the emails", () => {
    const emails = JSON.parse(readFileSync(new URL("../../../supabase/functions/lifecycle/prompts.json", import.meta.url), "utf8"));
    expect(PROMPTS).toEqual(emails);
  });

  it("shows the prompt, one copy button and the ChatGPT way", async () => {
    const html = renderToStaticMarkup(await CopyPage({ params: Promise.resolve({ id: "latest" }) }));
    expect(html).toContain("Search my Amber Notes and tell me what I wrote most recently.");
    expect(html.match(/<button /g)).toHaveLength(1);
    expect(html).toContain("Copy and open Claude");
    expect(html).toContain(`href="https://chatgpt.com/?q=${encodeURIComponent("Search my Amber Notes and tell me what I wrote most recently.")}"`);
  });

  it("only copies the emails' own prompts", async () => {
    await expect(CopyPage({ params: Promise.resolve({ id: "anything" }) })).rejects.toThrow("not found");
  });
});

describe("GET /go", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  const go = (q: string) => GET(new Request(`https://ambernotes.app/go?${q}`));

  it("counts the click through the lifecycle function, then sends the reader on", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    const f = vi.fn(async (_u: string) => new Response("{}"));
    vi.stubGlobal("fetch", f);
    const res = await go(new URLSearchParams({ s: "12", to: "https://ambernotes.app/templates", t: "abc" }).toString());
    expect(f.mock.calls[0][0]).toBe("https://example.supabase.co/functions/v1/lifecycle/click?s=12&to=https%3A%2F%2Fambernotes.app%2Ftemplates&t=abc");
    expect([res.status, res.headers.get("location")]).toEqual([302, "https://ambernotes.app/templates"]);
  });

  it("still sends the reader on when the count fails", async () => {
    vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    const res = await go(new URLSearchParams({ s: "1", to: "https://chatgpt.com/?q=hi", t: "x" }).toString());
    expect(res.headers.get("location")).toBe("https://chatgpt.com/?q=hi");
  });

  it("never sends anyone elsewhere", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    for (const to of ["https://evil.example/", "http://ambernotes.app/", "javascript:alert(1)", ""]) {
      const res = await go(new URLSearchParams({ s: "1", to, t: "x" }).toString());
      expect(res.headers.get("location")).toBe("/");
    }
    expect(f).not.toHaveBeenCalled();
  });
});
