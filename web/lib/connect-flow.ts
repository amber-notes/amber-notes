// The connect page's steps that don't touch the screen: naming this browser for the ask, the
// pickup secret, reading /connect/status, going on to the AI with the sealed code and redirect, and
// approving with the recovery key.
// The page (app/connect/ConnectFlow.tsx) does the fetching and the showing. See lib/connect.ts.
import { appLink, scanFragment, universalLink } from "./connect";
import { HANDOFF, hex, matchCommit, matchNumber, parseRecoveryKey, readHandoffPayload, recoveryKEK, tokenKey, unwrap, verifierOf, wrap } from "./e2ee";

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

/// The page's nonce Np: 16 random bytes kept only in this page's memory. /connect/ask gets only the
/// commit to it (matchCommit of the page's public key and Np); the page reveals Np to /connect/reveal
/// after the device has sent its own nonce, so nobody can pick a key and a nonce that give a chosen number.
export function newPageNonce(bytes: Uint8Array<ArrayBuffer> = crypto.getRandomValues(new Uint8Array(16))): Uint8Array<ArrayBuffer> {
  if (bytes.length !== 16) throw new Error("a page nonce is 16 bytes");
  return bytes;
}

/// What /connect/ask takes as match_commit.
export const pageCommit = (browserPublicRaw: Uint8Array, pageNonce: Uint8Array) => matchCommit(browserPublicRaw, pageNonce);

/// The two digits the page shows once the device's nonce is in; you type them on the device.
export const pageNumber = (browserPublicRaw: Uint8Array, pageNonce: Uint8Array, deviceNonceHex: string, requestId: string) =>
  matchNumber(browserPublicRaw, pageNonce, fromHex(deviceNonceHex), requestId);

const NONCE_HEX = /^[0-9a-f]{32}$/i;
const fromHex = (s: string) => Uint8Array.from(s.match(/../g) ?? [], (b) => parseInt(b, 16));

/// The /connect/status call: a POST with the pickup secret, never the secret in the address.
export function statusRequest(functionBase: string, id: string, pickup: string): [string, RequestInit] {
  return [`${functionBase}/connect/status`, {
    method: "POST", cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, pickup }),
  }];
}

/// The /connect/reveal call, made once the device's nonce is in: the page's nonce as lowercase hex,
/// with the pickup secret, in a POST body.
export function revealRequest(functionBase: string, id: string, pickup: string, pageNonce: Uint8Array): [string, RequestInit] {
  return [`${functionBase}/connect/reveal`, {
    method: "POST", cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, pickup, nonce: hex(pageNonce) }),
  }];
}

/// "Send it again": the page that asked, known by its pickup secret, has the account's devices told
/// once more. No session.
export function resendRequest(functionBase: string, id: string, pickup: string): [string, RequestInit] {
  return [`${functionBase}/connect/resend`, {
    method: "POST", cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, pickup }),
  }];
}

/// What the page does after a /connect/status answer.
export type Step =
  | { kind: "wait" }
  /// The device has opened the request and sent its nonce: reveal the page's nonce and show the number.
  | { kind: "deviceReady"; deviceNonce: string }
  | { kind: "approved"; handoff: string }
  /// Declined. The redirect back to the app, when there is one the page may follow.
  | { kind: "denied"; redirect: string | null }
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

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]"]);

/// Where a denial may send the page back to: https, or http on this computer. Nothing else, since
/// the denial's redirect isn't sealed by the device.
export function safeDeniedRedirect(s: unknown): string | null {
  if (typeof s !== "string") return null;
  try {
    const u = new URL(s);
    if (u.username || u.password) return null;
    if (u.protocol === "https:" && u.hostname) return u.toString();
    if (u.protocol === "http:" && LOOPBACK.has(u.hostname)) return u.toString();
  } catch {}
  return null;
}

