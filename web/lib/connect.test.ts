import { describe, expect, it } from "vitest";
import { appLink, appleSignInURL, consentHeading, destination, functionURL, pkcePair, problemText, returnURL, signInError, validRequest, verifiedAI } from "./connect";
import { allowedPath, upstream, upstreamHeaders } from "./mcp-proxy";

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
    expect(verifiedAI({ redirect_uri: "https://claude.ai/api/mcp/auth_callback" })).toBe("Claude");
    expect(verifiedAI({ redirect_uri: "https://chatgpt.com/connector_platform_oauth_redirect" })).toBe("ChatGPT");
    // The same site isn't enough: only the pinned callback, exactly.
    expect(verifiedAI({ redirect_uri: "https://claude.ai/some/other/page" })).toBe(null);
    expect(verifiedAI({ redirect_uri: "https://claude.ai/api/mcp/auth_callback?x=1" })).toBe(null);
    expect(verifiedAI({ redirect_uri: "https://evil-claude.ai/api/mcp/auth_callback" })).toBe(null);
    expect(verifiedAI({ redirect_uri: "http://localhost:3000/callback" })).toBe(null);
    // An older server sends no redirect_uri: never verified.
    expect(verifiedAI({})).toBe(null);
    expect(destination("127.0.0.1", true)).toBe("an app on this computer");
  });

  it("titles an unverified app by its address, its own name only as a plain claim", () => {
    const base = { id: "x", redirect_host: "attacker.example", loopback: false, wants_write: true };
    expect(consentHeading({ ...base, client_name: "attacker.example", redirect_uri: "https://attacker.example/cb", claimed_name: "ciaude" }))
      .toEqual({ ai: null, who: "attacker.example", claimed: "ciaude" });
    // An older server with the raw name and no plain claim: the raw name is never shown.
    expect(consentHeading({ ...base, client_name: "Claude" }).claimed).toBe(null);
    expect(consentHeading({ ...base, client_name: "Claude", redirect_host: "claude.ai", redirect_uri: "https://claude.ai/api/mcp/auth_callback", claimed_name: "claude" }))
      .toEqual({ ai: "Claude", who: "Claude", claimed: null });
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

  it("explains an /authorize problem without echoing anything from the address", () => {
    expect(problemText("unknown_app")).toMatch(/doesn't know this app/);
    expect(problemText("<script>alert(1)</script>")).toMatch(/Start connecting again/);
    expect(problemText(undefined)).toMatch(/Start connecting again/);
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
      cookie: "sb-access-token=secret",
      "x-forwarded-host": "evil.example",
      "x-real-ip": "198.51.100.7",
      // A caller can't pretend to be the proxy.
      "x-mcp-client-ip": "1.2.3.4",
      "x-mcp-proxy-secret": "guess",
      "x-mcp-public-url": "https://evil.example",
    }), "secret");
    expect(h.get("authorization")).toBe("Bearer amb_at_x");
    expect(h.get("mcp-session-id")).toBe("s1");
    expect(h.get("host")).toBe(null);
    expect(h.get("mcp-protocol-version")).toBe(null);
    expect(h.get("x-mcp-public-url")).toBe("https://mcp.ambernotes.app");
    expect(h.get("x-mcp-client-ip")).toBe("198.51.100.7");
    expect(h.get("x-mcp-proxy-secret")).toBe("secret");
  });

  it("passes only the headers MCP needs", () => {
    const h = upstreamHeaders(new Headers({ cookie: "a=b", "x-forwarded-host": "evil.example", "mcp-protocol-version": "2025-06-18", origin: "https://ambernotes.app" }), "secret");
    expect(h.get("cookie")).toBe(null);
    expect(h.get("x-forwarded-host")).toBe(null);
    expect(h.get("mcp-protocol-version")).toBe("2025-06-18");
    expect(h.get("origin")).toBe("https://ambernotes.app");
  });

  it("serves only the server's own paths, nothing encoded", () => {
    for (const ok of ["/", "/register", "/authorize", "/token", "/revoke", "/connect/request", "/connect/decide", "/connect/release",
      "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server",
      "/.well-known/openid-configuration", "/.well-known/openai-apps-challenge"]) expect(allowedPath(ok), ok).toBe(true);
    for (const bad of ["/account", "/..%2faccount", "/authorize%2f..%2f..%2faccount", "/%5c..%5caccount", "/authorize\\..\\account",
      "/../share-files", "/.well-known/../../account", "/connect/decide/x", "/register/", "/%2e%2e/account", "/.env"]) expect(allowedPath(bad), bad).toBe(false);
  });
});
