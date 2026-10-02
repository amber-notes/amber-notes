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
// request that already came from a relay (it says so, under the same secret) is never relayed again.
//
// When home can't be reached, a read (GET, HEAD) is answered where it landed and the log says
// "relay_failed". Anything else gets a 502 and the caller tries again: once a write has been sent,
// home may have run it, and running it here as well would do it twice.
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

/// Whether a relay sent this request: it carries the mark and the secret. The mark alone is
/// anyone's to send, and would keep a request out of the home region.
export function fromRelay(req: Request, env: Env): boolean {
  const secret = env.get("MCP_PROXY_SECRET") ?? "";
  return req.headers.has(RELAY_HEADER) && secret !== "" && equal(req.headers.get("x-mcp-proxy-secret") ?? "", secret);
}

/// Whether this request should be handed to the home region: there is one, this isn't it, the
/// secret that carries the caller's address is set, and the request didn't come from a relay.
/// Preflights are answered where they are: they carry nothing.
export function shouldRelay(req: Request, env: Env): boolean {
  const home = homeRegion(env), at = here(env);
  if (!home || !at || at === home) return false;
  if (!env.get("MCP_PROXY_SECRET") || !env.get("SUPABASE_URL")) return false;
  if (fromRelay(req, env) || req.method === "OPTIONS") return false;
  return true;
}

/// The same request at the function's public address: /functions/v1/<name> and whatever followed
/// the name, with the query. Without forceFunctionRegion: where the relayed request runs is the
/// relay's to say (x-region), never the caller's.
export function homeURL(req: Request, name: string, supabaseURL: string): string {
  const u = new URL(req.url);
  const rest = u.pathname.replace(/^\/functions\/v1/, "").replace(new RegExp(`^/${name}(?=/|$)`), "");
  for (const key of [...u.searchParams.keys()]) if (key.toLowerCase() === "forcefunctionregion") u.searchParams.delete(key);
  return `${supabaseURL.replace(/\/+$/, "")}/functions/v1/${name}${rest}${u.search}`;
}

// Never copied: the connection's own headers (accept-encoding too, so the runtime asks home only
// for encodings it decodes itself), and addresses only a proxy in front may state.
const DROP = new Set(["host", "connection", "content-length", "transfer-encoding", "keep-alive", "upgrade", "te", "expect", "accept-encoding",
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
  // Ours to set: whatever the caller sent under this name is replaced.
  out.set(RELAY_HEADER, here(env) ?? "1");
  return out;
}

const RETRY = "Couldn't reach Amber Notes just now. Try again.";

/// Hands the request to the home region when it should be, and gives its answer. `again` means
/// this isolate should answer itself: it is home, relaying is off, or home couldn't be reached for
/// a read. A write is never run here after it was sent home: home may have run it, so the caller
/// gets a 502 and tries again. Whatever home's side did answer is passed back as it is.
export async function relay(req: Request, name: string, env: Env = Deno.env, send: Fetch = fetch): Promise<{ response: Response } | { again: Request }> {
  if (!shouldRelay(req, env)) return { again: req };
  const read = req.method === "GET" || req.method === "HEAD";
  const body = read ? undefined : await req.arrayBuffer();
  const at = here(env) ?? "";
  const started = Date.now();
  const unreachable = (fields: Record<string, unknown>): { response: Response } | { again: Request } => {
    log("relay_failed", { where: at, method: req.method, ...fields });
    if (read) return { again: new Request(req.url, { method: req.method, headers: req.headers }) };
    return { response: new Response(JSON.stringify({ error: RETRY }), { status: 502, headers: { "content-type": "application/json", "cache-control": "no-store", "retry-after": "2", [RELAY_HEADER]: at } }) };
  };
  let up: Response;
  try {
    up = await send(homeURL(req, name, env.get("SUPABASE_URL")!), {
      method: req.method, headers: relayHeaders(req, env), body, redirect: "manual", signal: AbortSignal.timeout(120_000),
    });
  } catch (e) {
    return unreachable(errorKind(e));
  }
  const ran = (up.headers.get(REGION_HEADER) ?? "").toLowerCase();
  // No function answered (the gateway did, with an error): a read can still be answered here.
  if (!ran && up.status >= 500 && read) {
    await up.body?.cancel();
    return unreachable({ status: up.status });
  }
  const headers = new Headers(up.headers);
  for (const h of ["content-encoding", "content-length", "transfer-encoding", "connection"]) headers.delete(h);
  headers.set(RELAY_HEADER, at);
  // Anything else is the answer: from home, or, if it says another region or none, from wherever
  // it did run, which the log records as a failure to get home.
  if (ran === homeRegion(env)) log("relay", { where: at, status: up.status, ms: Date.now() - started });
  else log("relay_failed", { where: at, method: req.method, status: up.status });
  return { response: new Response(up.body, { status: up.status, statusText: up.statusText, headers }) };
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
