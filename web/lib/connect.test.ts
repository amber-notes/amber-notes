import { describe, expect, it } from "vitest";
import { appLink, appleSignInURL, destination, functionURL, pkcePair, returnURL, signInError, validRequest, verifiedAI } from "./connect";
import { upstream, upstreamHeaders } from "./mcp-proxy";

describe("the consent page", () => {
  it("accepts only a request id", () => {
    expect(validRequest("5a0f6c1e-2b1d-4c36-9e0a-6b6f0c1a2b3c")).toBe(true);
    expect(validRequest(undefined)).toBe(false);
    expect(validRequest("5a0f6c1e")).toBe(false);
    expect(validRequest("javascript:alert(1)")).toBe(false);
  });

  it("opens the app's consent sheet for the same request", () => {
    expect(appLink("5A0F6C1E-2B1D-4C36-9E0A-6B6F0C1A2B3C")).toBe("ambernotes://connect?request=5a0f6c1e-2b1d-4c36-9e0a-6b6f0c1a2b3c");
  });

  it("shows an AI's mark only when its address proves it", () => {
    expect(verifiedAI("claude.ai", false)).toBe("Claude");
    expect(verifiedAI("chatgpt.com", false)).toBe("ChatGPT");
    expect(verifiedAI("evil-claude.ai", false)).toBe(null);
    expect(verifiedAI("claude.ai.evil.example", false)).toBe(null);
    expect(verifiedAI("localhost", true)).toBe(null);
    expect(destination("127.0.0.1", true)).toBe("an app on this computer");
  });

  it("says why sign-in failed", () => {
    expect(signInError(400, { error_code: "invalid_credentials" })).toBe("The email or password isn't right.");
    expect(signInError(429, null)).toMatch(/Too many attempts/);
    expect(signInError(500, null)).toMatch(/Couldn't sign in/);
  });

  it("starts Sign in with Apple with PKCE, coming back to the same request", async () => {
    const { verifier, challenge } = await pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const back = returnURL("https://ambernotes.app", "5A0F6C1E-2B1D-4C36-9E0A-6B6F0C1A2B3C");
    expect(back).toBe("https://ambernotes.app/connect?request=5a0f6c1e-2b1d-4c36-9e0a-6b6f0c1a2b3c");
    const u = new URL(appleSignInURL("https://ref.supabase.co", back, challenge));
    expect(u.origin + u.pathname).toBe("https://ref.supabase.co/auth/v1/authorize");
    expect(u.searchParams.get("provider")).toBe("apple");
    expect(u.searchParams.get("redirect_to")).toBe(back);
    expect(u.searchParams.get("code_challenge")).toBe(challenge);
    expect(u.searchParams.get("code_challenge_method")).toBe("s256");
  });

  it("finds the function from the Supabase address", () => {
    expect(functionURL("https://ref.supabase.co/")).toBe("https://ref.supabase.co/functions/v1/mcp");
  });
});

describe("the mcp.ambernotes.app proxy", () => {
  it("keeps the path and query", () => {
    expect(upstream("https://ref.supabase.co", "/", "").toString()).toBe("https://ref.supabase.co/functions/v1/mcp");
    expect(upstream("https://ref.supabase.co/", "/.well-known/oauth-protected-resource", "").toString())
      .toBe("https://ref.supabase.co/functions/v1/mcp/.well-known/oauth-protected-resource");
    expect(upstream("https://ref.supabase.co", "/authorize", "?client_id=a&state=b").toString())
      .toBe("https://ref.supabase.co/functions/v1/mcp/authorize?client_id=a&state=b");
  });

  it("passes the caller's headers and vouches for the alias and address", () => {
    const h = upstreamHeaders(new Headers({
      host: "mcp.ambernotes.app",
      authorization: "Bearer amb_at_x",
      "mcp-session-id": "s1",
      "x-real-ip": "198.51.100.7",
      // A caller can't pretend to be the proxy.
      "x-mcp-client-ip": "1.2.3.4",
      "x-mcp-proxy-secret": "guess",
      "x-mcp-public-url": "https://evil.example",
    }), "secret");
    expect(h.get("authorization")).toBe("Bearer amb_at_x");
    expect(h.get("mcp-session-id")).toBe("s1");
    expect(h.get("host")).toBe(null);
    expect(h.get("x-mcp-public-url")).toBe("https://mcp.ambernotes.app");
    expect(h.get("x-mcp-client-ip")).toBe("198.51.100.7");
    expect(h.get("x-mcp-proxy-secret")).toBe("secret");
  });

  it("without the secret, vouches for nothing", () => {
    const h = upstreamHeaders(new Headers({ "x-real-ip": "198.51.100.7", "x-mcp-client-ip": "1.2.3.4", "x-mcp-proxy-secret": "guess" }), undefined);
    expect(h.get("x-mcp-client-ip")).toBe(null);
    expect(h.get("x-mcp-proxy-secret")).toBe(null);
  });
});
