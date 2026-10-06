// The page's copy of the shared crypto, checked against the shared file and against the vectors
// the Swift and Deno tests also check (supabase/functions/_shared/e2ee-vectors.json).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  canonicalRecoveryKey, fromBase64, keyIdOf, openHandoff, parseRecoveryKey, recoveryKEK, sealHandoff, tokenKey, toBase64, unwrap, verifierOf, wrap,
} from "./e2ee";

const shared = (name: string) => readFileSync(new URL(`../../supabase/functions/_shared/${name}`, import.meta.url), "utf8");
const v = JSON.parse(shared("e2ee-vectors.json"));
const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");

/// The vector's browser key: the raw P-256 scalar and public point, imported as a JWK.
async function browserPrivate(): Promise<CryptoKey> {
  const pub = fromBase64(v.handoff.browser_public);
  return crypto.subtle.importKey("jwk", {
    kty: "EC", crv: "P-256", d: b64url(fromBase64(v.handoff.browser_private)), x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33, 65)),
  }, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
}

describe("the page's e2ee code", () => {
  it("is the shared file, byte for byte", () => {
    const copy = readFileSync(new URL("./e2ee.ts", import.meta.url), "utf8").replace(/^(?:\/\/ web copy:.*\n)+\n/, "");
    expect(copy === shared("e2ee.ts"), "web/lib/e2ee.ts differs from supabase/functions/_shared/e2ee.ts: run pnpm -C web e2ee:copy").toBe(true);
  });

  it("reads a typed recovery key as the vectors do", async () => {
    expect(canonicalRecoveryKey(v.recovery.typed)).toBe(v.recovery.canonical);
    expect(toBase64((await parseRecoveryKey(v.recovery.typed))!)).toBe(v.recovery.bytes);
    expect(toBase64((await parseRecoveryKey(v.recovery.text))!)).toBe(v.recovery.bytes);
    // One wrong character fails the check.
    expect(await parseRecoveryKey(v.recovery.text.replace(/^6/, "7"))).toBe(null);
    expect(await parseRecoveryKey("too short")).toBe(null);
  });

  it("opens the recovery wrap to the data key, whose verifier matches", async () => {
    const kek = await recoveryKEK((await parseRecoveryKey(v.recovery.typed))!, v.user_id);
    const dk = await unwrap(v.recovery.wrap, kek, "recovery", v.user_id);
    expect(toBase64(dk)).toBe(v.data_key);
    expect(await keyIdOf(dk)).toBe(v.key_id);
    expect(await verifierOf(dk, v.user_id)).toBe(v.verifier);
    // Another account's id opens nothing.
    const other = await recoveryKEK((await parseRecoveryKey(v.recovery.typed))!, "00000000-0000-4000-8000-000000000000");
    await expect(unwrap(v.recovery.wrap, other, "recovery", v.user_id)).rejects.toThrow();
  });

  it("wraps the data key under a code exactly as the vectors do", async () => {
    const dk = fromBase64(v.data_key);
    const sealed = await wrap(dk, await tokenKey(v.tokens.code, "code"), "code", v.user_id, fromBase64(v.nonce));
    expect(sealed).toBe(v.tokens.wraps.code);
    expect(toBase64(await unwrap(v.tokens.wraps.code, await tokenKey(v.tokens.code, "code"), "code", v.user_id))).toBe(v.data_key);
  });

  it("opens the vectors' handoff with the fixed browser key, and only for its request", async () => {
    const key = await browserPrivate();
    expect(await openHandoff(v.handoff.sealed, key, v.handoff.request_id)).toBe(v.handoff.code);
    await expect(openHandoff(v.handoff.sealed, key, "33333333-3333-4444-8555-666666666666")).rejects.toThrow();
  });

  it("opens a handoff sealed to a fresh page key", async () => {
    const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const sealed = await sealHandoff("amb_code_x", raw, v.handoff.request_id);
    expect(await openHandoff(sealed, pair.privateKey, v.handoff.request_id)).toBe("amb_code_x");
  });
});
