// The proxy in front of the MCP server at mcp.ambernotes.app (see middleware.ts).
import { MCP_URL } from "./facts";

export const MCP_HOST = new URL(MCP_URL).host;

/// The only paths the server has. Anything else, and anything encoded that could walk out of the
/// function's path (%2f, %5c, backslashes, dots), never reaches Supabase.
const PATHS = /^\/(?:|register|authorize|token|revoke|connect\/(?:request|label|ask|scan|status|nonce|reveal|decide|release)|\.well-known\/(?:oauth-protected-resource|oauth-authorization-server|openid-configuration)(?:\/[A-Za-z0-9_-]+)?|\.well-known\/mcp\/server-card\.json)$/;

/// What the site serves itself on the MCP host, the same file as on ambernotes.app: the favicon
/// Claude shows next to the server, and OpenAI's domain challenge (app/.well-known/).
const SITE_PATHS = ["/favicon.ico", "/.well-known/openai-apps-challenge"];

export function sitePath(rawPath: string): boolean {
  return SITE_PATHS.includes(rawPath);
}

export function allowedPath(rawPath: string): boolean {
  return !/[%\\]|\.\./.test(rawPath) && PATHS.test(rawPath);
}

/// Where a request to the MCP host goes: the function, with the same path and query.
export function upstream(supabaseURL: string, pathname: string, search: string): URL {
  const path = pathname === "/" ? "" : pathname;
  return new URL(`${supabaseURL.replace(/\/+$/, "")}/functions/v1/mcp${path}${search}`);
}

/// What an MCP client or the consent page needs the server to see. Cookies, forwarding headers
/// and anything else a caller sends stay behind.
const PASS = ["accept", "authorization", "content-type", "last-event-id", "mcp-protocol-version", "mcp-session-id", "origin", "user-agent"];

/// The headers the function gets: the allowlisted ones, plus what the proxy vouches for, with the
/// secret that makes the function believe it.
/// The region the functions do their work in (FUNCTION_REGION, e.g. "eu-central-1"), or null.
/// Supabase runs a function nearest its caller unless the request names a region, and this site's
/// servers call from wherever Vercel runs them. The function also sends itself home when it lands
/// elsewhere (supabase/functions/_shared/region.ts); naming the region here saves that extra hop.
export function functionRegion(value: string | undefined): string | null {
  const r = (value ?? "").trim().toLowerCase();
  return /^[a-z]{2}-[a-z]+-\d$/.test(r) ? r : null;
}

export function upstreamHeaders(incoming: Headers, secret: string, region: string | null = null): Headers {
  const headers = new Headers();
  for (const h of PASS) {
    const v = incoming.get(h);
    if (v !== null) headers.set(h, v);
  }
  headers.set("x-mcp-public-url", MCP_URL);
  headers.set("x-mcp-proxy-secret", secret);
  // Vercel sets these itself and drops what a client sent.
  const ip = incoming.get("x-real-ip") ?? incoming.get("x-forwarded-for")?.split(",")[0].trim();
  if (ip) headers.set("x-mcp-client-ip", ip);
  // Ours to say, never the caller's: x-region isn't in PASS.
  if (region) headers.set("x-region", region);
  return headers;
}
