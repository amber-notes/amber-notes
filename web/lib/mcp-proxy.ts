// The proxy in front of the MCP server at mcp.ambernotes.app (see middleware.ts).
import { MCP_URL } from "./facts";

/// Where a request to the MCP host goes: the function, with the same path and query.
export function upstream(supabaseURL: string, pathname: string, search: string): URL {
  const path = pathname === "/" ? "" : pathname;
  return new URL(`${supabaseURL.replace(/\/+$/, "")}/functions/v1/mcp${path}${search}`);
}

/// The headers the function gets: the caller's, minus anything claiming to come from this proxy,
/// plus what the proxy vouches for.
export function upstreamHeaders(incoming: Headers, secret: string | undefined): Headers {
  const headers = new Headers(incoming);
  // The destination's own host goes on the request, never this one.
  for (const h of ["host", "x-mcp-public-url", "x-mcp-client-ip", "x-mcp-proxy-secret"]) headers.delete(h);
  headers.set("x-mcp-public-url", MCP_URL);
  // Vercel sets these itself and drops what a client sent.
  const ip = incoming.get("x-real-ip") ?? incoming.get("x-forwarded-for")?.split(",")[0].trim();
  if (secret && ip) {
    headers.set("x-mcp-client-ip", ip);
    headers.set("x-mcp-proxy-secret", secret);
  }
  return headers;
}
