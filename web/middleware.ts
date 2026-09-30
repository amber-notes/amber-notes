import { NextResponse, type NextRequest } from "next/server";
import { connectCSP, newNonce } from "@/lib/connect-csp";
import { allowedPath, MCP_HOST, upstream, upstreamHeaders } from "@/lib/mcp-proxy";

// Two jobs, each on its own requests.
//
// 1. mcp.ambernotes.app is the MCP server's public address. Requests to that host, on the server's
//    own paths only, go to the Supabase function (supabase/functions/mcp) with path and query kept,
//    carrying only the headers MCP needs, and the response streams back. The function names this
//    host in its OAuth metadata and counts the caller's address for rate limits because the proxy
//    says so with a shared secret (MCP_PROXY_SECRET). Without the secret the proxy doesn't run.
//
// 2. The consent page (/connect) gets a per-response nonce and a strict CSP.

export const config = {
  matcher: [
    { source: "/:path*", has: [{ type: "host", value: "mcp\\.ambernotes\\.app" }] },
    "/connect",
  ],
};

export async function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (host === MCP_HOST) return proxy(req);
  if (req.nextUrl.pathname === "/connect") return consentPage(req);
  return NextResponse.next();
}

function proxy(req: NextRequest) {
  const supabase = process.env.SUPABASE_URL;
  const secret = process.env.MCP_PROXY_SECRET;
  if (!supabase || !secret) {
    console.error("mcp.ambernotes.app: SUPABASE_URL or MCP_PROXY_SECRET is not set; not proxying");
    return new NextResponse("The Amber Notes MCP server isn't available here right now.", { status: 503 });
  }
  const rawPath = new URL(req.url).pathname;
  if (!allowedPath(rawPath)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const to = upstream(supabase, rawPath, req.nextUrl.search);
  return NextResponse.rewrite(to, { request: { headers: upstreamHeaders(req.headers, secret) } });
}

async function consentPage(req: NextRequest) {
  const nonce = newNonce();
  const csp = await connectCSP(nonce, process.env.SUPABASE_URL, process.env.NODE_ENV === "production");
  // Next.js reads the nonce from the request's CSP and puts it on the scripts it renders.
  const headers = new Headers(req.headers);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  return res;
}
