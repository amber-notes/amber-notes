import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { connectCSP, newNonce, supabaseOrigin } from "./connect-csp";
import { themeScript } from "./theme";

describe("the connect pages' CSP", () => {
  it("allows scripts by nonce or the theme script's hash, never inline", async () => {
    const nonce = newNonce();
    const csp = await connectCSP(nonce);
    const hash = createHash("sha256").update(themeScript).digest("base64");
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'sha256-${hash}'`);
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("lets /open/connect call nothing but this site, and post nowhere", async () => {
    const csp = await connectCSP(newNonce());
    expect(csp).toContain("connect-src 'self';");
    expect(csp).not.toMatch(/supabase|https?:/);
    expect(csp).toContain("form-action 'none'");
  });

  it("lets /connect call this site and the Supabase project only, and still post nowhere", async () => {
    const csp = await connectCSP(newNonce(), "https://ref.supabase.co/");
    expect(csp).toContain("connect-src 'self' https://ref.supabase.co;");
    // Only there: scripts, images, frames and forms stay on this site.
    expect(csp.match(/https:\/\/ref\.supabase\.co/g)).toHaveLength(1);
    expect(csp).toContain("form-action 'none'");
    expect(csp).toContain("default-src 'self';");
  });

  it("takes only an origin from the Supabase address, and nothing that isn't one", () => {
    expect(supabaseOrigin("https://ref.supabase.co/functions/v1/mcp?x=1")).toBe("https://ref.supabase.co");
    expect(supabaseOrigin("http://127.0.0.1:54321")).toBe("http://127.0.0.1:54321");
    expect(supabaseOrigin("http://evil.example")).toBe(null);
    expect(supabaseOrigin("https://a.supabase.co; script-src *")).toBe(null);
    expect(supabaseOrigin("")).toBe(null);
    expect(supabaseOrigin(undefined)).toBe(null);
  });

  it("makes a fresh nonce each time", () => {
    expect(newNonce()).not.toBe(newNonce());
    expect(newNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
