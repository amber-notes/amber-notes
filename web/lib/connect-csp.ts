// The consent page's Content-Security-Policy: scripts only from this site, with this response's
// nonce (Next.js puts it on its own inline scripts), or the theme script by its hash. No
// 'unsafe-inline' anywhere, and the page may connect only to this site and the Supabase project.
import { themeScript } from "./theme";

let themeHash: Promise<string> | undefined;

async function sha256Base64(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...digest));
}

export function newNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

export async function connectCSP(nonce: string, supabaseURL: string | undefined, production: boolean): Promise<string> {
  themeHash ??= sha256Base64(themeScript);
  let supabase = "";
  try { supabase = supabaseURL ? ` ${new URL(supabaseURL).origin}` : ""; } catch {}
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'sha256-${await themeHash}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    `img-src 'self' data:${production ? "" : " http://127.0.0.1:*"}`,
    "font-src 'self'",
    `connect-src 'self'${supabase}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
