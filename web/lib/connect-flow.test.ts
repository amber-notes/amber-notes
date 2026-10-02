import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  browserFrom, isMacBrowser, keyFingerprint, newScan, scanAppLink, scanLink, scanRequest, newCode, newPageNonce, newPickup, pageCommit, pageNumber, parseKeyRow, recoveryApproval, RecoveryError, revealRequest, safeDeniedRedirect,
  sealedDestination, sha256Hex, statusRequest, statusStep, withCode,
} from "./connect-flow";
import { fromBase64, openHandoff, toBase64, tokenKey, unwrap } from "./e2ee";

const v = JSON.parse(readFileSync(new URL("../../supabase/functions/_shared/e2ee-vectors.json", import.meta.url), "utf8"));
const row = { key_id: v.key_id, verifier: v.verifier, recovery_wrap: v.recovery.wrap };

describe("naming this browser for the ask", () => {
  const cases: [string, string][] = [
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", "Safari on an iPhone"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", "Chrome on a Mac"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", "Safari on a Mac"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox on Windows"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0", "Edge on Windows"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1", "Chrome on an iPhone"],
    ["Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15", "Firefox on an iPad"],
    ["Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36", "Chrome on Android"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 OPR/114.0.0.0", "Opera on Linux"],
    ["Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36", "Chrome on a Chromebook"],
    ["Mozilla/5.0 (Windows NT 10.0) SomeBrowser/1.0", "a web browser on Windows"],
    ["", "a web browser"],
  ];
  for (const [ua, from] of cases) it(from, () => expect(browserFrom(ua)).toBe(from));
});

describe("the AI's redirect with the code", () => {
  it("adds the code and keeps the redirect's own parameters", () => {
    const u = new URL(withCode("https://chatgpt.com/connector_platform_oauth_redirect?state=abc&iss=https%3A%2F%2Fmcp.ambernotes.app", "amb_code_1"));
    expect(u.origin + u.pathname).toBe("https://chatgpt.com/connector_platform_oauth_redirect");
    expect(u.searchParams.get("state")).toBe("abc");
    expect(u.searchParams.get("iss")).toBe("https://mcp.ambernotes.app");
    expect(u.searchParams.get("code")).toBe("amb_code_1");
  });

  it("works for a loopback redirect and replaces a code already there", () => {
    expect(withCode("http://127.0.0.1:53682/callback?code=old&state=s", "amb_code_2")).toBe("http://127.0.0.1:53682/callback?code=amb_code_2&state=s");
  });
});

describe("the pickup secret", () => {
  it("is 32 random bytes as lowercase hex, and its hash is SHA-256 of those bytes", async () => {
    const bytes = new Uint8Array(32).map((_, i) => i);
    const p = await newPickup(bytes);
    expect(p.pickup).toBe(Buffer.from(bytes).toString("hex"));
    const { createHash } = await import("node:crypto");
    expect(p.pickup_hash).toBe(createHash("sha256").update(bytes).digest("hex"));
    expect(p.pickup_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the shared vector the server is checked against", async () => {
    const raw = Uint8Array.from(Buffer.from(v.pickup.secret, "hex"));
    const p = await newPickup(raw);
    expect([p.pickup, p.pickup_hash]).toEqual([v.pickup.secret, v.pickup.hash]);
  });

  it("is new each time", async () => {
    const [a, b] = [await newPickup(), await newPickup()];
    expect(a.pickup).toMatch(/^[0-9a-f]{64}$/);
    expect(a.pickup).not.toBe(b.pickup);
    expect(a.pickup_hash).not.toBe(b.pickup_hash);
  });

  it("goes to /connect/status in a POST body, never the address", () => {
    const [url, init] = statusRequest("https://ref.supabase.co/functions/v1/mcp", v.handoff.request_id, "ab".repeat(32));
    expect(url).toBe("https://ref.supabase.co/functions/v1/mcp/connect/status");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ id: v.handoff.request_id, pickup: "ab".repeat(32) });
  });
});

const hexBytes = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));

