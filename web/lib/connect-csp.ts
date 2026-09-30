// The connect pages' Content-Security-Policy (/connect and /open/connect): scripts only from this
// site, with this response's nonce (Next.js puts it on its own inline scripts), or the theme script
// by its hash. No 'unsafe-inline' anywhere. /connect calls the Supabase project itself (Auth, the
// account's key row, the MCP function), so it may connect to this site and that origin only;
// /open/connect calls nothing, so only this site. Forms post nowhere: the page's script sends them,
// and before it runs a form can't put a password or recovery key in a request.
import { themeScript } from "./theme";

let themeHash: Promise<string> | undefined;

async function sha256Base64(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...digest));
}

export function newNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

/// The origin of the Supabase project, or nothing when the address isn't one.
export function supabaseOrigin(url: string | undefined): string | null {
  try {
    const u = new URL(url ?? "");
    return u.protocol === "https:" || u.hostname === "127.0.0.1" || u.hostname === "localhost" ? u.origin : null;
  } catch {
    return null;
  }
}

export async function connectCSP(nonce: string, supabaseURL?: string): Promise<string> {
  themeHash ??= sha256Base64(themeScript);
  const supabase = supabaseOrigin(supabaseURL);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'sha256-${await themeHash}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${supabase ? ` ${supabase}` : ""}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
