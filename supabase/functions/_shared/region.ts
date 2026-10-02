// Where the functions do their work.
//
// Supabase runs an Edge Function in the region nearest whoever calls it, so a caller in the US had
// its request handled, and notes opened in memory, in us-east-1, while the database and everything
// else are in Frankfurt. There is no project setting to pin a function: a caller can ask for a
// region with the x-region header (or ?forceFunctionRegion=), but shipped apps and AI clients don't
// send one. So the function pins itself: when it finds itself outside the home region
// (FUNCTION_REGION, e.g. eu-central-1) it hands the request on, unread, to the same function in
// the home region and passes the answer back. The work (reading the database, opening notes)
// happens only at home; elsewhere the function only passes the request and the answer along, as
// the network in front of it already does, and keeps nothing.
//
// The relay vouches for the caller's address with MCP_PROXY_SECRET, the same way the site's proxy
// does, so rate limits still count the real caller; without that secret nothing is relayed. A
// request that already came from a relay is never relayed again. If the home region can't be
// reached, the request is answered where it is, and the log says so ("relay_failed"): better an
// answer than none, and it shows up.
import { clientAddress } from "./client.ts";
import { errorKind, log } from "./log.ts";

export type Env = { get(name: string): string | undefined };
type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/// Marks a request a relay sent, and an answer that came back through one.
export const RELAY_HEADER = "x-amber-relay";
/// On every answer: the region that did the work.
export const REGION_HEADER = "x-amber-region";

const REGION = /^[a-z]{2}-[a-z]+-\d$/;

/// The home region, when FUNCTION_REGION names one.
export function homeRegion(env: Env): string | null {
  const r = (env.get("FUNCTION_REGION") ?? "").trim().toLowerCase();
  return REGION.test(r) ? r : null;
}

/// Where this isolate is running, as Supabase says (SB_REGION), or null on a local stack.
export function here(env: Env): string | null {
  const r = (env.get("SB_REGION") ?? "").trim().toLowerCase();
  return REGION.test(r) ? r : null;
}

function equal(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/// Whether this request should be handed to the home region: there is one, this isn't it, the
/// secret that carries the caller's address is set, and the request didn't come from a relay.
/// Preflights are answered where they are: they carry nothing.
export function shouldRelay(req: Request, env: Env): boolean {
  const home = homeRegion(env), at = here(env);
  if (!home || !at || at === home) return false;
  if (!env.get("MCP_PROXY_SECRET") || !env.get("SUPABASE_URL")) return false;
  if (req.headers.has(RELAY_HEADER) || req.method === "OPTIONS") return false;
  return true;
}

/// The same request at the function's public address: /functions/v1/<name> and whatever followed
/// the name, with the query.
export function homeURL(req: Request, name: string, supabaseURL: string): string {
  const u = new URL(req.url);
  const rest = u.pathname.replace(/^\/functions\/v1/, "").replace(new RegExp(`^/${name}(?=/|$)`), "");
  return `${supabaseURL.replace(/\/+$/, "")}/functions/v1/${name}${rest}${u.search}`;
}

// Never copied: the connection's own headers, and addresses only a proxy in front may state.
const DROP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "upgrade", "te", "expect",
  "x-region", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port", "x-real-ip", "forwarded", "cf-connecting-ip", "cf-ray", "cf-ipcountry", "cdn-loop"]);

/// The headers the home region gets: the caller's own, the region asked for, and the caller's
/// address under the proxy secret. A request the site's proxy already vouched for keeps its claims.
export function relayHeaders(req: Request, env: Env): Headers {
  const secret = env.get("MCP_PROXY_SECRET") ?? "";
  const out = new Headers();
  for (const [k, v] of req.headers) if (!DROP.has(k.toLowerCase()) && !k.toLowerCase().startsWith("x-sb-")) out.set(k, v);
  const vouched = secret !== "" && equal(req.headers.get("x-mcp-proxy-secret") ?? "", secret);
  if (!vouched) {
    for (const h of ["x-mcp-client-ip", "x-mcp-public-url", "x-mcp-proxy-secret"]) out.delete(h);
    out.set("x-mcp-client-ip", clientAddress(req, env));
    out.set("x-mcp-proxy-secret", secret);
  }
  out.set("x-region", homeRegion(env)!);
  out.set(RELAY_HEADER, here(env) ?? "1");
  return out;
}

/// Hands the request to the home region when it should be, and gives its answer; null when this
/// isolate should answer itself (it is home, relaying is off, or home couldn't be reached). The
/// body is read first, so a request that couldn't be relayed can still be answered here: `again`
/// is that request, to use instead of the original.
export async function relay(req: Request, name: string, env: Env = Deno.env, send: Fetch = fetch): Promise<{ response: Response } | { again: Request }> {
  if (!shouldRelay(req, env)) return { again: req };
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
  const again = () => new Request(req.url, { method: req.method, headers: req.headers, body });
  const started = Date.now();
  try {
    const up = await send(homeURL(req, name, env.get("SUPABASE_URL")!), {
      method: req.method, headers: relayHeaders(req, env), body, redirect: "manual", signal: AbortSignal.timeout(120_000),
    });
    // Home didn't run it (the gateway refused, or sent it somewhere else): answer here instead.
    const ran = (up.headers.get(REGION_HEADER) ?? "").toLowerCase();
    if (ran !== homeRegion(env)) {
      await up.body?.cancel();
      log("relay_failed", { where: here(env) ?? "", status: up.status });
      return { again: again() };
    }
    const headers = new Headers(up.headers);
    for (const h of ["content-encoding", "content-length", "transfer-encoding", "connection"]) headers.delete(h);
    headers.set(RELAY_HEADER, here(env) ?? "1");
    log("relay", { where: here(env) ?? "", status: up.status, ms: Date.now() - started });
    return { response: new Response(up.body, { status: up.status, statusText: up.statusText, headers }) };
  } catch (e) {
    log("relay_failed", { where: here(env) ?? "", ...errorKind(e) });
    return { again: again() };
  }
}

/// The answer with the region that did the work on it.
export function stamped(res: Response, env: Env = Deno.env): Response {
  const at = here(env);
  if (!at || res.headers.has(REGION_HEADER)) return res;
  try { res.headers.set(REGION_HEADER, at); return res; } catch { /* immutable headers: copy */ }
  const headers = new Headers(res.headers);
  headers.set(REGION_HEADER, at);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/// Wraps a function's handler: relay when elsewhere, otherwise run it here and say where.
export function atHome(name: string, handler: (req: Request) => Response | Promise<Response>, env: Env = Deno.env, send: Fetch = fetch) {
  return async (req: Request): Promise<Response> => {
    const r = await relay(req, name, env, send);
    if ("response" in r) return r.response;
    return stamped(await handler(r.again), env);
  };
}
