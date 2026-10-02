// The connect page (/connect): where an AI's sign-in lands, and where you approve it.
//
// The MCP server's /authorize sends the browser here with ?request=<id>. The server that renders
// the page says what the app calls itself and where access goes (the MCP function's public
// /connect/label); neither is verified, so neither is shown as a title. Your notes' key is on
// your devices (and in the AI connections you approved), so approving happens on a device:
//
// 1. The page shows a QR code. On load it makes a P-256 key pair and a pickup secret (both stay in
//    the page's memory) and a scan secret, and sends /connect/scan the public key, both secrets'
//    hashes and this browser's name ("Chrome on a Mac"), with no session. The code is the universal
//    link https://ambernotes.app/open/connect?request=<id>#s=<scan secret>&k=<key fingerprint>; the
//    fragment never reaches a server. Your iPhone scans it, checks the page's key against k, and
//    answers /connect/decide with the scan secret: scanning proves you're there, so no sign-in and
//    no number. On a Mac, "Open Amber Notes on this Mac" is the same link in the app's own scheme
//    (ambernotes://connect?request=<id>#s=…&k=…). When the universal link stays in a browser,
//    /open/connect tries that scheme with the fragment kept.
// 2. "Get a notification instead": you sign in, only so the page knows which account to ask. It
//    sends /connect/ask the same public key and pickup hash (so the code keeps working), with
//    match_commit (matchCommit of the key and a 16-byte nonce Np), and signs out straight away.
//    When the device opens the request it sends its own nonce Nd, which /connect/status passes on as
//    device_nonce. Only then does the page reveal Np (/connect/reveal, once) and show two digits,
//    matchNumber(public key, Np, Nd, request), to compare with the device's before choosing Allow.
//    The device gets the same number only for the page's own key, so a key swapped on the way shows.
//    Either way, Allow seals the authorization code and the AI's redirect, together, to the page's
//    key. The page polls /connect/status with the pickup secret, opens the handoff and goes only to
//    the redirect sealed inside it, with the code added.
// 3. No iPhone: the recovery key. The page signs in, reads the account's key row (the recovery wrap
//    and verifier), opens the notes' key with the typed recovery key in the browser, makes the code,
//    wraps the notes' key under it and sends /connect/decide the code's hash and wrap. The recovery
//    key and the notes' key never leave the page (lib/connect-flow.ts).
//
// The session lives only in the page's memory and travels only in an Authorization header, to
// Supabase Auth, the account_keys row and the MCP function. No cookie, nothing in storage, except
// the PKCE verifier for one Sign in with Apple round trip (sessionStorage, removed on return).
// Sign in with Apple comes back to /connect?request=<id>[&recover=1]&code=<one-time code>, so
// Supabase must list https://ambernotes.app/connect** among its redirect URLs.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validRequest = (id: string | undefined): id is string => !!id && UUID.test(id);

/// The universal link: opens the app's consent sheet for the request where the app is installed.
export const universalLink = (id: string) => `https://ambernotes.app/open/connect?request=${id.toLowerCase()}`;

/// The app's own scheme, for when the universal link stays in the browser.
export const appLink = (id: string) => `ambernotes://connect?request=${id.toLowerCase()}`;

/// The scan secret and key fingerprint a QR code carries in its fragment (#s=<22>&k=<43>), as
/// "#s=…&k=…", or null for anything else. The fragment never reaches a server, so /open/connect reads
/// it in the browser and passes it on to the app's own scheme only in this exact shape.
const SCAN_FRAGMENT = /^#?s=([A-Za-z0-9_-]{22})&k=([A-Za-z0-9_-]{43})$/;
export function scanFragment(hash: string | null | undefined): string | null {
  const m = SCAN_FRAGMENT.exec(hash ?? "");
  return m ? `#s=${m[1]}&k=${m[2]}` : null;
}

/// What the page shows about who is asking, from /connect/label. Nothing here is verified: the
/// name is what the app calls itself, and the host is where access would go.
export type ConnectLabel = { claimed_name: string | null; redirect_host: string | null; loopback: boolean };

/// The page's heading. Never an app's name: a name is only ever what the app calls itself.
export const ALLOW_HEADING = "Allow this app to use your notes?";

