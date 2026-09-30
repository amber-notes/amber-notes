import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { browserFrom, newCode, parseKeyRow, recoveryApproval, RecoveryError, sha256Hex, statusStep, withCode } from "./connect-flow";
import { fromBase64, toBase64, tokenKey, unwrap } from "./e2ee";

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

describe("reading /connect/status", () => {
  const redirect = "https://claude.ai/api/mcp/auth_callback?state=s";
  it("goes on with an approval only when it carries a redirect and a handoff", () => {
    expect(statusStep({ state: "approved", redirect, handoff: v.handoff.sealed }, 0, null)).toEqual({ kind: "approved", redirect, handoff: v.handoff.sealed });
    expect(statusStep({ state: "approved", redirect, handoff: "not a box" }, 0, null)).toEqual({ kind: "wait" });
    expect(statusStep({ state: "approved", redirect: "nope", handoff: v.handoff.sealed }, 0, null)).toEqual({ kind: "wait" });
  });

  it("follows a denial back to the app", () => {
    expect(statusStep({ state: "denied", redirect }, 0, null)).toEqual({ kind: "denied", redirect });
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
