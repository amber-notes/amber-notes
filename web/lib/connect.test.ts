import { afterEach, describe, expect, it, vi } from "vitest";
import { ALLOW_HEADING, appleSignInURL, appLink, destination, fetchLabel, functionURL, parseLabel, pkcePair, problemText, qrConnectLive, returnURL, scanFragment, signInError, startsWithWrite, universalLink, validRequest } from "./connect";
import { allowedPath, functionRegion, upstream, upstreamHeaders } from "./mcp-proxy";

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

  it("starts at the access the app asked for, not at Read only", () => {
    expect(startsWithWrite({ wants_write: true })).toBe(true);
    expect(startsWithWrite({ wants_write: false })).toBe(false);
  });

  it("never makes an app's name the title", () => {
    expect(ALLOW_HEADING).toBe("Allow this app to use your notes?");
  });

  it("reads what the app calls itself and where access goes, and nothing odd", () => {
    expect(parseLabel({ claimed_name: "Claude", redirect_host: "claude.ai", verified_ai: null }))
      .toEqual({ claimed_name: "Claude", redirect_host: "claude.ai", loopback: false });
    expect(parseLabel({ client_name: "an app on this computer", claimed_name: null, redirect_host: "127.0.0.1", verified_ai: null }))
      .toEqual({ claimed_name: null, redirect_host: "127.0.0.1", loopback: true });
    expect(parseLabel({ claimed_name: "<script>", redirect_host: "x.example" })).toEqual({ claimed_name: null, redirect_host: "x.example", loopback: false });
    expect(parseLabel({ claimed_name: "x".repeat(80), redirect_host: "evil.example/<b>" })).toBe(null);
    expect(parseLabel(null)).toBe(null);
    // A mark from the server is never taken.
    expect(parseLabel({ claimed_name: "ChatGPT", redirect_host: "chatgpt.com", verified_ai: "ChatGPT" })).not.toHaveProperty("verified_ai");
  });

  it("comes back from Sign in with Apple to the same request, and to the recovery key when asked", () => {
    expect(returnURL("https://ambernotes.app", ID.toUpperCase())).toBe(`https://ambernotes.app/connect?request=${ID}`);
    expect(returnURL("https://ambernotes.app", ID, true)).toBe(`https://ambernotes.app/connect?request=${ID}&recover=1`);
    expect(returnURL("https://ambernotes.app", ID, false, true)).toBe(`https://ambernotes.app/connect?request=${ID}&qr=1`);
    expect(returnURL("https://ambernotes.app", ID, true, true)).toBe(`https://ambernotes.app/connect?request=${ID}&recover=1&qr=1`);
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
    const fetch = vi.fn(async () => new Response(JSON.stringify({ claimed_name: "ChatGPT", redirect_host: "chatgpt.com", verified_ai: null, extra: 1 }), { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const headers = new Headers({ "x-mcp-client-ip": "198.51.100.7" });
    expect(await fetchLabel("https://ref.supabase.co/functions/v1/mcp", ID.toUpperCase(), headers)).toEqual({ claimed_name: "ChatGPT", redirect_host: "chatgpt.com", loopback: false });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://ref.supabase.co/functions/v1/mcp/connect/label?id=${ID}`);
    expect(init.headers).toBe(headers);

    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "expired" }), { status: 404 })));
    expect(await fetchLabel("https://x", ID, new Headers())).toBe(null);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await fetchLabel("https://x", ID, new Headers())).toBe(null);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ claimed_name: "Evil", redirect_host: "evil.example", verified_ai: "Claude" }))));
    expect(await fetchLabel("https://x", ID, new Headers())).toEqual({ claimed_name: "Evil", redirect_host: "evil.example", loopback: false });
    const never = vi.fn();
    vi.stubGlobal("fetch", never);
    expect(await fetchLabel("https://x", "../token", new Headers())).toBe(null);
    expect(never).not.toHaveBeenCalled();
  });

  it("explains an /authorize problem without echoing anything from the address", () => {
    expect(problemText("unknown_app")).toMatch(/doesn't know this app/);
    expect(problemText("unknown_app")).toMatch(/In Claude.*In ChatGPT.*https:\/\/mcp\.ambernotes\.app/);
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
    for (const ok of ["/", "/register", "/authorize", "/token", "/revoke", "/connect/request", "/connect/label", "/connect/ask", "/connect/scan", "/connect/status", "/connect/nonce", "/connect/reveal", "/connect/decide", "/connect/release",
      "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server",
      "/.well-known/openid-configuration", "/.well-known/mcp/server-card.json"]) expect(allowedPath(ok), ok).toBe(true);
    for (const bad of ["/account", "/..%2faccount", "/authorize%2f..%2f..%2faccount", "/%5c..%5caccount", "/authorize\\..\\account",
      "/../share-files", "/.well-known/../../account", "/connect/decide/x", "/connect/label/x", "/connect/status/x", "/connect/asks", "/connect/scans", "/connect/scan/x", "/connect/reveal/x", "/connect/nonces", "/connect%2freveal", "/connect%2fask", "/connect/labels", "/register/", "/%2e%2e/account", "/.env"]) expect(allowedPath(bad), bad).toBe(false);
  });
});

