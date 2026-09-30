// The connect page's steps that don't touch the screen: naming this browser for the ask, reading
// /connect/status, putting the code on the AI's redirect, and approving with the recovery key.
// The page (app/connect/ConnectFlow.tsx) does the fetching and the showing. See lib/connect.ts.
import { HANDOFF, hex, parseRecoveryKey, recoveryKEK, tokenKey, unwrap, verifierOf, wrap } from "./e2ee";

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

/// What the page does after a /connect/status answer.
export type Step =
  | { kind: "wait" }
  | { kind: "approved"; redirect: string; handoff: string }
  | { kind: "denied"; redirect: string }
  | { kind: "answeredInApp" }
  | { kind: "delivered" }
  | { kind: "expired" };

const isURL = (s: unknown): s is string => {
  if (typeof s !== "string") return false;
  try { new URL(s); return true; } catch { return false; }
};

/// Reads a /connect/status body. Past `expiresAt` (ms), waiting ends. Anything odd means wait.
export function statusStep(body: unknown, now: number, expiresAt: number | null): Step {
  const b = (body ?? {}) as { state?: unknown; redirect?: unknown; handoff?: unknown };
  switch (b.state) {
    case "approved":
      if (isURL(b.redirect) && typeof b.handoff === "string" && HANDOFF.test(b.handoff)) return { kind: "approved", redirect: b.redirect, handoff: b.handoff };
      break;
    case "denied":
      if (isURL(b.redirect)) return { kind: "denied", redirect: b.redirect };
      break;
    case "answered_in_app": return { kind: "answeredInApp" };
    case "delivered": return { kind: "delivered" };
    case "expired": return { kind: "expired" };
  }
  return expiresAt !== null && now >= expiresAt ? { kind: "expired" } : { kind: "wait" };
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
