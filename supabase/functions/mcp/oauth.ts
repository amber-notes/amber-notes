// OAuth 2.1 for AI connectors, served by the MCP function itself.
//
// Why here and not Supabase Auth's OAuth server: that one is in beta and currently fails
// for MCP connectors (public clients, `resource`, `offline_access`), and its tokens would be
// full database sessions. These tokens only ever open this MCP server.
//
// Discovery: Supabase can't serve anything at the host's /.well-known/, so the 401 carries
// `resource_metadata` pointing inside this function, and the authorization server metadata is
// served at the issuer + /.well-known/… (the path-appended form MCP clients try).
//
// Consent without a web page: /authorize redirects to ambernotes://connect?request=<id>.
// The signed-in app shows who is asking, the person picks read-only or read & edit, and the
// app posts the decision here with their session; the answer is the client's redirect URL.

import type { Sql } from "npm:postgres@3.4.5";

export const SCOPES = ["notes:read", "notes:write"];
const ACCESS_TTL = 60 * 60; // seconds
const REFRESH_TTL_DAYS = 90;
const CODE_TTL = 60; // seconds
const LIMITS: Record<string, [number, number]> = { register: [30, 3600], authorize: [60, 600], token: [120, 600], decide: [60, 600] };

export type Grant = { user_id: string; token_id: string; name: string; can_write: boolean; resource?: string };

