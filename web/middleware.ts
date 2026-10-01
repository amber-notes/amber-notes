import { NextResponse, type NextRequest } from "next/server";
import { connectCSP, newNonce } from "@/lib/connect-csp";
import { allowedPath, MCP_HOST, sitePath, upstream, upstreamHeaders } from "@/lib/mcp-proxy";

// Two jobs, each on its own requests.
//
// 1. mcp.ambernotes.app is the MCP server's public address. Requests to that host, on the server's
//    own paths only, go to the Supabase function (supabase/functions/mcp) with path and query kept,
//    carrying only the headers MCP needs, and the response streams back. The function names this
//    host in its OAuth metadata and counts the caller's address for rate limits because the proxy
//    says so with a shared secret (MCP_PROXY_SECRET). Without the secret the proxy doesn't run.
//    The favicon and OpenAI's domain challenge on that host are the site's own files.
//
// 2. The connect pages (/connect, and /open/connect where the universal link lands in a browser) get
//    a per-response nonce, a strict CSP and no referrer. /connect may also call the Supabase project.

export const config = {
  matcher: [
    { source: "/:path*", has: [{ type: "host", value: "mcp\\.ambernotes\\.app" }] },
    "/connect",
    "/open/connect",
  ],
};

export async function middleware(req: NextRequest) {
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (host === MCP_HOST) return proxy(req);
  if (req.nextUrl.pathname === "/connect" || req.nextUrl.pathname === "/open/connect") return connectPage(req);
  return NextResponse.next();
}

function proxy(req: NextRequest) {
  // req.url as the client sent it, never req.nextUrl: Next.js rewrites the first 127.x.x.x or [::1]
  // anywhere in nextUrl, the query included, to "localhost", which breaks a loopback redirect_uri
  // (Codex, VS Code). skipMiddlewareUrlNormalize in next.config.ts keeps req.url raw.
  const raw = new URL(req.url);
  if (sitePath(raw.pathname)) return NextResponse.next();
  const supabase = process.env.SUPABASE_URL;
  const secret = process.env.MCP_PROXY_SECRET;
  if (!supabase || !secret) {
    console.error("mcp.ambernotes.app: SUPABASE_URL or MCP_PROXY_SECRET is not set; not proxying");
    return new NextResponse("The Amber Notes MCP server isn't available here right now.", { status: 503 });
  }
  if (!allowedPath(raw.pathname)) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const to = upstream(supabase, raw.pathname, raw.search);
  return NextResponse.rewrite(to, { request: { headers: upstreamHeaders(req.headers, secret) } });
}

async function connectPage(req: NextRequest) {
  const nonce = newNonce();
  const csp = await connectCSP(nonce, req.nextUrl.pathname === "/connect" ? process.env.SUPABASE_URL : undefined);
  // Next.js reads the nonce from the request's CSP and puts it on the scripts it renders.
  const headers = new Headers(req.headers);
  headers.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", csp);
  // The page's address carries the request id (and, back from Sign in with Apple, a one-time code
  // for a moment): no link or request from here says where it came from.
  res.headers.set("Referrer-Policy", "no-referrer");
  return res;
}
