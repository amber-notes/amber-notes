import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { connectCSP, newNonce } from "./connect-csp";
import { themeScript } from "./theme";

describe("the consent page's CSP", () => {
  it("allows scripts by nonce or the theme script's hash, never inline", async () => {
    const nonce = newNonce();
    const csp = await connectCSP(nonce, "https://ref.supabase.co", true);
    const hash = createHash("sha256").update(themeScript).digest("base64");
    expect(csp).toContain(`script-src 'self' 'nonce-${nonce}' 'sha256-${hash}'`);
    expect(csp).not.toContain("unsafe-inline");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("connect-src 'self' https://ref.supabase.co");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it("makes a fresh nonce each time", () => {
    expect(newNonce()).not.toBe(newNonce());
    expect(newNonce()).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });
});