/// Reads a /connect/status body. Past `expiresAt` (ms), waiting ends. Anything odd means wait.
/// An approval carries only the sealed handoff: where it goes comes from inside it (sealedDestination),
/// never from the answer's own `redirect`, which anyone on the way could change.
export function statusStep(body: unknown, now: number, expiresAt: number | null): Step {
  const b = (body ?? {}) as { state?: unknown; redirect?: unknown; handoff?: unknown; device_nonce?: unknown };
  switch (b.state) {
    case "approved":
      if (typeof b.handoff === "string" && HANDOFF.test(b.handoff)) return { kind: "approved", handoff: b.handoff };
      break;
    case "denied": return { kind: "denied", redirect: safeDeniedRedirect(b.redirect) };
    case "answered_in_app": return { kind: "answeredInApp" };
    case "delivered": return { kind: "delivered" };
    case "expired": return { kind: "expired" };
  }
  if (expiresAt !== null && now >= expiresAt) return { kind: "expired" };
  if (b.state === "asked" && typeof b.device_nonce === "string" && NONCE_HEX.test(b.device_nonce)) {
    return { kind: "deviceReady", deviceNonce: b.device_nonce.toLowerCase() };
  }
  return { kind: "wait" };
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

// MARK: The QR code

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/// The scan secret: 16 random bytes as base64url without padding (22 characters). It travels only in
/// the QR code's fragment; /connect/scan gets scan_hash, the lowercase hex SHA-256 of the secret's
/// UTF-8 text. The device that scans the code answers /connect/decide with the secret itself.
export async function newScan(bytes: Uint8Array = crypto.getRandomValues(new Uint8Array(16))): Promise<{ scan: string; scan_hash: string }> {
  if (bytes.length !== 16) throw new Error("a scan secret is 16 bytes");
  const scan = b64url(bytes);
  return { scan, scan_hash: await sha256Hex(scan) };
}

/// The page's key as the QR code names it: base64url (no padding) of SHA-256 over the raw 65-byte
/// public key. The device checks the key /connect/request shows against it before sealing anything.
export async function keyFingerprint(publicRaw: Uint8Array<ArrayBuffer>): Promise<string> {
  if (publicRaw.length !== 65 || publicRaw[0] !== 4) throw new Error("a raw P-256 public key is 65 bytes");
  return b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", publicRaw)));
}

const scanPart = (scan: string, fingerprint: string) => {
  const f = scanFragment(`#s=${scan}&k=${fingerprint}`);
  if (!f) throw new Error("not a scan secret and key fingerprint");
  return f;
};

/// What the QR code encodes: the universal link, with the secret and fingerprint in the fragment so
/// they never reach a server log.
export const scanLink = (id: string, scan: string, fingerprint: string) => universalLink(id) + scanPart(scan, fingerprint);

/// The same, in the app's own scheme: the "Open Amber Notes on this Mac" button (Chrome doesn't open
/// universal links).
export const scanAppLink = (id: string, scan: string, fingerprint: string) => appLink(id) + scanPart(scan, fingerprint);

/// The /connect/scan call: no session, the page's public key, the pickup's hash and the scan secret's hash.
export function scanRequest(functionBase: string, body: { id: string; browser_key: string; pickup_hash: string; scan_hash: string; from: string }): [string, RequestInit] {
  return [`${functionBase}/connect/scan`, {
    method: "POST", cache: "no-store",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }];
}

/// A Mac's browser, not an iPhone's or an iPad's (iPadOS Safari says "MacIntel" but has touch).
export function isMacBrowser(platform: string, ua: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/.test(platform) || /iPhone|iPad|iPod/.test(ua)) return false;
  const mac = /^Mac/.test(platform) || (!platform && /\bMacintosh\b/.test(ua));
  return mac && maxTouchPoints <= 1;
}

// MARK: Which device to name

/// Where the account has Amber Notes, from /connect/ask: an iPhone that opened it in the last 30
/// days and gets the push, and a Mac that opened it in the last 30 days. Two yes-or-no answers.
export type Devices = { iphone: boolean; mac: boolean };

/// The devices in /connect/ask's answer, or null when it doesn't say (the page then names both).
export function parseDevices(body: unknown): Devices | null {
  const d = (body as { devices?: { iphone?: unknown; mac?: unknown } } | null)?.devices;
  if (typeof d?.iphone !== "boolean" || typeof d?.mac !== "boolean") return null;
  return { iphone: d.iphone, mac: d.mac };
}

/// What this browser runs on, as far as naming a device goes.
export type BrowserOn = "mac" | "iphone" | "other";
export function browserOn(platform: string, ua: string, maxTouchPoints = 0): BrowserOn {
  if (/iPhone|iPod/.test(platform) || /iPhone|iPod/.test(ua)) return "iphone";
  return isMacBrowser(platform, ua, maxTouchPoints) ? "mac" : "other";
}

/// The one thing the page tells you to do once you've signed in:
/// - "thisMac": the browser is on a Mac and the account has a Mac app: open it here.
/// - "thisIphone": the browser is on an iPhone and the account has the iPhone app: open it here.
/// - "iphone": check your iPhone for the notification.
/// - "mac": the account's only app is on a Mac, and this browser isn't on one: open it there.
/// - "recover": no app seen lately: the recovery key leads.
/// - "any": the server didn't say: name both, as before.
export type Lead = "thisMac" | "thisIphone" | "iphone" | "mac" | "recover" | "any";
export function leadFor(devices: Devices | null, on: BrowserOn): Lead {
  if (!devices) return "any";
  if (on === "mac" && devices.mac) return "thisMac";
  if (on === "iphone" && devices.iphone) return "thisIphone";
  if (devices.iphone) return "iphone";
  if (devices.mac) return "mac";
  return "recover";
}
