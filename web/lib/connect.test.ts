import { afterEach, describe, expect, it, vi } from "vitest";
import { allowHeading, appleSignInURL, appLink, destination, fetchLabel, functionURL, pkcePair, problemText, returnURL, signInError, universalLink, validRequest } from "./connect";
import { allowedPath, upstream, upstreamHeaders } from "./mcp-proxy";

const ID = "5a0f6c1e-2b1d-4c36-9e0a-6b6f0c1a2b3c";

describe("the connect page", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("accepts only a request id", () => {
    expect(validRequest(ID)).toBe(true);
    expect(validRequest(undefined)).toBe(false);
    expect(validRequest("5a0f6c1e")).toBe(false);
    expect(validRequest("javascript:alert(1)")).toBe(false);
    expect(validRequest(`${ID}&x=1`)).toBe(false);
  });

  it("opens the app with the universal link, and the app's own scheme as the fallback", () => {
    expect(universalLink(ID.toUpperCase())).toBe(`https://ambernotes.app/open/connect?request=${ID}`);
    expect(appLink(ID.toUpperCase())).toBe(`ambernotes://connect?request=${ID}`);
  });

  it("names who is asking, or says it in general words", () => {
    expect(allowHeading({ client_name: "Claude", verified_ai: "Claude" })).toBe("Allow Claude to use your notes?");
    expect(allowHeading({ client_name: "attacker.example", verified_ai: null })).toBe("Allow attacker.example to use your notes?");
    expect(allowHeading(null)).toBe("Allow this app to use your notes?");
    // Anything odd from the server falls back to the general words.
    expect(allowHeading({ client_name: "<script>", verified_ai: null })).toBe("Allow this app to use your notes?");
    expect(allowHeading({ client_name: "x".repeat(80), verified_ai: null })).toBe("Allow this app to use your notes?");
  });

  it("comes back from Sign in with Apple to the same request, and to the recovery key when asked", () => {
    expect(returnURL("https://ambernotes.app", ID.toUpperCase())).toBe(`https://ambernotes.app/connect?request=${ID}`);
    expect(returnURL("https://ambernotes.app", ID, true)).toBe(`https://ambernotes.app/connect?request=${ID}&recover=1`);
    const u = new URL(appleSignInURL("https://ref.supabase.co/", returnURL("https://ambernotes.app", ID, true), "chal"));
    expect(u.origin + u.pathname).toBe("https://ref.supabase.co/auth/v1/authorize");
    expect(u.searchParams.get("provider")).toBe("apple");
    expect(u.searchParams.get("redirect_to")).toBe(`https://ambernotes.app/connect?request=${ID}&recover=1`);
    expect(u.searchParams.get("code_challenge")).toBe("chal");
    expect(u.searchParams.get("code_challenge_method")).toBe("s256");
  });

  it("makes a PKCE pair whose challenge is the verifier's S256", async () => {
    const { verifier, challenge } = await pkcePair();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{64}$/);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    expect(challenge).toBe(Buffer.from(digest).toString("base64url"));
  });

  it("says why sign-in failed in plain words", () => {
    expect(signInError(400, { error_code: "invalid_credentials" })).toBe("The email or password isn't right.");
    expect(signInError(400, { error_code: "email_not_confirmed" })).toBe("Confirm your email first, then sign in.");
    expect(signInError(429, null)).toMatch(/Too many attempts/);
    expect(signInError(500, null)).toMatch(/Check your connection/);
    expect(destination("x.example", false)).toBe("x.example");
    expect(destination("127.0.0.1", true)).toBe("an app on this computer");
  });

  it("asks the function's /connect/label, and gives up quietly", async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ client_name: "ChatGPT", verified_ai: "ChatGPT", extra: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const headers = new Headers({ "x-mcp-client-ip": "198.51.100.7" });
    expect(await fetchLabel("https://ref.supabase.co/functions/v1/mcp", ID.toUpperCase(), headers)).toEqual({ client_name: "ChatGPT", verified_ai: "ChatGPT" });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://ref.supabase.co/functions/v1/mcp/connect/label?id=${ID}`);
    expect(init.headers).toBe(headers);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "expired" }), { status: 404 })));
    expect(await fetchLabel("https://x", ID, new Headers())).toBe(null);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await fetchLabel("https://x", ID, new Headers())).toBe(null);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ client_name: "Evil", verified_ai: "Evil AI" }))));
    expect(await fetchLabel("https://x", ID, new Headers())).toEqual({ client_name: "Evil", verified_ai: null });
    const never = vi.fn();
    vi.stubGlobal("fetch", never);
    expect(await fetchLabel("https://x", "../token", new Headers())).toBe(null);
    expect(never).not.toHaveBeenCalled();
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
    for (const ok of ["/", "/register", "/authorize", "/token", "/revoke", "/connect/request", "/connect/label", "/connect/ask", "/connect/status", "/connect/decide", "/connect/release",
      "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server",
      "/.well-known/openid-configuration", "/.well-known/openai-apps-challenge", "/.well-known/mcp/server-card.json"]) expect(allowedPath(ok), ok).toBe(true);
    for (const bad of ["/account", "/..%2faccount", "/authorize%2f..%2f..%2faccount", "/%5c..%5caccount", "/authorize\\..\\account",
      "/../share-files", "/.well-known/../../account", "/connect/decide/x", "/connect/label/x", "/connect/status/x", "/connect/asks", "/connect%2fask", "/connect/labels", "/register/", "/%2e%2e/account", "/.env"]) expect(allowedPath(bad), bad).toBe(false);
  });
});