/// Where the function is reachable from outside, e.g. https://<ref>.supabase.co/functions/v1/mcp.
export function publicBase(req: Request): string {
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
  return p.startsWith("/.well-known/") || ["/register", "/authorize", "/token", "/revoke", "/connect/request", "/connect/decide"].includes(p);
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

function clientIP(req: Request) {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
}

/// True when this IP has made too many requests to `bucket` recently. Records this one.
async function limited(sql: Sql, req: Request, bucket: string): Promise<boolean> {
  const [max, window] = LIMITS[bucket];
  const ip = await sha256Hex(clientIP(req));
  const [{ n }] = await sql`
    with recent as (select count(*)::int n from public.oauth_rate where bucket = ${bucket} and ip_hash = ${ip} and at > now() - make_interval(secs => ${window}))
    insert into public.oauth_rate (bucket, ip_hash) select ${bucket}, ${ip} returning (select n from recent)`;
  if (Math.random() < 0.02) {
    await sql`delete from public.oauth_rate where at < now() - interval '1 day'`;
    await sql`delete from public.oauth_requests where expires_at < now() - interval '1 day' and (code_expires_at is null or code_expires_at < now() - interval '1 day')`;
    await sql`delete from public.oauth_tokens where expires_at < now() - interval '1 day'`;
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
      case "/connect/decide": return req.method === "POST" ? await decide(req, sql, base) : json({ error: "method_not_allowed" }, 405);
    }
  } catch (e) {
    console.error("oauth", path, e);
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
  const name = String(body.client_name ?? "").trim().slice(0, 100) || new URL(uris[0]).hostname;
  const id = randomToken("amb_client_").slice(0, 43);
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
  if (await limited(sql, req, "authorize")) return text("Too many attempts. Wait a few minutes and try again.", 429);
  const [client] = await sql<{ id: string; redirect_uris: string[] }[]>`select id, redirect_uris from public.oauth_clients where id = ${q.client_id ?? ""}`;
  // Until the redirect URI is known to be the client's own, errors must not redirect anywhere.
  if (!client) return text("Amber Notes doesn't know this app. Remove the connector and add it again.", 400);
  const redirect = q.redirect_uri ?? (client.redirect_uris.length === 1 ? client.redirect_uris[0] : "");
  if (!redirect || !redirectMatches(client.redirect_uris, redirect)) return text("The app's return address doesn't match what it registered.", 400);

  const back = (params: Record<string, string>) => {
    const u = new URL(redirect);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    if (q.state) u.searchParams.set("state", q.state);
    u.searchParams.set("iss", base);
    return Response.redirect(u.toString(), 302);
  };
  if (q.response_type !== "code") return back({ error: "unsupported_response_type", error_description: "Use response_type=code." });
  if (!q.code_challenge || q.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(q.code_challenge)) {
    return back({ error: "invalid_request", error_description: "PKCE with S256 is required." });
  }
  if (q.resource && !sameResource(q.resource, base)) return back({ error: "invalid_target", error_description: `This server is ${base}.` });

  const [row] = await sql<{ id: string }[]>`
    insert into public.oauth_requests (client_id, redirect_uri, state, code_challenge, scope, resource)
    values (${client.id}, ${redirect}, ${q.state ?? null}, ${q.code_challenge}, ${q.scope ?? null}, ${base})
    returning id`;
  // Hand over to the app, which is signed in and shows the consent sheet.
  return new Response(null, { status: 302, headers: { location: `ambernotes://connect?request=${row.id}`, "cache-control": "no-store" } });
}

const text = (s: string, status: number) => new Response(s, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

/// The signed-in person, from their Supabase session (the app sends it).
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

type RequestRow = { id: string; client_id: string; client_name: string; redirect_uri: string; state: string | null; scope: string | null; expires_at: Date; decided_at: Date | null };

async function pending(sql: Sql, id: string): Promise<RequestRow | undefined> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return undefined;
  const [r] = await sql<RequestRow[]>`
    select r.id, r.client_id, c.client_name, r.redirect_uri, r.state, r.scope, r.expires_at, r.decided_at
    from public.oauth_requests r join public.oauth_clients c on c.id = r.client_id
    where r.id = ${id} and r.decided_at is null and r.expires_at > now()`;
  return r;
}

/// What the app shows on the consent sheet.
async function describeRequest(req: Request, sql: Sql): Promise<Response> {
  if (!(await sessionUser(req))) return json({ error: "Sign in to Amber Notes first." }, 401);
  const r = await pending(sql, new URL(req.url).searchParams.get("id") ?? "");
  if (!r) return json({ error: "This request has expired. Start connecting again from the other app." }, 404);
  const host = new URL(r.redirect_uri).hostname;
  const scopes = (r.scope ?? "").split(/\s+/).filter(Boolean);
  return json({
    id: r.id,
    client_name: r.client_name,
    redirect_host: host,
    loopback: LOOPBACK.has(host),
    // No scope means "whatever you allow"; asking only for read keeps it read-only.
    wants_write: scopes.length === 0 || scopes.includes("notes:write"),
    expires_at: r.expires_at,
  });
}

/// Allow or deny. Allow creates the grant and a one-minute, single-use code.
async function decide(req: Request, sql: Sql, base: string): Promise<Response> {
  const user = await sessionUser(req);
  if (!user) return json({ error: "Sign in to Amber Notes first." }, 401);
  if (await limited(sql, req, "decide")) return json({ error: "Too many attempts." }, 429);
  const body = await req.json().catch(() => ({})) as { id?: string; allow?: boolean; write?: boolean };
  const r = await pending(sql, String(body.id ?? ""));
  if (!r) return json({ error: "This request has expired. Start connecting again from the other app." }, 404);

  const u = new URL(r.redirect_uri);
  if (r.state) u.searchParams.set("state", r.state);
  u.searchParams.set("iss", base);
  if (body.allow !== true) {
    await sql`update public.oauth_requests set decided_at = now() where id = ${r.id}`;
    u.searchParams.set("error", "access_denied");
    u.searchParams.set("error_description", "The person declined in Amber Notes.");
    return json({ redirect: u.toString() });
  }
  const scopes = (r.scope ?? "").split(/\s+/).filter(Boolean);
  const write = body.write === true && (scopes.length === 0 || scopes.includes("notes:write"));
  const code = randomToken("amb_code_");
  await sql.begin(async (tx) => {
    const [g] = await tx<{ id: string }[]>`
      insert into public.mcp_tokens (user_id, name, token_hash, can_write, kind, client_id, redirect_host)
      values (${user}, ${r.client_name}, ${"oauth:" + crypto.randomUUID()}, ${write}, 'oauth', ${r.client_id}, ${u.hostname})
      returning id`;
    await tx`update public.oauth_requests set decided_at = now(), grant_id = ${g.id}, code_hash = ${await sha256Hex(code)},
      code_expires_at = now() + make_interval(secs => ${CODE_TTL}) where id = ${r.id}`;
  });
  u.searchParams.set("code", code);
  return json({ redirect: u.toString(), client_name: r.client_name, can_write: write });
}

// MARK: Tokens

async function issue(sql: Sql, grantId: string, resource: string, canWrite: boolean) {
  const access = randomToken("amb_at_");
  const refresh = randomToken("amb_rt_");
  await sql`insert into public.oauth_tokens (token_hash, grant_id, kind, resource, expires_at) values
    (${await sha256Hex(access)}, ${grantId}, 'access', ${resource}, now() + make_interval(secs => ${ACCESS_TTL})),
    (${await sha256Hex(refresh)}, ${grantId}, 'refresh', ${resource}, now() + make_interval(days => ${REFRESH_TTL_DAYS}))`;
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: ACCESS_TTL,
    refresh_token: refresh,
    scope: canWrite ? SCOPES.join(" ") : "notes:read",
  };
}