describe("the commit and the number to type", () => {
  const pub = fromBase64(v.handoff.browser_public);
  const np = hexBytes(v.handoff.page_nonce);

  it("commits to the page key and its nonce as the vector does", async () => {
    expect(await pageCommit(pub, np)).toBe(v.handoff.commit);
    expect(v.handoff.commit).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the vector's two digits from the page key, both nonces and the request", async () => {
    expect(await pageNumber(pub, np, v.handoff.device_nonce, v.handoff.request_id)).toBe(v.handoff.match_number);
    expect(await pageNumber(pub, np, v.handoff.device_nonce, v.handoff.request_id.toUpperCase())).toBe(v.handoff.match_number);
  });

  it("the page nonce is 16 random bytes", () => {
    const [a, b] = [newPageNonce(), newPageNonce()];
    expect(a.length).toBe(16);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(() => newPageNonce(new Uint8Array(15))).toThrow();
  });

  it("reveals the page nonce as hex with the pickup secret, in a POST body", () => {
    const [url, init] = revealRequest("https://ref.supabase.co/functions/v1/mcp", v.handoff.request_id, "ab".repeat(32), np);
    expect(url).toBe("https://ref.supabase.co/functions/v1/mcp/connect/reveal");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ id: v.handoff.request_id, pickup: "ab".repeat(32), nonce: v.handoff.page_nonce });
  });
});

describe("reading /connect/status", () => {
  const redirect = "https://claude.ai/api/mcp/auth_callback?state=s";
  it("goes on with an approval only when it carries a handoff, whatever its redirect says", () => {
    expect(statusStep({ state: "approved", handoff: v.handoff.sealed }, 0, null)).toEqual({ kind: "approved", handoff: v.handoff.sealed });
    expect(statusStep({ state: "approved", redirect: "https://evil.example/", handoff: v.handoff.sealed }, 0, null)).toEqual({ kind: "approved", handoff: v.handoff.sealed });
    expect(statusStep({ state: "approved", redirect, handoff: "not a box" }, 0, null)).toEqual({ kind: "wait" });
  });

  it("follows a denial back only to https or to http on this computer", () => {
    expect(statusStep({ state: "denied", redirect }, 0, null)).toEqual({ kind: "denied", redirect });
    for (const ok of ["http://127.0.0.1:53682/callback?error=access_denied", "http://localhost:3000/cb", "http://[::1]:8080/cb"]) {
      expect(statusStep({ state: "denied", redirect: ok }, 0, null), ok).toEqual({ kind: "denied", redirect: ok });
    }
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "http://evil.example/cb", "http://127.0.0.1.evil.example/cb", "http://localhost.evil.example/",
      "ambernotes://connect", "ftp://example.com/", "https://user:pw@example.com/", "not a url", 42, null]) {
      expect(safeDeniedRedirect(bad), String(bad)).toBeNull();
      expect(statusStep({ state: "denied", redirect: bad }, 0, null), String(bad)).toEqual({ kind: "denied", redirect: null });
    }
  });

  it("says declined when a denial comes without a redirect", () => {
    expect(statusStep({ state: "denied" }, 0, null)).toEqual({ kind: "denied", redirect: null });
  });

  it("reveals only once the device's nonce is in", () => {
    expect(statusStep({ state: "asked", device_nonce: null }, 0, null)).toEqual({ kind: "wait" });
    expect(statusStep({ state: "asked" }, 0, null)).toEqual({ kind: "wait" });
    for (const odd of ["", "abc", "zz".repeat(16), "60".repeat(17), 7]) {
      expect(statusStep({ state: "asked", device_nonce: odd }, 0, null), String(odd)).toEqual({ kind: "wait" });
    }
    expect(statusStep({ state: "asked", device_nonce: v.handoff.device_nonce }, 0, null)).toEqual({ kind: "deviceReady", deviceNonce: v.handoff.device_nonce });
    expect(statusStep({ state: "asked", device_nonce: v.handoff.device_nonce.toUpperCase() }, 0, null)).toEqual({ kind: "deviceReady", deviceNonce: v.handoff.device_nonce });
    expect(statusStep({ state: "pending", device_nonce: v.handoff.device_nonce }, 0, null)).toEqual({ kind: "wait" });
    expect(statusStep({ state: "asked", device_nonce: v.handoff.device_nonce }, 2000, 2000)).toEqual({ kind: "expired" });
  });

  it("ends on the other answers", () => {
    expect(statusStep({ state: "answered_in_app" }, 0, null)).toEqual({ kind: "answeredInApp" });
    expect(statusStep({ state: "delivered" }, 0, null)).toEqual({ kind: "delivered" });
    expect(statusStep({ state: "expired" }, 0, null)).toEqual({ kind: "expired" });
  });

  it("waits while pending or asked, or when the answer is odd, until the request expires", () => {
    expect(statusStep({ state: "asked" }, 1000, 2000)).toEqual({ kind: "wait" });
    expect(statusStep({ state: "pending" }, 1000, null)).toEqual({ kind: "wait" });
    expect(statusStep(null, 1000, 2000)).toEqual({ kind: "wait" });
    expect(statusStep({ state: "asked" }, 2000, 2000)).toEqual({ kind: "expired" });
    expect(statusStep(null, 3000, 2000)).toEqual({ kind: "expired" });
  });
});

