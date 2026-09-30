// End-to-end: a connector signing in with OAuth, the way ChatGPT and Claude do, against a
// running LOCAL stack. The consent step is driven like the app does it, with a user session.
//
// Run:
//   PANE_MCP_URL=http://127.0.0.1:<port>/functions/v1/mcp SUPABASE_URL=http://127.0.0.1:<port> \
//   SUPABASE_ANON_KEY=… SUPABASE_SERVICE_KEY=… PANE_DB_URL=postgresql://… \
//   deno test -A supabase/functions/mcp/oauth.e2e.test.ts
import { assert, assertEquals, assertMatch, assertStringIncludes } from "jsr:@std/assert@1";
import postgres from "npm:postgres@3.4.5";

// Or point PANE_ENV_FILE at the output of `supabase status -o env`.
const file: Record<string, string> = {};
const envFile = Deno.env.get("PANE_ENV_FILE");
if (envFile) {
  for (const line of Deno.readTextFileSync(envFile).split("\n")) {
    const m = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (m) file[m[1]] = m[2];
  }
}
const supa = Deno.env.get("SUPABASE_URL") ?? file.API_URL;
const base = Deno.env.get("PANE_MCP_URL") ?? (supa && `${supa}/functions/v1/mcp`);
const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? file.ANON_KEY;
const service = Deno.env.get("SUPABASE_SERVICE_KEY") ?? file.SERVICE_ROLE_KEY;
const dbURL = Deno.env.get("PANE_DB_URL") ?? file.DB_URL;
const enabled = Boolean(base && supa && anon && service && dbURL);
const opts = { ignore: !enabled, sanitizeOps: false, sanitizeResources: false };

const CHATGPT = "https://chatgpt.com/connector_platform_oauth_redirect";

// MARK: Helpers

let session: { jwt: string; userId: string } | undefined;

/// A signed-in Amber Notes user, created once for the run (allowlisted first).
async function user() {
  if (session) return session;
  const sql = postgres(dbURL, { max: 1 });
  const email = `oauth-${crypto.randomUUID().slice(0, 8)}@example.com`;
  const password = "correct horse battery staple";
  await sql`insert into public.signup_allowlist (email) values (${email}) on conflict do nothing`;
  await sql.end();
  const created = await fetch(`${supa}/auth/v1/admin/users`, {
    method: "POST",
    headers: { apikey: service, authorization: `Bearer ${service}`, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  assert(created.ok, `create user: ${created.status} ${await created.text()}`);
  const signIn = await fetch(`${supa}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const s = await signIn.json();
  assert(s.access_token, JSON.stringify(s));
  session = { jwt: s.access_token, userId: s.user.id };
  return session;
}

function b64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

async function register(redirects = [CHATGPT], name = "ChatGPT") {
  const res = await fetch(`${base}/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: name, redirect_uris: redirects, grant_types: ["authorization_code", "refresh_token"], token_endpoint_auth_method: "none" }),
  });
  assertEquals(res.status, 201);
  return (await res.json()).client_id as string;
}

function authorizeURL(p: Record<string, string>) {
  const u = new URL(`${base}/authorize`);
  for (const [k, v] of Object.entries(p)) u.searchParams.set(k, v);
  return u.toString();
}

async function startAuthorize(clientId: string, challenge: string, extra: Record<string, string> = {}) {
  const res = await fetch(authorizeURL({
    response_type: "code", client_id: clientId, redirect_uri: CHATGPT, code_challenge: challenge,
    code_challenge_method: "S256", state: "xyz", scope: "notes:read notes:write", resource: base, ...extra,
  }), { redirect: "manual" });
  await res.body?.cancel();
  return res;
}

