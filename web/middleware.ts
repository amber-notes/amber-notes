import { NextResponse, type NextRequest } from "next/server";
import { upstream, upstreamHeaders } from "@/lib/mcp-proxy";

// mcp.ambernotes.app is the MCP server's public address. Every request to that host (the endpoint
// at the root, the OAuth endpoints and the /.well-known metadata) goes, path and query kept, to the
// Supabase function (supabase/functions/mcp). Method, body and headers pass through, Authorization
// and Mcp-Session-Id included, and the response streams back as it comes.
//
// The function names this host in its OAuth metadata because the proxy says which alias it serves
// (X-MCP-Public-URL; the function accepts only aliases it knows). Behind Vercel every request comes
// from Vercel's addresses, so the caller's own address goes along for the function's rate limits,
// with a secret that makes the function trust it (MCP_PROXY_SECRET, set on both sides).

export const config = {
  // Only that host runs the middleware; the site's own pages never do.
  matcher: [{ source: "/:path*", has: [{ type: "host", value: "mcp.ambernotes.app" }] }],
};

export function middleware(req: NextRequest) {
  const supabase = process.env.SUPABASE_URL;
  if (!supabase) return new NextResponse("The Amber Notes MCP server isn't configured here.", { status: 503 });
  const to = upstream(supabase, req.nextUrl.pathname, req.nextUrl.search);
  return NextResponse.rewrite(to, { request: { headers: upstreamHeaders(req.headers, process.env.MCP_PROXY_SECRET) } });
}
