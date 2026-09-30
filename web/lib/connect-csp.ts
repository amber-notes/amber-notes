// The connect pages' Content-Security-Policy (/connect and /open/connect): scripts only from this
// site, with this response's nonce (Next.js puts it on its own inline scripts), or the theme script
// by its hash. No 'unsafe-inline' anywhere. The pages call nothing themselves (the server reads who
// is asking), so they may connect only to this site.
import { themeScript } from "./theme";

let themeHash: Promise<string> | undefined;

async function sha256Base64(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...digest));
}

export function newNonce(): string {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))));
}

export async function connectCSP(nonce: string): Promise<string> {
  themeHash ??= sha256Base64(themeScript);
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'sha256-${await themeHash}'`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}