async function decide(requestId: string, allow: boolean, write = true) {
  const { jwt } = await user();
  const res = await fetch(`${base}/connect/decide`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ id: requestId, allow, write }),
  });
  assertEquals(res.status, 200);
  return new URL((await res.json()).redirect);
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(`${base}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
  return { status: res.status, body: await res.json() };
}

/// The whole dance: register, authorize, consent in the app, exchange the code.
async function connect(write = true) {
  const clientId = await register();
  const { verifier, challenge } = await pkce();
  const res = await startAuthorize(clientId, challenge);
  const requestId = new URL(res.headers.get("location")!).searchParams.get("request")!;
  const back = await decide(requestId, true, write);
  const code = back.searchParams.get("code")!;
  const { status, body } = await tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: CHATGPT, resource: base });
  assertEquals(status, 200, JSON.stringify(body));
  return { clientId, ...body } as { clientId: string; access_token: string; refresh_token: string; scope: string };
}

async function rpc(token: string | null, method: string, params: unknown = {}) {
  const res = await fetch(base, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return { status: res.status, headers: res.headers, body: await res.json() };
}

const toolNames = async (token: string) => (await rpc(token, "tools/list")).body.result.tools.map((t: { name: string }) => t.name) as string[];

// MARK: Discovery

Deno.test({ name: "an unauthenticated request points at the resource metadata", ...opts }, async () => {
  const { status, headers } = await rpc(null, "tools/list");
  assertEquals(status, 401);
  const challenge = headers.get("www-authenticate")!;
  assertStringIncludes(challenge, `resource_metadata="${base}/.well-known/oauth-protected-resource"`);
  assertStringIncludes(challenge, 'scope="notes:read notes:write"');

  const prm = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
  assertEquals(prm.resource, base);
  assertEquals(prm.authorization_servers, [base]);

  // Both path-appended forms an MCP client may try for an issuer with a path.
  for (const doc of ["oauth-authorization-server", "openid-configuration"]) {
    const as = await (await fetch(`${base}/.well-known/${doc}`)).json();
    assertEquals(as.issuer, base);
    assertEquals(as.code_challenge_methods_supported, ["S256"]);
    assertEquals(as.token_endpoint_auth_methods_supported, ["none"]);
    assertEquals(as.registration_endpoint, `${base}/register`);
  }
  // GET on the endpoint without a token is also a 401 (Claude starts sign-in from it).
  const get = await fetch(base);
  await get.body?.cancel();
  assertEquals(get.status, 401);
});

// MARK: Registration

Deno.test({ name: "registration accepts https and loopback, refuses the rest", ...opts }, async () => {
  const bad = await fetch(`${base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["http://evil.example.com/cb"] }) });
  assertEquals(bad.status, 400);
  assertEquals((await bad.json()).error, "invalid_redirect_uri");
  const scheme = await fetch(`${base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: ["javascript:alert(1)"] }) });
  assertEquals(scheme.status, 400);
  await scheme.body?.cancel();
  const id = await register(["http://127.0.0.1/callback", "https://claude.ai/api/mcp/auth_callback"], "Claude");
  assertMatch(id, /^amb_client_/);
});

// MARK: Authorization and consent

Deno.test({ name: "the full flow: consent in the app, tokens, tools, refresh with rotation", ...opts }, async () => {
  const clientId = await register();
  const { verifier, challenge } = await pkce();
  const res = await startAuthorize(clientId, challenge);
  assertEquals(res.status, 302);
  // The browser goes to the site's consent page, which offers the app or signing in there.
  const loc = new URL(res.headers.get("location")!);
  assertEquals(loc.pathname, "/connect");
  const requestId = loc.searchParams.get("request")!;

  // The app reads the request (only with a session) to show the consent sheet.
  const anonymous = await fetch(`${base}/connect/request?id=${requestId}`);
  assertEquals(anonymous.status, 401);
  await anonymous.body?.cancel();
  const { jwt } = await user();
  const details = await (await fetch(`${base}/connect/request?id=${requestId}`, { headers: { authorization: `Bearer ${jwt}` } })).json();
  assertEquals(details.client_name, "ChatGPT");
  assertEquals(details.redirect_host, "chatgpt.com");
  assertEquals(details.wants_write, true);

  const back = await decide(requestId, true, true);
  assertEquals(back.origin + back.pathname, CHATGPT);
  assertEquals(back.searchParams.get("state"), "xyz");
  assertEquals(back.searchParams.get("iss"), base);
  const code = back.searchParams.get("code")!;

  // The wrong verifier fails; so does a second decision on the same request.
  const again = await fetch(`${base}/connect/decide`, { method: "POST", headers: { authorization: `Bearer ${jwt}`, "content-type": "application/json" }, body: JSON.stringify({ id: requestId, allow: true }) });
  assertEquals(again.status, 404);
  await again.body?.cancel();

  const tokens = await tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: CHATGPT, resource: base });
  assertEquals(tokens.status, 200, JSON.stringify(tokens.body));
  assertMatch(tokens.body.access_token, /^amb_at_[0-9a-f]{64}$/);
  assertEquals(tokens.body.token_type, "Bearer");
  assertEquals(tokens.body.scope, "notes:read notes:write");

  const names = await toolNames(tokens.body.access_token);
  assert(names.includes("create_note") && names.includes("search_notes"));
  const made = await rpc(tokens.body.access_token, "tools/call", { name: "create_note", arguments: { body: "OAuth note\n\nWritten by a connector." } });
  assert(!made.body.result.isError, made.body.result.content[0].text);

  // Refresh rotates; the old refresh token then revokes everything if replayed.
  const r1 = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.body.refresh_token, client_id: clientId });
  assertEquals(r1.status, 200);
  assert(r1.body.refresh_token !== tokens.body.refresh_token);
  assertEquals((await rpc(r1.body.access_token, "tools/list")).status, 200);
  const replay = await tokenRequest({ grant_type: "refresh_token", refresh_token: tokens.body.refresh_token, client_id: clientId });
  assertEquals(replay.status, 400);
  assertEquals(replay.body.error, "invalid_grant");
  assertEquals((await rpc(r1.body.access_token, "tools/list")).status, 401);
});

Deno.test({ name: "a code works once; replaying it cuts the connection off", ...opts }, async () => {
  const clientId = await register();
  const { verifier, challenge } = await pkce();
  const res = await startAuthorize(clientId, challenge);
  const back = await decide(new URL(res.headers.get("location")!).searchParams.get("request")!, true);
  const code = back.searchParams.get("code")!;
  const first = await tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId });
  assertEquals(first.status, 200);
  const second = await tokenRequest({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId });
  assertEquals(second.body.error, "invalid_grant");
  assertEquals((await rpc(first.body.access_token, "tools/list")).status, 401);
});

Deno.test({ name: "PKCE, client and redirect are all checked at the token endpoint", ...opts }, async () => {
  const clientId = await register();
  const { challenge } = await pkce();
  const res = await startAuthorize(clientId, challenge);
  const code = (await decide(new URL(res.headers.get("location")!).searchParams.get("request")!, true)).searchParams.get("code")!;
  const wrong = await tokenRequest({ grant_type: "authorization_code", code, code_verifier: "x".repeat(50), client_id: clientId });
  assertEquals(wrong.body.error, "invalid_grant");

  const other = await register();
  const p2 = await pkce();
  const res2 = await startAuthorize(clientId, p2.challenge);
  const code2 = (await decide(new URL(res2.headers.get("location")!).searchParams.get("request")!, true)).searchParams.get("code")!;
  const stolen = await tokenRequest({ grant_type: "authorization_code", code: code2, code_verifier: p2.verifier, client_id: other });
  assertEquals(stolen.body.error, "invalid_grant");

  const p3 = await pkce();
  const res3 = await startAuthorize(clientId, p3.challenge);
  const code3 = (await decide(new URL(res3.headers.get("location")!).searchParams.get("request")!, true)).searchParams.get("code")!;
  const sql = postgres(dbURL, { max: 1 });
  await sql`update public.oauth_requests set code_expires_at = now() - interval '1 second' where code_hash = encode(extensions.digest(${code3}, 'sha256'), 'hex')`;
  await sql.end();
  const late = await tokenRequest({ grant_type: "authorization_code", code: code3, code_verifier: p3.verifier, client_id: clientId });
  assertEquals(late.body.error, "invalid_grant");
});

Deno.test({ name: "authorize refuses bad requests without redirecting to unknown places", ...opts }, async () => {
  const clientId = await register();
  const { challenge } = await pkce();
  // Every refusal ends on Amber Notes' own consent page, never at the client's address.
  const problem = (res: Response) => {
    assertEquals(res.status, 302);
    const to = new URL(res.headers.get("location")!);
    assertEquals(to.pathname, "/connect");
    return to.searchParams.get("problem");
  };
  assertEquals(problem(await startAuthorize("amb_client_nope", challenge)), "unknown_app");
  assertEquals(problem(await startAuthorize(clientId, challenge, { redirect_uri: "https://evil.example.com/cb" })), "wrong_return");
  assertEquals(problem(await startAuthorize(clientId, challenge, { code_challenge_method: "plain" })), "pkce");
  assertEquals(problem(await startAuthorize(clientId, challenge, { resource: "https://example.com/mcp" })), "wrong_server");
});

Deno.test({ name: "loopback redirects match on any port", ...opts }, async () => {
  const clientId = await register(["http://127.0.0.1/callback"], "Claude Code");
  const { challenge } = await pkce();
  const res = await startAuthorize(clientId, challenge, { redirect_uri: "http://127.0.0.1:43117/callback" });
  assertEquals(res.status, 302);
  assertEquals(new URL(res.headers.get("location")!).pathname, "/connect");
  const { jwt } = await user();
  const details = await (await fetch(`${base}/connect/request?id=${new URL(res.headers.get("location")!).searchParams.get("request")}`, { headers: { authorization: `Bearer ${jwt}` } })).json();
  assertEquals(details.loopback, true);
});

Deno.test({ name: "denying sends the app back with access_denied", ...opts }, async () => {
  const clientId = await register();
  const { challenge } = await pkce();
  const res = await startAuthorize(clientId, challenge);
  const back = await decide(new URL(res.headers.get("location")!).searchParams.get("request")!, false);
  assertEquals(back.searchParams.get("error"), "access_denied");
  assertEquals(back.searchParams.get("state"), "xyz");
  assertEquals(back.searchParams.get("code"), null);
});

// MARK: Access levels and revoking

Deno.test({ name: "read-only connections see no editing tools", ...opts }, async () => {
  const t = await connect(false);
  assertEquals(t.scope, "notes:read");
  const names = await toolNames(t.access_token);
  assert(names.includes("search_notes"));
  assert(!names.includes("create_note") && !names.includes("edit_note"));
  const blocked = await rpc(t.access_token, "tools/call", { name: "create_note", arguments: { body: "Nope" } });
  assert(blocked.body.result?.isError || blocked.body.error, "writing must fail");
});

Deno.test({ name: "revoking from the app or the revoke endpoint ends access at once", ...opts }, async () => {
  const a = await connect();
  const { jwt } = await user();
  // The app lists grants like tokens and revokes by setting revoked_at, as the person.
  const list = await (await fetch(`${supa}/rest/v1/mcp_tokens?select=id,name,kind,can_write,redirect_host&kind=eq.oauth&revoked_at=is.null`, { headers: { apikey: anon, authorization: `Bearer ${jwt}` } })).json();
  assert(list.length >= 1);
  assertEquals(list[0].redirect_host, "chatgpt.com");
  const sql = postgres(dbURL, { max: 1 });
  const [grant] = await sql`select g.id from public.mcp_tokens g join public.oauth_tokens t on t.grant_id = g.id where t.token_hash = encode(extensions.digest(${a.access_token}, 'sha256'), 'hex')`;
  await sql.end();
  const patch = await fetch(`${supa}/rest/v1/mcp_tokens?id=eq.${grant.id}`, {
    method: "PATCH", headers: { apikey: anon, authorization: `Bearer ${jwt}`, "content-type": "application/json" },
    body: JSON.stringify({ revoked_at: new Date().toISOString() }),
  });
  assert(patch.ok, await patch.text());
  assertEquals((await rpc(a.access_token, "tools/list")).status, 401);
  const refresh = await tokenRequest({ grant_type: "refresh_token", refresh_token: a.refresh_token, client_id: a.clientId });
  assertEquals(refresh.body.error, "invalid_grant");

  const b = await connect();
  const r = await fetch(`${base}/revoke`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: b.refresh_token }) });
  assertEquals(r.status, 200);
  await r.body?.cancel();
  assertEquals((await rpc(b.access_token, "tools/list")).status, 401);
});

Deno.test({ name: "oauth tables are invisible to signed-in users", ...opts }, async () => {
  const { jwt } = await user();
  for (const table of ["oauth_clients", "oauth_requests", "oauth_tokens", "oauth_rate"]) {
    const res = await fetch(`${supa}/rest/v1/${table}?select=*`, { headers: { apikey: anon, authorization: `Bearer ${jwt}` } });
    assert(res.status === 401 || res.status === 403 || res.status === 404, `${table}: ${res.status}`);
    await res.body?.cancel();
  }
});

// MARK: Older tokens

Deno.test({ name: "an older token in the URL still works but is flagged; in a header it isn't", ...opts }, async () => {
  const { jwt } = await user();
  const make = async (name: string) => {
    const res = await fetch(`${supa}/rest/v1/rpc/create_mcp_token`, {
      method: "POST", headers: { apikey: anon, authorization: `Bearer ${jwt}`, "content-type": "application/json" },
      body: JSON.stringify({ token_name: name, write_access: false }),
    });
    return await res.json() as string;
  };
  const inURL = await make("URL token");
  const inHeader = await make("Header token");
  const viaURL = await fetch(`${base}/${inURL}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assertEquals(viaURL.status, 200);
  await viaURL.body?.cancel();
  assertEquals((await rpc(inHeader, "tools/list")).status, 200);
  const rows = await (await fetch(`${supa}/rest/v1/mcp_tokens?select=name,url_used_at&kind=eq.token`, { headers: { apikey: anon, authorization: `Bearer ${jwt}` } })).json();
  const byName = Object.fromEntries(rows.map((r: { name: string; url_used_at: string | null }) => [r.name, r.url_used_at]));
  assert(byName["URL token"], "URL use is recorded");
  assertEquals(byName["Header token"], null);
});
