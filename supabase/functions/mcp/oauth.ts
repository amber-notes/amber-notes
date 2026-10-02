// OAuth 2.1 for AI connectors, served by the MCP function itself.
//
// Why here and not Supabase Auth's OAuth server: that one is in beta and currently fails
// for MCP connectors (public clients, `resource`, `offline_access`), and its tokens would be
// full database sessions. These tokens only ever open this MCP server.
//
// Discovery: Supabase can't serve anything at the host's /.well-known/, so the 401 carries
// `resource_metadata` pointing inside this function, and the authorization server metadata is
// served at the issuer + /.well-known/… (the path-appended form MCP clients try). At
// https://mcp.ambernotes.app the server is the host's root, so those are the standard RFC 8414 and
// RFC 9728 locations as well.
//
// Consent: /authorize sends the browser to the site's /connect page (ambernotes.app/connect?request=<id>),
// which names the address the AI returns to (/connect/label; no AI's mark before sign-in) and
// opens Amber Notes (ambernotes://connect?request=<id>).
// Approval happens only in the app, the one place that has the account's data key: it asks
// /connect/request who is asking, the person picks read-only or read & edit, and it posts the
// decision to /connect/decide with their session in an Authorization header.
//
// End-to-end encryption: the app makes the authorization code itself and sends only its hash and
// the data key wrapped under it (code_wrap). The server answers with the client's redirect URL
// without a code; the app adds it. At /token the code opens the wrap, and the key is wrapped
// again under the new access and refresh tokens (oauth_tokens.dk_wrap). The server keeps only
// hashes of codes and tokens, so a wrap opens only while a request carries its token.
//
// Addresses: the function answers at its Supabase address and at every alias in MCP_ALIAS_URLS
// (https://mcp.ambernotes.app by default, a proxy on the site's Vercel project). The proxy names
// the alias it serves in X-MCP-Public-URL; metadata then advertises that address. All addresses
// are one server: a token issued through one works through the others.

import type { Sql } from "npm:postgres@3.4.5";
import { apnsSender, type Environment, type Sender } from "../_shared/apns.ts";
import { HANDOFF, tokenKey, unwrap, wrap } from "../_shared/e2ee.ts";
import { dailyHash, hashSecret } from "../_shared/hash.ts";
import { errorKind, log } from "../_shared/log.ts";

export const SCOPES = ["notes:read", "notes:write"];
const ACCESS_TTL = 60 * 60; // seconds
const REFRESH_TTL_DAYS = 90;
const CODE_TTL = 60; // seconds
const LIMITS: Record<string, [number, number]> = { register: [30, 3600], authorize: [60, 600], token: [120, 600], request: [120, 600], label: [120, 600], decide: [60, 600], status: [400, 600] };

export type Grant = { user_id: string; token_id: string; name: string; can_write: boolean; resource?: string; dk_wrap: string | null };

/// Other public addresses of this server, e.g. https://mcp.ambernotes.app (comma-separated).
export function aliasBases(): string[] {
  const raw = Deno.env.get("MCP_ALIAS_URLS") ?? "https://mcp.ambernotes.app";
  return raw.split(",").map((s) => s.trim().replace(/\/+$/, "")).filter(Boolean);
}

/// Where the function is reachable from outside: the alias a trusted proxy says it serves, or the
/// function's own address, e.g. https://<ref>.supabase.co/functions/v1/mcp. An alias header naming
/// anything else is ignored.
export function publicBase(req: Request): string {
  const asked = fromProxy(req) ? req.headers.get("x-mcp-public-url") : null;
  const alias = asked ? aliasBases().find((a) => sameResource(a, asked)) : undefined;
  return alias ?? functionBase(req);
}

/// Whether a resource indicator names this server, at any of its addresses.
export function isThisServer(resource: string, req: Request): boolean {
  return [functionBase(req), ...aliasBases()].some((b) => sameResource(resource, b));
}

function functionBase(req: Request): string {
  const configured = Deno.env.get("MCP_PUBLIC_URL");
  if (configured) return configured.replace(/\/+$/, "");
  const supa = Deno.env.get("SUPABASE_URL") ?? "";
  if (supa.startsWith("https://")) return supa.replace(/\/+$/, "") + "/functions/v1/mcp";
  // Local stack: SUPABASE_URL is the internal gateway, so trust the forwarded host.
  let host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const port = req.headers.get("x-forwarded-port");
  if (port && !host.includes(":") && !((proto === "http" && port === "80") || (proto === "https" && port === "443"))) host += `:${port}`;
  return `${proto}://${host}/functions/v1/mcp`;
}

export const resourceMetadataURL = (base: string) => `${base}/.well-known/oauth-protected-resource`;

/// The 401 every unauthenticated MCP request gets: where to find out how to sign in.
export function challenge(base: string, error?: string) {
  const parts = [`resource_metadata="${resourceMetadataURL(base)}"`, `scope="${SCOPES.join(" ")}"`];
  if (error) parts.unshift(`error="${error}"`);
  return "Bearer " + parts.join(", ");
}

/// The path after the function name ("" for the MCP endpoint itself).
export function subpath(req: Request): string {
  let p = new URL(req.url).pathname;
  p = p.replace(/^\/functions\/v1/, "").replace(/^\/mcp(?=\/|$)/, "");
  return p.replace(/\/+$/, "");
}

export function isOAuthPath(p: string) {
  return p.startsWith("/.well-known/") || ["/register", "/authorize", "/token", "/revoke", "/connect/request", "/connect/label", "/connect/ask", "/connect/status", "/connect/nonce", "/connect/reveal", "/connect/decide", "/connect/release"].includes(p);
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors, ...headers } });
const oauthError = (error: string, description: string, status = 400) => json({ error, error_description: description }, status);

export const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "authorization, content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version, www-authenticate",
  "Access-Control-Max-Age": "86400",
};