describe("going on after an approval", () => {
  async function opened(): Promise<string> {
    // The vector's page key, as the page holds it.
    const pub = fromBase64(v.handoff.browser_public);
    const jwk = {
      kty: "EC", crv: "P-256", ext: true,
      d: Buffer.from(fromBase64(v.handoff.browser_private)).toString("base64url"),
      x: Buffer.from(pub.subarray(1, 33)).toString("base64url"),
      y: Buffer.from(pub.subarray(33, 65)).toString("base64url"),
    };
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    return openHandoff(v.handoff.sealed, key, v.handoff.request_id);
  }

  it("goes to the redirect sealed with the code, with the code added", async () => {
    const sealed = JSON.parse(v.handoff.code) as { code: string; redirect: string };
    const to = new URL(sealedDestination(await opened()));
    const want = new URL(sealed.redirect);
    expect(to.origin + to.pathname).toBe(want.origin + want.pathname);
    expect(to.searchParams.get("state")).toBe("s1");
    expect(to.searchParams.get("iss")).toBe("https://mcp.ambernotes.app");
    expect(to.searchParams.get("code")).toBe(sealed.code);
  });

  it("never takes the unsealed redirect from /connect/status", async () => {
    const step = statusStep({ state: "approved", redirect: "https://evil.example/cb", handoff: v.handoff.sealed }, 0, null);
    expect(step.kind).toBe("approved");
    expect(Object.keys(step)).not.toContain("redirect");
    expect(new URL(sealedDestination(await opened())).hostname).toBe("claude.ai");
  });

  it("refuses a handoff that isn't a payload, or seals a script address", () => {
    expect(() => sealedDestination("amb_code_" + "cd".repeat(32))).toThrow();
    expect(() => sealedDestination(JSON.stringify({ code: "c" }))).toThrow();
    expect(() => sealedDestination(JSON.stringify({ code: "c", redirect: "javascript:alert(1)" }))).toThrow();
    expect(sealedDestination(JSON.stringify({ code: "c", redirect: "http://127.0.0.1:53682/callback" }))).toBe("http://127.0.0.1:53682/callback?code=c");
  });
});

describe("approving with the recovery key", () => {
  it("makes a code, its hash and the data key wrapped under it", async () => {
    const code = "amb_code_" + "cd".repeat(32);
    const a = await recoveryApproval(v.recovery.typed, v.user_id, row, code);
    expect(a.code).toBe(code);
    expect(a.code_hash).toBe(await sha256Hex(code));
    expect(a.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.code_wrap.split(".")[1]).toBe(v.key_id);
    const dk = await unwrap(a.code_wrap, await tokenKey(code, "code"), "code", v.user_id);
    expect(toBase64(dk)).toBe(v.data_key);
  });

  it("says when the key has a typo, before any key work", async () => {
    await expect(recoveryApproval("60RK-4CSM", v.user_id, row)).rejects.toThrow("That recovery key has a typo. Check it and try again.");
    await expect(recoveryApproval(v.recovery.text.replace(/^6/, "7"), v.user_id, row)).rejects.toBeInstanceOf(RecoveryError);
  });

  it("says when it's another account's key", async () => {
    const wrong = "That recovery key isn't the one for this account.";
    // A different, valid recovery key.
    const { recoveryKeyText } = await import("./e2ee");
    const other = await recoveryKeyText(new Uint8Array(16).fill(7));
    await expect(recoveryApproval(other, v.user_id, row)).rejects.toThrow(wrong);
    // The right key, but for someone else's id.
    await expect(recoveryApproval(v.recovery.typed, "00000000-0000-4000-8000-000000000000", row)).rejects.toThrow(wrong);
    // The wrap opens, but the verifier on record is another key's.
    await expect(recoveryApproval(v.recovery.typed, v.user_id, { ...row, verifier: "0".repeat(64) })).rejects.toThrow(wrong);
  });

  it("makes codes the server takes", () => {
    expect(newCode()).toMatch(/^amb_code_[0-9a-f]{64}$/);
    expect(newCode()).not.toBe(newCode());
  });

  it("reads the key row, or none", () => {
    expect(parseKeyRow([row])).toEqual(row);
    expect(parseKeyRow([])).toBe(null);
    expect(parseKeyRow({ error: "x" })).toBe(null);
    expect(parseKeyRow([{ key_id: 1 }])).toBe(null);
    expect(fromBase64(v.data_key).length).toBe(32);
  });
});