describe("where the site sends function calls", () => {
  it("names the home region when one is set, and a caller can't name another", () => {
    expect(functionRegion("eu-central-1")).toBe("eu-central-1");
    expect(functionRegion(" EU-Central-1 ")).toBe("eu-central-1");
    for (const bad of [undefined, "", "frankfurt", "eu-central-1; x", "eu_central_1"]) expect(functionRegion(bad)).toBeNull();
    const asked = new Headers({ authorization: "Bearer amb_at_x", "x-region": "us-east-1", "x-real-ip": "198.51.100.7" });
    expect(upstreamHeaders(asked, "secret", "eu-central-1").get("x-region")).toBe("eu-central-1");
    // No home region set: nothing is asked for, and the caller's own x-region still doesn't pass.
    expect(upstreamHeaders(asked, "secret").has("x-region")).toBe(false);
  });
});

describe("which connect page shows", () => {
  it("is the QR page only once the public release can scan it", () => {
    for (const older of ["1.0", "1.1", "1.1.2"]) expect(qrConnectLive(older), older).toBe(false);
    for (const newer of ["1.2", "1.2.1", "1.10", "2.0"]) expect(qrConnectLive(newer), newer).toBe(true);
    expect(qrConnectLive(null)).toBe(false);
  });

  it("shows the QR page early with ?qr=1, and with nothing else", () => {
    expect(qrConnectLive("1.1.2", "1")).toBe(true);
    expect(qrConnectLive(null, "1")).toBe(true);
    for (const other of ["0", "true", "", "11"]) expect(qrConnectLive("1.1.2", other), other).toBe(false);
  });
});

describe("the QR code's fragment on /open/connect", () => {
  const s = "q4Xb7Tz2LmNp8RsVw1Yc3A", k = "Jx3kQ9vR2mT7wY5zA1bC4dE6fG8hI0jK2lM4nO6pQ8r";

  it("passes on exactly #s=<22>&k=<43>", () => {
    expect(scanFragment(`#s=${s}&k=${k}`)).toBe(`#s=${s}&k=${k}`);
    expect(scanFragment(`s=${s}&k=${k}`)).toBe(`#s=${s}&k=${k}`);
  });

  it("drops anything else", () => {
    for (const hash of ["", "#", null, undefined, `#k=${k}&s=${s}`, `#s=${s}`, `#s=${s}x&k=${k}`, `#s=${s}&k=${k}&x=1`,
      `#s=${s}&k=${k.slice(1)}`, `#s=${s.slice(0, 21)}+&k=${k}`, `#s=${s}&k=${k}"><script>`]) {
      expect(scanFragment(hash), String(hash)).toBeNull();
    }
  });
});