async function revokeGrant(sql: Sql, grantId: string) {
  await sql`update public.mcp_tokens set revoked_at = coalesce(revoked_at, now()) where id = ${grantId}`;
  await sql`delete from public.oauth_tokens where grant_id = ${grantId}`;
}

async function token(req: Request, sql: Sql, base: string): Promise<Response> {
  if (await limited(sql, req, "token")) return oauthError("slow_down", "Too many requests. Try again shortly.", 429);
  const p = await formOrJson(req);
  if (p.resource && !sameResource(p.resource, base)) return oauthError("invalid_target", `This server is ${base}.`);

  if (p.grant_type === "authorization_code") {
    if (!p.code || !p.code_verifier || !p.client_id) return oauthError("invalid_request", "code, code_verifier and client_id are required.");
    const hash = await sha256Hex(p.code);
    const [r] = await sql<{ id: string; client_id: string; redirect_uri: string; code_challenge: string; grant_id: string; code_used_at: Date | null; expired: boolean; resource: string; can_write: boolean; revoked: boolean }[]>`
      select r.id, r.client_id, r.redirect_uri, r.code_challenge, r.grant_id, r.code_used_at, r.code_expires_at < now() as expired, r.resource,
             g.can_write, g.revoked_at is not null as revoked
      from public.oauth_requests r join public.mcp_tokens g on g.id = r.grant_id
      where r.code_hash = ${hash}`;
    if (!r) return oauthError("invalid_grant", "Unknown code.");
    if (r.code_used_at) {
      // A code presented twice may have been stolen: cut off everything it produced.
      await revokeGrant(sql, r.grant_id);
      return oauthError("invalid_grant", "This code was already used.");
    }
    await sql`update public.oauth_requests set code_used_at = now() where id = ${r.id}`;
    if (r.expired || r.revoked) return oauthError("invalid_grant", "The code has expired. Connect again.");
    if (r.client_id !== p.client_id) return oauthError("invalid_grant", "The code was issued to another app.");
    if (p.redirect_uri && p.redirect_uri !== r.redirect_uri) return oauthError("invalid_grant", "redirect_uri doesn't match the authorization request.");
    if ((await s256(p.code_verifier)) !== r.code_challenge) return oauthError("invalid_grant", "PKCE verification failed.");
    return json(await issue(sql, r.grant_id, r.resource, r.can_write));
  }

  if (p.grant_type === "refresh_token") {
    if (!p.refresh_token) return oauthError("invalid_request", "refresh_token is required.");
    const hash = await sha256Hex(p.refresh_token);
    const [t] = await sql<{ grant_id: string; used_at: Date | null; expired: boolean; resource: string; client_id: string; can_write: boolean; revoked: boolean }[]>`
      select t.grant_id, t.used_at, t.expires_at < now() as expired, t.resource, g.client_id, g.can_write, g.revoked_at is not null as revoked
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
    const [claimed] = await sql`update public.oauth_tokens set used_at = now() where token_hash = ${hash} and used_at is null returning 1`;
    if (!claimed) return oauthError("invalid_grant", "This refresh token was already used.");
    return json(await issue(sql, t.grant_id, t.resource, t.can_write));
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
export async function resolveAccessToken(sql: Sql, token: string, base: string): Promise<Grant | undefined> {
  const [g] = await sql<Grant[]>`select * from public.resolve_oauth_token(${token})`;
  if (!g || !g.resource || !sameResource(g.resource, base)) return undefined;
  return g;
}