describe("the QR code's secret, key fingerprint and links", () => {
  const ID = "5a0f6c1e-2b1d-4c36-9e0a-6b6f0c1a2b3c";

  it("makes a 22-character base64url scan secret and the hex SHA-256 of its text", async () => {
    const bytes = Uint8Array.from({ length: 16 }, (_, i) => 250 - i * 7);
    const { scan, scan_hash } = await newScan(bytes);
    expect(scan).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Buffer.from(scan, "base64url")).toEqual(Buffer.from(bytes));
    expect(scan_hash).toBe(await sha256Hex(scan));
    expect(scan_hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await newScan()).scan).not.toBe((await newScan()).scan);
    await expect(newScan(new Uint8Array(15))).rejects.toThrow();
  });

  it("names the page's key by the base64url SHA-256 of its 65 raw bytes", async () => {
    const raw = fromBase64(v.handoff.browser_public);
    const fp = await keyFingerprint(raw);
    expect(fp).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const want = Buffer.from(await crypto.subtle.digest("SHA-256", raw)).toString("base64url");
    expect(fp).toBe(want);
    await expect(keyFingerprint(new Uint8Array(64))).rejects.toThrow();
  });

  it("puts the secret and fingerprint in the fragment of the universal link and the app's scheme", async () => {
    const { scan } = await newScan();
    const fp = await keyFingerprint(fromBase64(v.handoff.browser_public));
    const link = scanLink(ID.toUpperCase(), scan, fp);
    expect(link).toBe(`https://ambernotes.app/open/connect?request=${ID}#s=${scan}&k=${fp}`);
    const u = new URL(link);
    expect(u.search).toBe(`?request=${ID}`);
    expect(u.hash).toBe(`#s=${scan}&k=${fp}`);
    expect(scanAppLink(ID, scan, fp)).toBe(`ambernotes://connect?request=${ID}#s=${scan}&k=${fp}`);
    expect(() => scanLink(ID, "short", fp)).toThrow();
    expect(() => scanLink(ID, scan, fp + "&x=1")).toThrow();
  });

  it("posts /connect/scan with no session", () => {
    const body = { id: ID, browser_key: v.handoff.browser_public, pickup_hash: "a".repeat(64), scan_hash: "b".repeat(64), from: "Safari on a Mac" };
    const [url, init] = scanRequest("https://ref.supabase.co/functions/v1/mcp", body);
    expect(url).toBe("https://ref.supabase.co/functions/v1/mcp/connect/scan");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(body);
    expect(JSON.stringify(init.headers)).not.toMatch(/authorization/i);
  });

  it("tells a Mac's browser from an iPhone's and an iPad's", () => {
    const macUA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
    expect(isMacBrowser("MacIntel", macUA, 0)).toBe(true);
    expect(isMacBrowser("", macUA)).toBe(true);
    // iPadOS Safari says it's a Mac but has touch.
    expect(isMacBrowser("MacIntel", macUA, 5)).toBe(false);
    expect(isMacBrowser("iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)", 5)).toBe(false);
    expect(isMacBrowser("iPad", "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", 5)).toBe(false);
    expect(isMacBrowser("Win32", "Mozilla/5.0 (Windows NT 10.0; Win64; x64)", 0)).toBe(false);
    expect(isMacBrowser("Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64)", 0)).toBe(false);
  });
});
