// The connect page (/connect): where an AI's sign-in lands, and where you approve it.
//
// The MCP server's /authorize sends the browser here with ?request=<id>. The server that renders
// the page names who is asking (the MCP function's public /connect/label). Your notes' key lives
// only on your devices, so approving happens there:
//
// 1. You sign in on the page, only so it knows which account to ask. It makes a P-256 key pair
//    (the private half stays in the page's memory), sends the public half to /connect/ask with
//    this browser's name ("Chrome on a Mac"), and signs out straight away.
// 2. Your iPhone or Mac asks you. Allow there seals the authorization code to the page's key. The
//    page polls /connect/status, opens the code, adds it to the AI's redirect and goes there.
//    "Open Amber Notes" is a shortcut to the same question in the app on this computer, with the
//    universal link https://ambernotes.app/open/connect?request=<id> (when that stays in the
//    browser, /open/connect tries the app's own scheme, ambernotes://connect?request=<id>).
// 3. No device nearby: the recovery key. The page signs in again, reads the account's key row
//    (the recovery wrap and verifier), opens the notes' key with the typed recovery key in the
//    browser, makes the code, wraps the notes' key under it and sends /connect/decide the code's
//    hash and wrap. The recovery key and the notes' key never leave the page (lib/connect-flow.ts).
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

/// What /connect/label answers for a pending request.
export type ConnectLabel = { client_name: string; verified_ai: "ChatGPT" | "Claude" | null };

/// The page's heading: who is asking, when the server could say.
export function allowHeading(label: ConnectLabel | null): string {
  const who = label?.verified_ai ?? plainName(label?.client_name);
  return who ? `Allow ${who} to use your notes?` : "Allow this app to use your notes?";
}

/// The server's display name (the AI's name, or where access goes), shown only when short and plain.
function plainName(name: string | undefined): string | null {
  const s = (name ?? "").trim();
  return s && s.length <= 60 && /^[\p{L}\p{N} .,'&()+:_/-]+$/u.test(s) ? s : null;
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
    const body = await res.json() as Partial<ConnectLabel> | null;
    if (typeof body?.client_name !== "string") return null;
    const ai = body.verified_ai === "ChatGPT" || body.verified_ai === "Claude" ? body.verified_ai : null;
    return { client_name: body.client_name, verified_ai: ai };
  } catch {
    return null;
  }
}

/// Why /authorize sent someone here without a request (?problem=), in plain words. Unknown codes
/// get the general message; nothing from the address is ever shown.
export function problemText(code: string | undefined): string {
  switch (code) {
    case "unknown_app": return "Amber Notes doesn't know this app. Remove the connector and add it again.";
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
  verified_ai: "ChatGPT" | "Claude" | null;
  loopback: boolean;
  wants_write: boolean;
  expires_at: string;
};

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
