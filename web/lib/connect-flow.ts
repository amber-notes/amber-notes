// The connect page's steps that don't touch the screen: naming this browser for the ask, the
// pickup secret, reading /connect/status, going on to the AI with the sealed code and redirect, and
// approving with the recovery key.
// The page (app/connect/ConnectFlow.tsx) does the fetching and the showing. See lib/connect.ts.
import { HANDOFF, hex, matchNumber, parseRecoveryKey, readHandoffPayload, recoveryKEK, tokenKey, unwrap, verifierOf, wrap } from "./e2ee";

/// This browser in plain words for the devices' prompt ("Chrome on a Mac"). Only the browser's
/// and the system's names, nothing else from the user agent.
export function browserFrom(ua: string): string {
  const browser =
    /\bEdg(?:e|A|iOS)?\//.test(ua) ? "Edge" :
    /\b(?:OPR|Opera)\//.test(ua) ? "Opera" :
    /\b(?:Firefox|FxiOS)\//.test(ua) ? "Firefox" :
    /\b(?:Chrome|CriOS|Chromium)\//.test(ua) ? "Chrome" :
    /\bSafari\//.test(ua) && /\bVersion\//.test(ua) ? "Safari" :
    null;
  const system =
    /\biPhone\b/.test(ua) ? "an iPhone" :
    /\biPad\b/.test(ua) ? "an iPad" :
    /\bAndroid\b/.test(ua) ? "Android" :
    /\bCrOS\b/.test(ua) ? "a Chromebook" :
    /\bMacintosh\b|\bMac OS X\b/.test(ua) ? "a Mac" :
    /\bWindows\b/.test(ua) ? "Windows" :
    /\bLinux\b/.test(ua) ? "Linux" :
    null;
  if (browser && system) return `${browser} on ${system}`;
  if (browser) return browser;
  if (system) return `a web browser on ${system}`;
  return "a web browser";
}

/// The AI's redirect with the authorization code added, its own parameters kept.
export function withCode(redirect: string, code: string): string {
  const u = new URL(redirect);
  u.searchParams.set("code", code);
  return u.toString();
}

/// The pickup secret: 32 random bytes only this page holds. /connect/ask gets its hash (lowercase hex
/// SHA-256 of the raw bytes), and /connect/status hands the answer over only to the secret itself
/// (the 32 bytes as lowercase hex). Someone who learns the request id can't collect the answer.
export async function newPickup(bytes: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(32))):
  Promise<{ pickup: string; pickup_hash: string }> {
  if (bytes.length !== 32) throw new Error("a pickup secret is 32 bytes");
  return { pickup: hex(bytes), pickup_hash: hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))) };
}

/// The two digits the page shows after the ask; the device shows three and you tap this one.
export const pageNumber = (browserPublicRaw: Uint8Array, requestId: string) => matchNumber(browserPublicRaw, requestId);

/// The /connect/status call: a POST with the pickup secret, never the secret in the address.
export function statusRequest(functionBase: string, id: string, pickup: string): [string, RequestInit] {
  return [`${functionBase}/connect/status`, {
    method: "POST", cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, pickup }),
  }];
}

/// What the page does after a /connect/status answer.
export type Step =
  | { kind: "wait" }
  | { kind: "approved"; handoff: string }
  | { kind: "denied"; redirect: string }
  | { kind: "answeredInApp" }
  | { kind: "delivered" }
  | { kind: "expired" };

/// A redirect the page may go to: any address an OAuth client can register (https, loopback http,
/// an app's own scheme), never one that runs or shows content in this page.
const NEVER = new Set(["javascript:", "data:", "blob:", "file:", "vbscript:", "about:"]);
const isWebURL = (s: unknown): s is string => {
  if (typeof s !== "string") return false;
  try { return !NEVER.has(new URL(s).protocol); } catch { return false; }
};

/// Reads a /connect/status body. Past `expiresAt` (ms), waiting ends. Anything odd means wait.
/// An approval carries only the sealed handoff: where it goes comes from inside it (sealedDestination),
/// never from the answer's own `redirect`, which anyone on the way could change.
export function statusStep(body: unknown, now: number, expiresAt: number | null): Step {
  const b = (body ?? {}) as { state?: unknown; redirect?: unknown; handoff?: unknown };
  switch (b.state) {
    case "approved":
      if (typeof b.handoff === "string" && HANDOFF.test(b.handoff)) return { kind: "approved", handoff: b.handoff };
      break;
    case "denied":
      if (isWebURL(b.redirect)) return { kind: "denied", redirect: b.redirect };
      break;
    case "answered_in_app": return { kind: "answeredInApp" };
    case "delivered": return { kind: "delivered" };
    case "expired": return { kind: "expired" };
  }
  return expiresAt !== null && now >= expiresAt ? { kind: "expired" } : { kind: "wait" };
}

/// Where an approval goes: the redirect sealed with the code by the device that approved, with the
/// code added. Throws when the opened handoff isn't a payload with a web address.
export function sealedDestination(opened: string): string {
  const p = readHandoffPayload(opened);
  if (!isWebURL(p.redirect)) throw new Error("not a redirect");
  return withCode(p.redirect, p.code);
}

/// A one-minute, single-use authorization code, as the app makes it.
export function newCode(): string {
  return "amb_code_" + hex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function sha256Hex(s: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
}

/// The account's row in account_keys: what the server keeps, none of it a key.
export type AccountKey = { key_id: string; verifier: string; recovery_wrap: string };

export class RecoveryError extends Error {
  constructor(readonly reason: "typo" | "wrong") {
    super(reason === "typo" ? "That recovery key has a typo. Check it and try again." : "That recovery key isn't the one for this account.");
  }
}

/// Approving with the recovery key, all in this page: open the notes' key with the typed recovery
/// key, check it's this account's, make a code and wrap the notes' key under it. What comes back
/// is what /connect/decide takes, plus the code for the redirect. The key bytes are wiped here.
export async function recoveryApproval(typed: string, userId: string, row: AccountKey, code = newCode()):
  Promise<{ code: string; code_hash: string; code_wrap: string }> {
  const recovery = await parseRecoveryKey(typed);
  if (!recovery) throw new RecoveryError("typo");
  let dk: Uint8Array<ArrayBuffer> | null = null;
  try {
    const kek = await recoveryKEK(recovery, userId);
    recovery.fill(0);
    try {
      dk = await unwrap(row.recovery_wrap, kek, "recovery", userId);
    } catch {
      throw new RecoveryError("wrong");
    }
    if ((await verifierOf(dk, userId)) !== row.verifier) throw new RecoveryError("wrong");
    const code_wrap = await wrap(dk, await tokenKey(code, "code"), "code", userId);
    return { code, code_hash: await sha256Hex(code), code_wrap };
  } finally {
    recovery.fill(0);
    dk?.fill(0);
  }
}

/// The account's key row from PostgREST (a list of at most one), or null when there's none yet.
export function parseKeyRow(body: unknown): AccountKey | null {
  const row = Array.isArray(body) ? body[0] : null;
  if (typeof row?.key_id !== "string" || typeof row.verifier !== "string" || typeof row.recovery_wrap !== "string") return null;
  return { key_id: row.key_id, verifier: row.verifier, recovery_wrap: row.recovery_wrap };
}