// MARK: Small helpers

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
export const randomToken = (prefix: string) => prefix + hex(crypto.getRandomValues(new Uint8Array(32)));
export async function sha256Hex(s: string) {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
}
async function s256(verifier: string) {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  return btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/// Resource indicators compare case-insensitively on scheme and host, ignoring a trailing slash.
export function sameResource(a: string, b: string): boolean {
  try {
    const x = new URL(a), y = new URL(b);
    const norm = (u: URL) => `${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
    return norm(x) === norm(y) && !x.hash && !y.hash;
  } catch {
    return false;
  }
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/// Registered redirect URIs: https anywhere, or http on a loopback address (native clients).
export function validRedirect(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.hash) return false;
    if (u.protocol === "https:") return true;
    return u.protocol === "http:" && LOOPBACK.has(u.hostname);
  } catch {
    return false;
  }
}

/// Exact match, except loopback redirects may use any port (RFC 8252 §7.3).
export function redirectMatches(registered: string[], asked: string): boolean {
  if (registered.includes(asked)) return true;
  try {
    const a = new URL(asked);
    if (a.protocol !== "http:" || !LOOPBACK.has(a.hostname)) return false;
    return registered.some((r) => {
      const u = new URL(r);
      return u.protocol === "http:" && u.hostname === a.hostname && u.pathname === a.pathname && u.search === a.search;
    });
  } catch {
    return false;
  }
}

/// The caller's address. Behind the site's proxy every request comes from Vercel, so the proxy
/// passes the real one along, and it counts only with the shared secret.
export function clientIP(req: Request) {
  const forwarded = req.headers.get("x-mcp-client-ip");
  if (forwarded && fromProxy(req)) return forwarded;
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

/// Whether the site's proxy sent this request: it carries the shared secret. Proxy headers without
/// it are ignored, and logged, since they mean a missing secret or someone trying them.
export function fromProxy(req: Request): boolean {
  const secret = Deno.env.get("MCP_PROXY_SECRET");
  const claims = req.headers.has("x-mcp-client-ip") || req.headers.has("x-mcp-public-url") || req.headers.has("x-mcp-proxy-secret");
  if (!claims) return false;
  if (secret && timingSafeEqual(req.headers.get("x-mcp-proxy-secret") ?? "", secret)) return true;
  // bad_secret: check MCP_PROXY_SECRET on Vercel and here. no_secret: rate limits count Vercel's
  // address and metadata names the Supabase address until it's set.
  log("proxy_headers_ignored", { kind: secret ? "bad_secret" : "no_secret" });
  return false;
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/// True when this IP has made too many requests to `bucket` recently. Records this one.
async function limited(sql: Sql, req: Request, bucket: string): Promise<boolean> {
  const [max, window] = LIMITS[bucket];
  const ip = await dailyHash(hashSecret(), clientIP(req));
  const [{ n }] = await sql`
    with recent as (select count(*)::int n from public.oauth_rate where bucket = ${bucket} and ip_hash = ${ip} and at > now() - make_interval(secs => ${window}))
    insert into public.oauth_rate (bucket, ip_hash) select ${bucket}, ${ip} returning (select n from recent)`;
  if (Math.random() < 0.02) {
    await sql`delete from public.oauth_rate where at < now() - interval '2 hours'`;
    await sql`delete from public.oauth_requests where expires_at < now() - interval '1 day' and (code_expires_at is null or code_expires_at < now() - interval '1 day')`;
    await sql`delete from public.oauth_tokens where expires_at < now() - interval '1 day'`;
    // An expired token or code can't be used, so its wrap of the data key goes now, not in a day.
    await sql`update public.oauth_tokens set dk_wrap = null where expires_at < now() and dk_wrap is not null`;
    await sql`update public.oauth_requests set code_wrap = null where code_expires_at < now() and code_wrap is not null`;
  }
  return n >= max;
}

async function formOrJson(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = await req.json().catch(() => ({}));
    return Object.fromEntries(Object.entries(body ?? {}).map(([k, v]) => [k, String(v)]));
  }
  return Object.fromEntries(new URLSearchParams(await req.text()));
}

// MARK: Who is asking

/// The exact addresses where ChatGPT and Claude receive their sign-in. Only a request that returns
/// to one of these may show that AI's name and mark; anyone can call themselves "Claude".
export const KNOWN_CALLBACKS: Record<string, "ChatGPT" | "Claude"> = {
  "https://chatgpt.com/connector_platform_oauth_redirect": "ChatGPT",
  "https://platform.openai.com/apps-manage/oauth": "ChatGPT",
  "https://claude.ai/api/mcp/auth_callback": "Claude",
  "https://claude.com/api/mcp/auth_callback": "Claude",
};

/// ChatGPT's per-connector callback, used when a server doesn't send `iss` (this one does, so it's a
/// fallback): https://developers.openai.com/apps-sdk/build/auth
const CHATGPT_CONNECTOR_CALLBACK = /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/;

export const verifiedAI = (redirectURI: string): "ChatGPT" | "Claude" | null =>
  KNOWN_CALLBACKS[redirectURI] ?? (CHATGPT_CONNECTOR_CALLBACK.test(redirectURI) ? "ChatGPT" : null);

// Latin look-alikes from other scripts, so "Сlaude" (Cyrillic С) still reads as Claude.
const LOOKALIKES: Record<string, string> = {
  "а": "a", "с": "c", "е": "e", "о": "o", "р": "p", "х": "x", "у": "y", "і": "i", "ӏ": "l", "ԁ": "d", "ɡ": "g", "һ": "h",
  "α": "a", "ο": "o", "ρ": "p", "τ": "t", "ν": "v", "ι": "i", "κ": "k", "μ": "m",
};

/// Names only ChatGPT, Claude or Amber Notes itself may use.
export function claimsATrustedName(name: string): boolean {
  const flat = [...name.normalize("NFKC").toLowerCase()].map((c) => LOOKALIKES[c] ?? c).join("")
    .replace(/[^a-z0-9]/g, "").replace(/0/g, "o").replace(/1/g, "l").replace(/4/g, "a");
  return ["chatgpt", "openai", "claude", "anthropic", "amber"].some((w) => flat.includes(w));
}

/// A registered name made safe to show: no control, format or direction characters, one line, short.
export function cleanName(raw: string): string {
  return raw.normalize("NFKC").replace(/[\t\n\r\p{Zl}\p{Zp}]/gu, " ").replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/\s+/g, " ").trim().slice(0, 80);
}

/// What the consent screen and the connection are called: the AI's own name when the request
/// returns to its pinned callback, and otherwise always the address access goes to. A name an app
/// gives itself is never a title, however it's spelled; look-alike letters can't all be caught.
export function displayName(name: string, redirectURI: string): string {
  // Cleaned here too: clients registered before names were cleaned keep what they sent.
  if (verifiedAI(redirectURI)) return cleanName(name) || verifiedAI(redirectURI)!;
  return addressName(redirectURI);
}

/// The address access goes to, as a title: its host, or "An app on this computer" for loopback.
export function addressName(redirectURI: string): string {
  const host = new URL(redirectURI).hostname;
  return LOOPBACK.has(host) ? "An app on this computer" : host;
}

/// Where the code goes: the client's redirect_uri as registered, with `state` (when the client
/// sent one) and `iss` (the address its /authorize went through, RFC 9207) set, in that order,
/// through URL.searchParams. /connect/decide answers with exactly this, and a device sealing the
/// redirect for a browser elsewhere builds the same from /connect/request's redirect_uri, state and
/// iss. The app or the page adds `code` (or the server `error` for a denial).
export function clientRedirect(redirectURI: string, state: string | null, iss: string): URL {
  const u = new URL(redirectURI);
  if (state) u.searchParams.set("state", state);
  u.searchParams.set("iss", iss);
  return u;
}

/// The name an unverified app gives itself, only for a secondary "It calls itself …" line: NFKD,
/// every mark removed, lowercase, and nothing but ASCII letters, digits, spaces and basic
/// punctuation (anything else becomes "?").
export function claimedName(name: string): string {
  return cleanName(name).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase()
    .replace(/[^a-z0-9 .,:;'&()+_!-]/g, "?").replace(/\s+/g, " ").trim().slice(0, 60);
}

// MARK: Metadata

function protectedResource(base: string) {
  return {
    resource: base,
    authorization_servers: [base],
    scopes_supported: SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Amber Notes",
  };
}

function authorizationServer(base: string) {
  return {
    issuer: base,
    authorization_endpoint: `${base}/authorize`,
    token_endpoint: `${base}/token`,
    registration_endpoint: `${base}/register`,
    revocation_endpoint: `${base}/revoke`,
    scopes_supported: SCOPES,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    authorization_response_iss_parameter_supported: true,
    // For clients that read this as OpenID discovery. No ID tokens are issued.
    subject_types_supported: ["public"],
  };
}

// MARK: Router

export async function handleOAuth(req: Request, sql: Sql, path: string): Promise<Response> {
  const base = publicBase(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

  if (path.startsWith("/.well-known/")) {
    if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);
    if (path.startsWith("/.well-known/oauth-protected-resource")) return json(protectedResource(base));
    if (path.startsWith("/.well-known/oauth-authorization-server") || path.startsWith("/.well-known/openid-configuration")) {
      return json(authorizationServer(base));
    }
    return json({ error: "not_found" }, 404);
  }

  try {
    switch (path) {
      case "/register": return req.method === "POST" ? await register(req, sql) : json({ error: "method_not_allowed" }, 405);
      case "/authorize": return await authorize(req, sql, base);
      case "/token": return req.method === "POST" ? await token(req, sql, base) : json({ error: "method_not_allowed" }, 405);
      case "/revoke": return req.method === "POST" ? await revoke(req, sql) : json({ error: "method_not_allowed" }, 405);
      case "/connect/request": return await describeRequest(req, sql);
      case "/connect/label": return req.method === "GET" ? await label(req, sql) : json({ error: "method_not_allowed" }, 405);
      case "/connect/ask": return req.method === "POST" ? await ask(req, sql) : json({ error: "method_not_allowed" }, 405);
      case "/connect/status": return req.method === "POST" ? await status(req, sql) : json({ error: "method_not_allowed" }, 405);
      case "/connect/nonce": return req.method === "POST" ? await deviceNonce(req, sql) : json({ error: "method_not_allowed" }, 405);
      case "/connect/reveal": return req.method === "POST" ? await reveal(req, sql) : json({ error: "method_not_allowed" }, 405);
      case "/connect/decide": return req.method === "POST" ? await decide(req, sql) : json({ error: "method_not_allowed" }, 405);
      case "/connect/release": return req.method === "POST" ? await release(req, sql) : json({ error: "method_not_allowed" }, 405);
    }
  } catch (e) {
    log("oauth_error", { path_kind: path, ...errorKind(e) });
    return oauthError("server_error", "Something went wrong. Try again.", 500);
  }
  return json({ error: "not_found" }, 404);
}

// MARK: Registration (RFC 7591)

async function register(req: Request, sql: Sql): Promise<Response> {
  if (await limited(sql, req, "register")) return oauthError("slow_down", "Too many registrations. Try again later.", 429);
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return oauthError("invalid_client_metadata", "Send client metadata as JSON.");
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 10) return oauthError("invalid_redirect_uri", "Give between 1 and 10 redirect_uris.");
  const bad = uris.find((u) => !validRedirect(u) || u.length > 2000);
  if (bad) return oauthError("invalid_redirect_uri", `Redirect URIs must be https, or http on localhost: ${bad}`);
  const grants = Array.isArray(body.grant_types) ? body.grant_types.map(String) : ["authorization_code"];
  if (grants.some((g) => !["authorization_code", "refresh_token"].includes(g))) {
    return oauthError("invalid_client_metadata", "Only authorization_code and refresh_token grants are supported.");
  }
  // Grants carry the name too (at most 80 characters there). A trusted name without that AI's
  // pinned callback is replaced by the address it returns to.
  const cleaned = cleanName(String(body.client_name ?? ""));
  const name = cleaned && (!claimsATrustedName(cleaned) || uris.some((u) => verifiedAI(u))) ? cleaned : displayName(cleaned || "app", uris[0]);
  const id = randomToken("amb_client_").slice(0, 43);
  // Registration is open by design, so clients that never got an approval are forgotten
  // after a day, and a flood of fresh ones (many addresses at once) is turned away.
  await sql`delete from public.oauth_clients c where c.created_at < now() - interval '1 day'
            and not exists (select 1 from public.mcp_tokens t where t.client_id = c.id)`;
  const [{ recent }] = await sql<{ recent: number }[]>`select count(*)::int recent from public.oauth_clients where created_at > now() - interval '1 hour'`;
  if (recent >= 2000) return oauthError("slow_down", "Too many registrations right now. Try again later.", 429);
  await sql`insert into public.oauth_clients (id, client_name, redirect_uris) values (${id}, ${name}, ${uris})`;
  return json({
    client_id: id,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: name,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    // Public client: PKCE proves who's exchanging the code, so no secret is issued.
    token_endpoint_auth_method: "none",
    scope: SCOPES.join(" "),
  }, 201);
}

// MARK: Authorization

async function authorize(req: Request, sql: Sql, base: string): Promise<Response> {
  const q = req.method === "POST" ? await formOrJson(req) : Object.fromEntries(new URL(req.url).searchParams);
  if (await limited(sql, req, "authorize")) return problem("too_many");
  const [client] = await sql<{ id: string; redirect_uris: string[] }[]>`select id, redirect_uris from public.oauth_clients where id = ${q.client_id ?? ""}`;
  if (!client) return problem("unknown_app");
  const redirect = q.redirect_uri ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : "");
  if (!redirect || !redirectMatches(client.redirect_uris, redirect)) return problem("wrong_return");
  // Nothing is sent back to a client nobody has approved yet: a bad request ends on our own page,
  // so /authorize can't be used to bounce people to any address that registered itself.
  if (q.response_type !== "code") return problem("unsupported");
  if (!q.code_challenge || q.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge)) return problem("pkce");
  if (q.resource && !isThisServer(q.resource, req)) return problem("wrong_server");

  const [row] = await sql<{ id: string }[]>`
    insert into public.oauth_requests (client_id, redirect_uri, state, code_challenge, scope, resource)
    values (${client.id}, ${redirect}, ${q.state ?? null}, ${q.code_challenge}, ${q.scope ?? null}, ${base})
    returning id`;
  // Hand over to the site's consent page, which opens the app or lets the person sign in there.
  const page = new URL(connectPage());
  page.searchParams.set("request", row.id);
  return new Response(null, { status: 302, headers: { location: page.toString(), "cache-control": "no-store" } });
}

/// The consent page, saying why this sign-in can't go ahead (it has the words for each code).
function problem(code: string): Response {
  const page = new URL(connectPage());
  page.searchParams.set("problem", code);
  return new Response(null, { status: 302, headers: { location: page.toString(), "cache-control": "no-store" } });
}

/// The web page that asks for consent (the site's /connect).
export function connectPage(): string {
  return Deno.env.get("CONNECT_PAGE_URL") ?? "https://ambernotes.app/connect";
}

/// /connect/request and /connect/decide take the person's session in a header, never a cookie, so a
/// page elsewhere can't ride on it. On top of that, browsers may only call them from the site:
/// the apps send no Origin, and any other origin is refused.
function allowedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  return origin === null || origin === new URL(connectPage()).origin;
}

/// The signed-in person, from their Supabase session (the app or the web page sends it).
async function sessionUser(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return null;
  const url = Deno.env.get("SUPABASE_URL")!;
  const key = Deno.env.get("SUPABASE_ANON_KEY")!;
  const res = await fetch(`${url}/auth/v1/user`, { headers: { authorization: auth, apikey: key } });
  if (!res.ok) return null;
  const user = await res.json().catch(() => null);
  return typeof user?.id === "string" ? user.id : null;
}

type RequestRow = { id: string; client_id: string; client_name: string; redirect_uri: string; state: string | null; scope: string | null; resource: string; expires_at: Date; claimed_by: string | null };

async function pending(sql: Sql, id: string): Promise<RequestRow | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [r] = await sql<RequestRow[]>`
    select r.id, r.client_id, c.client_name, r.redirect_uri, r.state, r.scope, r.resource, r.expires_at, r.claimed_by
    from public.oauth_requests r join public.oauth_clients c on c.id = r.client_id
    where r.id = ${id} and r.decided_at is null and r.expires_at > now()`;
  return r;
}

/// A request belongs to the first account that opens it; nobody else can see or answer it.
async function claim(sql: Sql, r: RequestRow, user: string): Promise<boolean> {
  if (r.claimed_by) return r.claimed_by === user;
  const [row] = await sql`update public.oauth_requests set claimed_by = ${user}
    where id = ${r.id} and (claimed_by is null or claimed_by = ${user}) returning 1`;
  return Boolean(row);
}

const EXPIRED = "This request has expired. Start connecting again from the other app.";
const NOT_YOURS = "Another Amber Notes account is answering this request. Start connecting again from the other app.";

/// What the app and the web page show on the consent screen.
async function describeRequest(req: Request, sql: Sql): Promise<Response> {
  if (!allowedOrigin(req)) return json({ error: "Not allowed from this site." }, 403);
  const user = await sessionUser(req);
  if (!user) return json({ error: "Sign in to Amber Notes first." }, 401);
  if (await limited(sql, req, "request")) return json({ error: "Too many attempts. Wait a few minutes and try again." }, 429);
  const r = await pending(sql, new URL(req.url).searchParams.get("id") ?? "");
  if (!r) return json({ error: EXPIRED }, 404);
  if (!(await claim(sql, r, user))) return json({ error: NOT_YOURS }, 403);
  const host = new URL(r.redirect_uri).hostname;
  const scopes = (r.scope ?? "").split(/\s+/).filter(Boolean);
  // Asked from a browser elsewhere: when, and in what (the page says, e.g. "Chrome on a Mac").
  const asked = await askedFrom(sql, r.id);
  // A device answering a browser it can't see has no way to tell whose ChatGPT or Claude this is
  // (anyone can start a real ChatGPT sign-in and ask your devices), so no AI's mark or name is a
  // title then: the address is, and the name the client gives itself is only a claim.
  const verified = asked.asked ? null : verifiedAI(r.redirect_uri);
  return json({
    id: r.id,
    client_name: asked.asked ? host : displayName(r.client_name, r.redirect_uri),
    // Unverified apps: what they call themselves, made plain, for a secondary line only.
    claimed_name: verified ? null : claimedName(r.client_name) || null,
    redirect_host: host,
    // The exact return address: an AI's mark is shown only for its pinned callback.
    redirect_uri: r.redirect_uri,
    // With redirect_uri, what the redirect is built from (see clientRedirect): the device that
    // approves for a browser seals exactly that redirect with the code.
    state: r.state,
    iss: r.resource,
    verified_ai: verified,
    loopback: LOOPBACK.has(host),
    // No scope means "whatever you allow"; asking only for read keeps it read-only.
    wants_write: scopes.length === 0 || scopes.includes("notes:write"),
    expires_at: r.expires_at,
    ...asked,
  });
}

async function askedFrom(sql: Sql, id: string): Promise<{ asked: boolean; started_at?: Date; started_from?: string }> {
  const [a] = await sql<{ created_at: Date; started_from: string }[]>`
    select created_at, started_from from public.connect_asks where request_id = ${id}`;
  return a ? { asked: true, started_at: a.created_at, started_from: a.started_from } : { asked: false };
}

// MARK: Approving from your devices, for a browser anywhere

const ASKS_PER_10_MINUTES = 10;
const RAW_P256 = /^[A-Za-z0-9+/]{86}[AEIMQUYcgkosw048]=$/;

/// The web page, signed in only to say whose request this is, asks the account's devices to
/// approve it. It sends the public half of a key pair it keeps in memory; the approving device
/// seals the authorization code to it, so only that page can open it. The page signs out straight
/// after and waits on /connect/status.
async function ask(req: Request, sql: Sql): Promise<Response> {
  if (!allowedOrigin(req)) return json({ error: "Not allowed from this site." }, 403);
  const user = await sessionUser(req);
  if (!user) return json({ error: "Sign in to Amber Notes first." }, 401);
  if (await limited(sql, req, "request")) return json({ error: "Too many attempts. Wait a few minutes and try again." }, 429);
  const body = await req.json().catch(() => ({})) as { id?: string; browser_key?: unknown; from?: unknown; pickup_hash?: unknown; match_commit?: unknown };
  const key = typeof body.browser_key === "string" ? body.browser_key : "";
  if (!RAW_P256.test(key) || atob(key).charCodeAt(0) !== 4) return json({ error: "Reload this page and try again." }, 400);
  // SHA-256 of the page's pickup secret: /connect/status hands the answer only to the secret.
  const pickupHash = typeof body.pickup_hash === "string" ? body.pickup_hash : "";
  if (!HEX64.test(pickupHash)) return json({ error: "Reload this page and try again." }, 400);
  // Number matching, commit then reveal: the page's SHA-256(browser key raw ‖ its nonce), sent
  // before any device writes its own nonce. The page reveals its nonce only after (/connect/reveal).
  const commit = typeof body.match_commit === "string" ? body.match_commit : "";
  if (!HEX64.test(commit)) return json({ error: "Reload this page and try again." }, 400);
  const from = cleanName(typeof body.from === "string" ? body.from : "").slice(0, 60) || "a web browser";
  // A wrong number typed on a device holds the account's asks for an hour.
  const [blocked] = await sql`select 1 from public.connect_blocks where user_id = ${user} and blocked_until > now()`;
  if (blocked) return json({ error: BLOCKED }, 429);
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int n from public.connect_asks where user_id = ${user} and created_at > now() - interval '10 minutes'`;
  if (n >= ASKS_PER_10_MINUTES) return json({ error: "Too many requests to connect. Wait a few minutes and try again." }, 429);
  const r = await pending(sql, String(body.id ?? ""));
  if (!r) return json({ error: EXPIRED }, 404);
  if (!(await claim(sql, r, user))) return json({ error: NOT_YOURS }, 403);
  // A reloaded page makes a new key and a new commit: the unanswered ask takes them, and both
  // nonces start over, so a device's nonce always comes after the commit it's matched against.
  const [row] = await sql<{ expires_at: Date }[]>`
    insert into public.connect_asks (request_id, user_id, browser_key, started_from, expires_at, pickup_hash, match_commit)
    values (${r.id}, ${user}, ${key}, ${from}, ${r.expires_at}, ${pickupHash}, ${commit})
    on conflict (request_id) do update set browser_key = excluded.browser_key, started_from = excluded.started_from,
      pickup_hash = excluded.pickup_hash, match_commit = excluded.match_commit, device_nonce = null, page_nonce = null,
      created_at = now()
      where connect_asks.answered_at is null and connect_asks.user_id = ${user}
    returning expires_at`;
  if (!row) return json({ error: EXPIRED }, 404);
  // The push only wakes the account's devices; it doesn't hold up the page.
  const notified = notifyDevices(sql, user, r.id);
  const edge = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
  if (edge) edge.waitUntil(notified); else await notified;
  return json({ asked: true, expires_at: row.expires_at });
}

const BLOCKED = "Connecting AIs is paused for an hour on this account because a wrong number was typed. If that wasn't you, change your password.";
const NONCE = /^[0-9a-f]{32}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

let pushSender: Sender | null | undefined;
/** Tests: a fake APNs. */
export function setPushSender(s: Sender | null | undefined) { pushSender = s; }

/// Tells the account's devices about a new ask with a push (APNs), besides realtime while the app
/// runs. The push says only that there's a request, in fixed words, and the request's id:
/// the device fetches the ask and checks it itself (number matching) before anything can be
/// allowed. Tokens Apple says are gone are deleted. Without an APNs key, nothing is sent.
export async function notifyDevices(sql: Sql, user: string, requestId: string): Promise<void> {
  const send = pushSender === undefined ? (pushSender = apnsSender()) : pushSender;
  // Said, so a push that never arrives because the APNs secrets are missing shows in the logs.
  if (!send) return log("push_off");
  try {
    const tokens = await sql<{ token: string; environment: Environment }[]>`
      select token, environment from public.device_tokens
      where user_id = ${user} and updated_at > now() - interval '90 days'`;
    // Fixed words: not even the name the app gives itself, which anyone can choose.
    const payload = {
      aps: { alert: { title: "An AI connection request", body: "Open Amber Notes to see it." }, sound: "default", "thread-id": "connect" },
      ask: requestId,
    };
    const outcomes = await Promise.all(tokens.map(async (t) => ({ t, outcome: await send({ token: t.token, environment: t.environment, payload, collapseId: requestId }) })));
    const gone = outcomes.filter((o) => o.outcome === "gone").map((o) => o.t.token);
    if (gone.length) await sql`delete from public.device_tokens where user_id = ${user} and token = any(${gone})`;
    log("push", { count: tokens.length, status: outcomes.filter((o) => o.outcome === "sent").length });
  } catch (e) {
    log("push_failed", errorKind(e));
  }
}

/// The device's half of number matching: POST {id, nonce} with the person's session, from the app.
/// Written once, only after the page's commit (the ask) and while the ask is open; the same nonce
/// again is fine, a different one is refused. A device makes a fresh nonce whenever the ask's
/// device_nonce is empty (a reloaded page starts both nonces over).
async function deviceNonce(req: Request, sql: Sql): Promise<Response> {
  if (!allowedOrigin(req)) return json({ error: "Not allowed from this site." }, 403);
  const user = await sessionUser(req);
  if (!user) return json({ error: "Sign in to Amber Notes first." }, 401);
  if (await limited(sql, req, "request")) return json({ error: "Too many attempts. Wait a few minutes and try again." }, 429);
  const body = await req.json().catch(() => ({})) as { id?: unknown; nonce?: unknown };
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : "";
  const nonce = typeof body.nonce === "string" ? body.nonce : "";
  if (!NONCE.test(nonce)) return json({ error: "Update Amber Notes to connect an AI." }, 400);
  if (!id) return json({ error: EXPIRED }, 404);
  const [set] = await sql<{ device_nonce: string }[]>`
    update public.connect_asks a set device_nonce = ${nonce}
    from public.oauth_requests r
    where a.request_id = ${id} and r.id = a.request_id and a.user_id = ${user}
      and a.answered_at is null and a.expires_at > now() and r.decided_at is null and r.expires_at > now()
      and (a.device_nonce is null or a.device_nonce = ${nonce})
    returning a.device_nonce`;
  if (set) return json({ nonce_set: true });
  const [other] = await sql`select 1 from public.connect_asks a join public.oauth_requests r on r.id = a.request_id
    where a.request_id = ${id} and a.user_id = ${user} and a.answered_at is null and a.expires_at > now()
      and r.decided_at is null and r.expires_at > now() and a.device_nonce is not null`;
  if (other) return json({ error: "Another device is answering this request." }, 409);
  return json({ error: EXPIRED }, 404);
}

/// Where the page's request stands: POST {id, pickup}. No session: the request id is the page's,
/// and the answer (the sealed code, or the declined redirect) goes only to the pickup secret whose
/// SHA-256 the ask stored, and only once. Without it, only the state. The code itself is sealed to
/// a key only the page holds. While the ask is open, the pickup also gets the device's nonce once a
/// device has written it (null before): the page then reveals its own (/connect/reveal).
async function status(req: Request, sql: Sql): Promise<Response> {
  if (await limited(sql, req, "status")) return json({ error: "Too many attempts. Wait a few minutes and try again." }, 429);
  const body = await req.json().catch(() => ({})) as { id?: unknown; pickup?: unknown };
  const id = typeof body.id === "string" ? body.id : "";
  if (!UUID.test(id)) return json({ state: "expired" });
  const pickup = typeof body.pickup === "string" && HEX64.test(body.pickup) ? body.pickup : null;
  const [a] = await sql<{ answered_at: Date | null; denied: boolean; delivered: boolean; expired: boolean; pickup_hash: string; device_nonce: string | null }[]>`
    select answered_at, denied, delivered_at is not null as delivered, expires_at < now() as expired, pickup_hash, device_nonce
    from public.connect_asks where request_id = ${id}`;
  const hash = pickup ? await sha256OfHex(pickup) : null;
  const picksUp = Boolean(a && hash && timingSafeEqual(hash, a.pickup_hash));
  if (a?.answered_at) {
    if (!picksUp) return json({ state: a.delivered ? "delivered" : a.denied ? "denied" : "approved" });
    // Exactly one pickup gets the answer, even when two arrive at once.
    const [handed] = await sql<{ answer: string | null; redirect: string | null; denied: boolean }[]>`
      with old as (select request_id, answer, redirect, denied from public.connect_asks
                   where request_id = ${id} and delivered_at is null and pickup_hash = ${hash} for update)
      update public.connect_asks c set answer = null, delivered_at = now() from old where c.request_id = old.request_id
      returning old.answer, old.redirect, old.denied`;
    if (!handed) return json({ state: "delivered" });
    // The page sends the browser to a declined redirect by itself, so only to a web address or an
    // app on this computer, never a javascript: or other scheme a database row could hold.
    if (handed.denied) return json(handed.redirect && validRedirect(handed.redirect) ? { state: "denied", redirect: handed.redirect } : { state: "denied" });
    return handed.answer ? json({ state: "approved", redirect: handed.redirect, handoff: handed.answer }) : json({ state: "delivered" });
  }
  const [r] = await sql<{ decided: boolean; expired: boolean }[]>`
    select decided_at is not null as decided, expires_at < now() as expired from public.oauth_requests where id = ${id}`;
  if (!r || r.expired || a?.expired) return json({ state: "expired" });
  // Answered in the app on this computer (the Open Amber Notes shortcut): the app went on from there.
  if (r.decided) return json({ state: "answered_in_app" });
  if (!a) return json({ state: "pending" });
  return json(picksUp ? { state: "asked", device_nonce: a.device_nonce } : { state: "asked" });
}

/// The page's half of number matching: POST {id, pickup, nonce}, no session. Only with the pickup
/// secret, only after a device wrote its nonce, and once: the same nonce again is fine, another is
/// refused. The nonce must open the page's commit (the device checks that before showing a number).
async function reveal(req: Request, sql: Sql): Promise<Response> {
  if (await limited(sql, req, "status")) return json({ error: "Too many attempts. Wait a few minutes and try again." }, 429);
  const body = await req.json().catch(() => ({})) as { id?: unknown; pickup?: unknown; nonce?: unknown };
  const id = typeof body.id === "string" && UUID.test(body.id) ? body.id : "";
  const pickup = typeof body.pickup === "string" && HEX64.test(body.pickup) ? body.pickup : null;
  const nonce = typeof body.nonce === "string" ? body.nonce : "";
  if (!NONCE.test(nonce)) return json({ error: "Reload this page and try again." }, 400);
  if (!id) return json({ error: EXPIRED }, 404);
  const [a] = await sql<{ pickup_hash: string; open: boolean; device_nonce: string | null; page_nonce: string | null }[]>`
    select a.pickup_hash, a.device_nonce, a.page_nonce,
      (a.answered_at is null and a.expires_at > now() and r.decided_at is null and r.expires_at > now()) as open
    from public.connect_asks a join public.oauth_requests r on r.id = a.request_id where a.request_id = ${id}`;
  const hash = pickup ? await sha256OfHex(pickup) : null;
  if (!a || !hash || !timingSafeEqual(hash, a.pickup_hash)) return json({ error: "Reload this page and try again." }, 403);
  if (!a.open) return json({ error: EXPIRED }, 404);
  if (!a.device_nonce) return json({ error: "Wait for your device to show the request." }, 409);
  const [set] = await sql`
    update public.connect_asks set page_nonce = ${nonce}
    where request_id = ${id} and pickup_hash = ${hash} and answered_at is null and expires_at > now()
      and device_nonce is not null and (page_nonce is null or page_nonce = ${nonce})
    returning 1`;
  if (!set) return json({ error: "This request changed. Reload this page and try again." }, 409);
  return json({ revealed: true });
}

const HEX64 = /^[0-9a-f]{64}$/;

/// Lowercase hex SHA-256 of the bytes a hex string stands for (the pickup secret's hash).
async function sha256OfHex(h: string): Promise<string> {
  const bytes = new Uint8Array(h.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
}

/// Who is asking, for the web page that sends the person to the app: no session, nothing else.
async function label(req: Request, sql: Sql): Promise<Response> {
  if (await limited(sql, req, "label")) return json({ error: "Too many attempts. Wait a few minutes and try again." }, 429);
  const r = await pending(sql, new URL(req.url).searchParams.get("id") ?? "");
  if (!r) return json({ error: EXPIRED }, 404);
  // Before anyone signs in, the page can't know whose sign-in this is, so no AI's mark either: the
  // address, and what the client calls itself only as a claim.
  return json({
    client_name: addressName(r.redirect_uri),
    claimed_name: claimedName(r.client_name) || null,
    redirect_host: new URL(r.redirect_uri).hostname,
    verified_ai: null,
  });
}

const CHANGED = "This request changed. Start connecting again from the other app.";

/// Allow or deny, from the app. The app shows the exact return address from /connect/request and
/// sends it back, so what the person approved is where the code goes. Allow creates the grant and
/// stores the hash of the one-minute, single-use code the app made, with the data key wrapped
/// under it; the answer is the client's redirect without the code, which the app adds.
///
/// Asked from a browser, a device allows only once the page has revealed its nonce (the device
/// has shown the number and checked the page's commit by then). A device declines with
/// `wrong_number: true` when the person typed a number that didn't match: the account then takes no
/// new asks for an hour, and every device hears of it (a 'wrong_number' notice).
async function decide(req: Request, sql: Sql): Promise<Response> {
  if (!allowedOrigin(req)) return json({ error: "Not allowed from this site." }, 403);
  const user = await sessionUser(req);
  if (!user) return json({ error: "Sign in to Amber Notes first." }, 401);
  if (await limited(sql, req, "decide")) return json({ error: "Too many attempts." }, 429);
  const body = await req.json().catch(() => ({})) as { id?: string; allow?: boolean; write?: boolean; redirect_uri?: unknown; code_hash?: unknown; code_wrap?: unknown; handoff?: unknown; wrong_number?: unknown };
  const r = await pending(sql, String(body.id ?? ""));
  if (!r) return json({ error: EXPIRED }, 404);
  if (!(await claim(sql, r, user))) return json({ error: NOT_YOURS }, 403);
  if (body.redirect_uri !== r.redirect_uri) return json({ error: CHANGED }, 409);

  const allow = body.allow === true;
  const codeHash = typeof body.code_hash === "string" ? body.code_hash : "";
  const codeWrap = typeof body.code_wrap === "string" ? body.code_wrap : "";
  if (allow) {
    const [key] = await sql<{ key_id: string }[]>`select key_id from public.account_keys where user_id = ${user}`;
    if (!key) return json({ error: "Set up Amber Notes on this device first." }, 409);
    if (!/^[0-9a-f]{64}$/.test(codeHash) || codeWrap.length > 300 || !/^amb2\.[0-9a-f]{16}\.[A-Za-z0-9+/]+={0,2}$/.test(codeWrap)) {
      return json({ error: "Update Amber Notes to connect an AI." }, 400);
    }
    if (codeWrap.split(".")[1] !== key.key_id) {
      return json({ error: "This device has an old key for your notes. Open Amber Notes again to get the current one." }, 409);
    }
  }
  // Asked from a browser: a device's code goes to that page, sealed to its key, and the device
  // opens nothing. The page itself (approving with the recovery key) keeps its own code.
  const [asked] = await sql<{ request_id: string; started_from: string }[]>`
    select request_id, started_from from public.connect_asks where request_id = ${r.id}`;
  const fromPage = req.headers.get("origin") === new URL(connectPage()).origin;
  const handoff = typeof body.handoff === "string" && !fromPage ? body.handoff : "";
  if (asked && allow && !fromPage && (!HANDOFF.test(handoff) || handoff.length > 600)) return json({ error: "Update Amber Notes to connect an AI." }, 400);

  // The issuer the client started with: the address its /authorize went through. Built as
  // clientRedirect documents, the same way the device builds what it seals.
  const u = clientRedirect(r.redirect_uri, r.state, r.resource);
  const name = displayName(r.client_name, r.redirect_uri);
  const scopes = (r.scope ?? "").split(/\s+/).filter(Boolean);
  const write = body.write === true && (scopes.length === 0 || scopes.includes("notes:write"));
  const wrongNumber = Boolean(asked) && !allow && body.wrong_number === true;
  // One answer per request, even when two arrive at once.
  const answered = await sql.begin(async (tx): Promise<boolean | "reveal"> => {
    if (asked && allow && !fromPage) {
      // Read under the row's lock, so a page that asks again (both nonces start over) can't slip
      // in between the check and the answer.
      const [a] = await tx<{ page_nonce: string | null }[]>`
        select page_nonce from public.connect_asks where request_id = ${r.id} for update`;
      if (!a?.page_nonce) return "reveal";
    }
    const [open] = await tx`update public.oauth_requests set decided_at = now()
      where id = ${r.id} and decided_at is null and claimed_by = ${user} returning 1`;
    if (!open) return false;
    if (wrongNumber) {
      await tx`insert into public.connect_blocks (user_id, blocked_until) values (${user}, now() + interval '1 hour')
        on conflict (user_id) do update set blocked_until = excluded.blocked_until`;
      // The app builds the words from the kind.
      await tx`insert into public.account_notices (user_id, kind, grant_id, what) values (${user}, 'wrong_number', null, 'wrong_number')`;
    }
    if (!allow) return true;
    const [g] = await tx<{ id: string }[]>`
      insert into public.mcp_tokens (user_id, name, token_hash, can_write, kind, client_id, redirect_host)
      values (${user}, ${name}, ${"oauth:" + crypto.randomUUID()}, ${write}, 'oauth', ${r.client_id}, ${u.hostname})
      returning id`;
    await tx`update public.oauth_requests set grant_id = ${g.id}, code_hash = ${codeHash}, code_wrap = ${codeWrap},
      code_expires_at = now() + make_interval(secs => ${CODE_TTL}) where id = ${r.id}`;
    // Every device of the account says so, with Disconnect at hand: a connection nobody meant to
    // make shows on the devices that didn't approve it too.
    const what = `Connected ${name} from ${asked?.started_from ?? "this device"}`.slice(0, 200);
    await tx`insert into public.account_notices (user_id, kind, grant_id, what) values (${user}, 'ai_connected', ${g.id}, ${what})`;
    // The right number typed on a device: whoever is at the keyboard is the account's owner, so a
    // pause from an earlier wrong number ends.
    if (asked) await tx`delete from public.connect_blocks where user_id = ${user}`;
    return true;
  });
  if (answered === "reveal") return json({ error: "Finish on the page in your browser first." }, 409);
  if (!answered) return json({ error: EXPIRED }, 404);
  if (!allow) {
    u.searchParams.set("error", "access_denied");
    u.searchParams.set("error_description", "The person declined in Amber Notes.");
  }
  if (asked) {
    await sql`update public.connect_asks set answered_at = now(), denied = ${!allow}, redirect = ${u.toString()},
      answer = ${allow && handoff ? handoff : null}, delivered_at = ${fromPage ? new Date() : null} where request_id = ${r.id}`;
  }
  const handedOff = asked && !fromPage ? { handoff: true } : {};
  if (!allow) return json({ redirect: u.toString(), ...handedOff });
  return json({ redirect: u.toString(), client_name: name, can_write: write, ...handedOff });
}

/// "Use another account": the account that opened the request lets go of it, unanswered.
async function release(req: Request, sql: Sql): Promise<Response> {
  if (!allowedOrigin(req)) return json({ error: "Not allowed from this site." }, 403);
  const user = await sessionUser(req);
  if (!user) return json({ error: "Sign in to Amber Notes first." }, 401);
  if (await limited(sql, req, "request")) return json({ error: "Too many attempts. Wait a few minutes and try again." }, 429);
  const body = await req.json().catch(() => ({})) as { id?: string };
  const id = String(body.id ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: EXPIRED }, 404);
  await sql`update public.oauth_requests set claimed_by = null where id = ${id} and claimed_by = ${user} and decided_at is null`;
  return json({ released: true });
}

// MARK: Tokens

/// A new access and refresh token for a grant, each holding the data key wrapped under itself.
async function issue(sql: Sql, grantId: string, resource: string, canWrite: boolean, dataKey: Uint8Array<ArrayBuffer>, userId: string) {
  const access = randomToken("amb_at_");
  const refresh = randomToken("amb_rt_");
  const accessWrap = await wrap(dataKey, await tokenKey(access, "access"), "access", userId);
  const refreshWrap = await wrap(dataKey, await tokenKey(refresh, "refresh"), "refresh", userId);
  await sql`insert into public.oauth_tokens (token_hash, grant_id, kind, resource, expires_at, dk_wrap) values
    (${await sha256Hex(access)}, ${grantId}, 'access', ${resource}, now() + make_interval(secs => ${ACCESS_TTL}), ${accessWrap}),
    (${await sha256Hex(refresh)}, ${grantId}, 'refresh', ${resource}, now() + make_interval(days => ${REFRESH_TTL_DAYS}), ${refreshWrap})`;
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
    refresh_token: refresh,
    scope: canWrite ? SCOPES.join(" ") : "notes:read",
  };
}

/// The data key from a wrap, or null when there's none or it doesn't open with this secret.
async function openWrap(wrapped: string | null, secret: string, purpose: "code" | "refresh", userId: string) {
  if (!wrapped) return null;
  try {
    return await unwrap(wrapped, await tokenKey(secret, purpose), purpose, userId);
  } catch {
    return null;
  }
}

async function revokeGrant(sql: Sql, grantId: string) {
  await sql`update public.mcp_tokens set revoked_at = coalesce(revoked_at, now()) where id = ${grantId}`;
  await sql`delete from public.oauth_tokens where grant_id = ${grantId}`;
}

async function token(req: Request, sql: Sql, base: string): Promise<Response> {
  if (await limited(sql, req, "token")) return oauthError("slow_down", "Too many requests. Try again shortly.", 429);
  const p = await formOrJson(req);
  if (p.resource && !isThisServer(p.resource, req)) return oauthError("invalid_target", `This server is ${base}.`);

  if (p.grant_type === "authorization_code") {
    if (!p.code || !p.code_verifier || !p.client_id) return oauthError("invalid_request", "code, code_verifier and client_id are required.");
    const hash = await sha256Hex(p.code);
    const [r] = await sql<{ id: string; client_id: string; redirect_uri: string; code_challenge: string; grant_id: string; expired: boolean; resource: string; can_write: boolean; revoked: boolean; user_id: string }[]>`
      select r.id, r.client_id, r.redirect_uri, r.code_challenge, r.grant_id, r.code_expires_at < now() as expired, r.resource,
             g.can_write, g.revoked_at is not null as revoked, g.user_id
      from public.oauth_requests r join public.mcp_tokens g on g.id = r.grant_id
      where r.code_hash = ${hash}`;
    if (!r) return oauthError("invalid_grant", "Unknown code.");
    // Checked before the code counts as used, so someone holding a stolen code without its
    // verifier can neither spend it nor get the real client's connection revoked.
    if (r.client_id !== p.client_id) return oauthError("invalid_grant", "The code was issued to another app.");
    if (p.redirect_uri && p.redirect_uri !== r.redirect_uri) return oauthError("invalid_grant", "redirect_uri doesn't match the authorization request.");
    if ((await s256(p.code_verifier)) !== r.code_challenge) return oauthError("invalid_grant", "PKCE verification failed.");
    // Exactly one exchange wins, even when two arrive at once, and it takes the wrap with it.
    const [claimed] = await sql<{ code_wrap: string | null }[]>`
      with old as (select id, code_wrap from public.oauth_requests where id = ${r.id} and code_used_at is null for update)
      update public.oauth_requests q set code_used_at = now(), code_wrap = null from old where q.id = old.id
      returning old.code_wrap`;
    if (!claimed) {
      // A code presented twice may have been stolen: cut off everything it produced.
      await revokeGrant(sql, r.grant_id);
      return oauthError("invalid_grant", "This code was already used.");
    }
    if (r.expired || r.revoked) return oauthError("invalid_grant", "The code has expired. Connect again.");
    const dataKey = await openWrap(claimed.code_wrap, p.code, "code", r.user_id);
    if (!dataKey) return oauthError("invalid_grant", "Connect again.");
    try {
      return json(await issue(sql, r.grant_id, r.resource, r.can_write, dataKey, r.user_id));
    } finally {
      dataKey.fill(0);
    }
  }

  if (p.grant_type === "refresh_token") {
    if (!p.refresh_token) return oauthError("invalid_request", "refresh_token is required.");
    const hash = await sha256Hex(p.refresh_token);
    const [t] = await sql<{ grant_id: string; used_at: Date | null; expired: boolean; resource: string; client_id: string; can_write: boolean; revoked: boolean; user_id: string }[]>`
      select t.grant_id, t.used_at, t.expires_at < now() as expired, t.resource, g.client_id, g.can_write, g.revoked_at is not null as revoked, g.user_id
      from public.oauth_tokens t join public.mcp_tokens g on g.id = t.grant_id
      where t.token_hash = ${hash} and t.kind = 'refresh'`;
    if (!t || t.revoked) return oauthError("invalid_grant", "This connection was removed. Connect again.");
    if (p.client_id && p.client_id !== t.client_id) return oauthError("invalid_grant", "The token belongs to another app.");
    if (t.used_at) {
      // Rotation: an old refresh token coming back means two parties hold it. Revoke all.
      await revokeGrant(sql, t.grant_id);
      return oauthError("invalid_grant", "This refresh token was already used. Connect again.");
    }
    if (t.expired) return oauthError("invalid_grant", "The connection expired. Connect again.");
    // Used once: the old token's wrap goes in the same statement that spends it.
    const [claimed] = await sql<{ dk_wrap: string | null }[]>`
      with old as (select token_hash, dk_wrap from public.oauth_tokens where token_hash = ${hash} and used_at is null for update)
      update public.oauth_tokens t set used_at = now(), dk_wrap = null from old where t.token_hash = old.token_hash
      returning old.dk_wrap`;
    if (!claimed) return oauthError("invalid_grant", "This refresh token was already used.");
    const dataKey = await openWrap(claimed.dk_wrap, p.refresh_token, "refresh", t.user_id);
    if (!dataKey) return oauthError("invalid_grant", "Connect again.");
    try {
      return json(await issue(sql, t.grant_id, t.resource, t.can_write, dataKey, t.user_id));
    } finally {
      dataKey.fill(0);
    }
  }

  return oauthError("unsupported_grant_type", "Use authorization_code or refresh_token.");
}

/// RFC 7009: revoking either token ends the whole connection; unknown tokens are fine.
async function revoke(req: Request, sql: Sql): Promise<Response> {
  const p = await formOrJson(req);
  if (p.token) {
    const [t] = await sql<{ grant_id: string }[]>`select grant_id from public.oauth_tokens where token_hash = ${await sha256Hex(p.token)}`;
    if (t) await revokeGrant(sql, t.grant_id);
  }
  return new Response(null, { status: 200, headers: cors });
}

/// Resolves an OAuth access token presented to the MCP endpoint.
/// A token issued through any of the server's addresses works at all of them.
export async function resolveAccessToken(sql: Sql, token: string, req: Request): Promise<Grant | undefined> {
  const [g] = await sql<Grant[]>`select * from public.resolve_oauth_token(${token})`;
  if (!g || !g.resource || !isThisServer(g.resource, req)) return undefined;
  return g;
}