/// A name from the server, shown only when short and plain.
function plainName(name: unknown): string | null {
  const s = (typeof name === "string" ? name : "").trim();
  return s && s.length <= 60 && /^[\p{L}\p{N} .,'&()+:_/-]+$/u.test(s) ? s : null;
}

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/// A host name or address as the server sends it, or null.
function plainHost(host: unknown): string | null {
  const s = (typeof host === "string" ? host : "").trim().toLowerCase();
  return s.length <= 253 && (/^[a-z0-9-]+(\.[a-z0-9-]+)*$/.test(s) || /^\[[0-9a-f:.]+\]$/.test(s)) ? s : null;
}

/// Reads a /connect/label body into what the page may show.
export function parseLabel(body: unknown): ConnectLabel | null {
  // Only claimed_name: client_name is the server's name for the address, not what the app says.
  const b = (body ?? {}) as { claimed_name?: unknown; redirect_host?: unknown };
  const claimed = plainName(b.claimed_name);
  const host = plainHost(b.redirect_host);
  if (!claimed && !host) return null;
  return { claimed_name: claimed, redirect_host: host, loopback: host !== null && LOOPBACK.has(host) };
}

/// Reads /connect/label from the MCP function. `headers` are what the function should see: the
/// proxy's, with the visitor's address, so its rate limit counts the visitor and not the site.
export async function fetchLabel(functionBase: string, id: string, headers: Headers, timeoutMs = 2500): Promise<ConnectLabel | null> {
  if (!validRequest(id)) return null;
  try {
    const res = await fetch(`${functionBase}/connect/label?id=${id.toLowerCase()}`, {
      headers, cache: "no-store", signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return parseLabel(await res.json());
  } catch {
    return null;
  }
}

/// Why /authorize sent someone here without a request (?problem=), in plain words. Unknown codes
/// get the general message; nothing from the address is ever shown.
export function problemText(code: string | undefined): string {
  switch (code) {
    case "unknown_app":
      return "Amber Notes doesn't know this app's connection anymore. In Claude, remove the Amber Notes connector under Settings → Connectors and add it again. In ChatGPT, delete the Amber Notes app under Settings → Apps and add it again. In any other app, remove the server and add https://mcp.ambernotes.app again.";
    case "wrong_return": return "The app's return address doesn't match what it registered. Remove the connector and add it again.";
    case "too_many": return "Too many attempts. Wait a few minutes, then start connecting again.";
    case "pkce": case "unsupported": case "wrong_server":
      return "The app asked to connect in a way Amber Notes doesn't support. Check that it uses the address https://mcp.ambernotes.app.";
    default: return "Start connecting again from ChatGPT, Claude or the other app you were using.";
  }
}

export const functionURL = (supabaseURL: string) => `${supabaseURL.replace(/\/+$/, "")}/functions/v1/mcp`;

/// What /connect/request answers (it also claims the request for the signed-in account).
export type ConnectRequest = {
  id: string;
  client_name: string;
  /// What an unverified app calls itself, made plain by the server; never a title.
  claimed_name?: string | null;
  redirect_host: string;
  /// The exact return address; /connect/decide takes it back unchanged.
  redirect_uri: string;
  /// The server's view that this is a known AI's pinned callback. The page never shows it as a
  /// name or a mark.
  verified_ai?: "ChatGPT" | "Claude" | null;
  loopback: boolean;
  wants_write: boolean;
  expires_at: string;
};

/// The access the page starts at: what the app asked for. Someone who just started connecting
/// expects their AI to work; the number, not a weaker default, guards an app we can't name.
export const startsWithWrite = (r: Pick<ConnectRequest, "wants_write">) => r.wants_write;

/// Who will receive access, in words.
export const destination = (host: string, loopback: boolean) => (loopback ? "an app on this computer" : host);

/// A sign-in failure from Supabase Auth, in plain words.
export function signInError(status: number, body: { error_code?: string } | null): string {
  if (status === 429) return "Too many attempts. Wait a few minutes and try again.";
  if (body?.error_code === "email_not_confirmed") return "Confirm your email first, then sign in.";
  if (body?.error_code === "invalid_credentials" || status === 400) return "The email or password isn't right.";
  return "Couldn't sign in. Check your connection and try again.";
}

/// Where Supabase sends the browser back after Sign in with Apple. `recover` brings the page back
/// to the recovery key.
export const returnURL = (origin: string, id: string, recover = false) =>
  `${origin}/connect?request=${id.toLowerCase()}${recover ? "&recover=1" : ""}`;

/// Whether the page offers Sign in with Apple. It needs the web Services ID (app.ambernotes.signin)
/// first in Supabase's Apple client ids, and a client secret that lasts six months: renew it with
/// scripts/apple-web-secret.py. Without it Supabase answers "Unsupported provider: missing OAuth secret".
export const APPLE_ON_WEB = true;

/// Supabase's OAuth start for Apple, with a PKCE challenge.
export function appleSignInURL(supabaseURL: string, returnTo: string, challenge: string): string {
  const u = new URL(`${supabaseURL.replace(/\/+$/, "")}/auth/v1/authorize`);
  u.searchParams.set("provider", "apple");
  u.searchParams.set("redirect_to", returnTo);
  u.searchParams.set("scopes", "name email");
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "s256");
  return u.toString();
}

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/// A PKCE verifier and its S256 challenge.
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}
