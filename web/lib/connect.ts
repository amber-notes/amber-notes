// The web consent page (/connect): approving an AI connection without the app.
//
// The MCP server's /authorize sends the browser here with ?request=<id>. The page offers to open
// Amber Notes (the app shows the same consent) or to sign in right here. Signing in goes from the
// browser straight to Supabase Auth; the session stays in the page's memory and travels only in
// an Authorization header, to the MCP function's /connect/request and /connect/decide (the calls
// the app makes). No cookie is set, so another site can't act with it. The function answers with
// the AI's redirect address (with the one-time code), and the page sends the browser there.
//
// Sign in with Apple goes through Supabase's OAuth with PKCE: Apple's page, then back to
// /connect?request=<id>&code=<one-time code>, which the page exchanges with its verifier (kept in
// sessionStorage for that one round trip) and removes from the address. Supabase must list
// https://ambernotes.app/connect** among its redirect URLs.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validRequest = (id: string | undefined): id is string => !!id && UUID.test(id);

/// Opens the app's consent sheet for the same request.
export const appLink = (id: string) => `ambernotes://connect?request=${id.toLowerCase()}`;

/// What /connect/request answers.
export type ConnectRequest = {
  id: string;
  client_name: string;
  redirect_host: string;
  redirect_uri?: string;
  verified_ai?: "ChatGPT" | "Claude" | null;
  loopback: boolean;
  wants_write: boolean;
};

/// The exact addresses where ChatGPT and Claude receive their sign-in, as on the server
/// (oauth.ts KNOWN_CALLBACKS) and in the app (ConnectTrust). Only a request that returns to one of
/// these shows that AI's name and mark: anyone can call themselves "ChatGPT", and a look-alike
/// path on the same site isn't the sign-in callback.
export const KNOWN_CALLBACKS: Record<string, "ChatGPT" | "Claude"> = {
  "https://chatgpt.com/connector_platform_oauth_redirect": "ChatGPT",
  "https://platform.openai.com/apps-manage/oauth": "ChatGPT",
  "https://claude.ai/api/mcp/auth_callback": "Claude",
  "https://claude.com/api/mcp/auth_callback": "Claude",
};

export function verifiedAI(r: Pick<ConnectRequest, "redirect_uri">): "ChatGPT" | "Claude" | null {
  return (r.redirect_uri && KNOWN_CALLBACKS[r.redirect_uri]) || null;
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

/// Who will receive access, in words.
export const destination = (host: string, loopback: boolean) => (loopback ? "an app on this computer" : host);

export const functionURL = (supabaseURL: string) => `${supabaseURL.replace(/\/+$/, "")}/functions/v1/mcp`;

/// A sign-in failure from Supabase Auth, in plain words.
export function signInError(status: number, body: { error_code?: string; msg?: string; error_description?: string } | null): string {
  if (status === 429) return "Too many attempts. Wait a few minutes and try again.";
  if (body?.error_code === "invalid_credentials" || status === 400) return "The email or password isn't right.";
  if (body?.error_code === "email_not_confirmed") return "Confirm your email first, then sign in.";
  return "Couldn't sign in. Check your connection and try again.";
}

/// Where Supabase sends the browser back after Sign in with Apple.
export const returnURL = (origin: string, id: string) => `${origin}/connect?request=${id.toLowerCase()}`;

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
