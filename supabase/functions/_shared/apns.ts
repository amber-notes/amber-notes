// Apple Push Notification service, token-based (a .p8 key): the few pushes the server sends. Each
// one only wakes a device and says there's something to look at; it never carries note data.
//
// Secrets: APNS_KEY_P8 (the .p8 file's text), APNS_KEY_ID, APNS_TEAM_ID, and APNS_TOPIC (the
// app's bundle id, default dev.emilwagman.pane). Without them nothing is sent.
//
// Apple's refusals are logged (HTTP status and Apple's reason, nothing about the device), so a
// push that never arrives shows why: a key Apple doesn't accept (403 InvalidProviderToken), a key
// limited to the other environment, a topic the key can't send to, or a key that doesn't parse.

import { errorKind, log } from "./log.ts";

export type Environment = "sandbox" | "production";
export type Push = { token: string; environment: Environment; payload: Record<string, unknown>; collapseId?: string; expiresIn?: number };
/** What Apple said: sent, a token to forget (Unregistered, BadDeviceToken…), or another failure. */
export type Outcome = "sent" | "gone" | "failed";
export type Sender = (push: Push) => Promise<Outcome>;

const HOSTS: Record<Environment, string> = {
  sandbox: "https://api.sandbox.push.apple.com",
  production: "https://api.push.apple.com",
};
// Reasons after which a token never works again.
const GONE = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic", "ExpiredToken"]);

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s: string) => b64url(new TextEncoder().encode(s));

/** An ES256 provider token. Apple accepts one for up to an hour; it's refreshed every 50 minutes.
 *  The key may come with its line breaks written as "\n" (how an env file or a dashboard keeps it). */
export async function providerToken(p8: string, keyId: string, teamId: string, now = Date.now()): Promise<string> {
  const der = Uint8Array.from(atob(p8.replace(/\\n/g, "\n").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const head = b64urlText(JSON.stringify({ alg: "ES256", kid: keyId }));
  const claims = b64urlText(JSON.stringify({ iss: teamId, iat: Math.floor(now / 1000) }));
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(`${head}.${claims}`)));
  return `${head}.${claims}.${b64url(sig)}`;
}

/** The sender for the configured key, or null when push isn't set up. */
export function apnsSender(env: (k: string) => string | undefined = (k) => Deno.env.get(k), fetcher: typeof fetch = fetch): Sender | null {
  const p8 = env("APNS_KEY_P8"), keyId = env("APNS_KEY_ID"), teamId = env("APNS_TEAM_ID");
  if (!p8 || !keyId || !teamId) return null;
  const topic = env("APNS_TOPIC") ?? "dev.emilwagman.pane";
  let cached: { jwt: string; at: number } | null = null;
  return async (push) => {
    if (!cached || Date.now() - cached.at > 50 * 60_000) {
      try {
        cached = { jwt: await providerToken(p8, keyId, teamId), at: Date.now() };
      } catch (e) {
        log("push_key_invalid", errorKind(e));
        return "failed";
      }
    }
    const headers: Record<string, string> = {
      authorization: `bearer ${cached.jwt}`, "apns-topic": topic, "apns-push-type": "alert", "apns-priority": "10",
      "apns-expiration": String(Math.floor(Date.now() / 1000) + (push.expiresIn ?? 600)), "content-type": "application/json",
    };
    if (push.collapseId) headers["apns-collapse-id"] = push.collapseId.slice(0, 64);
    try {
      const res = await fetcher(`${HOSTS[push.environment]}/3/device/${push.token}`, {
        method: "POST", headers, body: JSON.stringify(push.payload), signal: AbortSignal.timeout(5000),
      });
      if (res.ok) { await res.body?.cancel(); return "sent"; }
      const reason = String((await res.json().catch(() => ({})))?.reason ?? "");
      // Apple's reasons are fixed words; anything else is logged as "other".
      log("push_rejected", { status: res.status, code: /^[A-Za-z]{1,40}$/.test(reason) ? reason : "other", where: push.environment });
      return res.status === 410 || GONE.has(reason) ? "gone" : "failed";
    } catch (e) {
      log("push_unreachable", { ...errorKind(e), where: push.environment });
      return "failed";
    }
  };
}
