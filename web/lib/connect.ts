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
  loopback: boolean;
  wants_write: boolean;
};

/// Where known AI apps receive their sign-in, as in the app (ConnectTrust). Anything else gets a
/// stronger warning, and only an address proves who it is: anyone can call themselves "ChatGPT".
const KNOWN: Record<string, "ChatGPT" | "Claude"> = {
  "chatgpt.com": "ChatGPT",
  "chat.openai.com": "ChatGPT",
  "claude.ai": "Claude",
  "claude.com": "Claude",
};

export function verifiedAI(host: string, loopback: boolean): "ChatGPT" | "Claude" | null {
  if (loopback) return null;
  const match = Object.keys(KNOWN).find((k) => host === k || host.endsWith("." + k));
  return match ? KNOWN[match] : null;
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
