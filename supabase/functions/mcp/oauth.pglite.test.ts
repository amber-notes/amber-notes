// OAuth for AI connectors (oauth.ts) on an in-process Postgres (PGlite), with Supabase Auth faked.
// Needs no Docker or local stack:
//   cd supabase/functions/mcp && deno test -A oauth.pglite.test.ts
// Covers the custom address (mcp.ambernotes.app through the site's proxy), the app's consent calls,
// who may answer a request, and the data key's wraps: the app makes the code and wraps the key
// under it, /token moves the key to the tokens, and the MCP endpoint opens it per request.
// oauth.e2e.test.ts runs the app's flow against the real stack.
import { assert, assertEquals, assertMatch, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import type { Sql } from "npm:postgres@3.4.5";
import { type Bytes, fromBase64, handoffPayload, hex as toHex, keyIdOf, matchCommit, matchNumber, newHandoffKeys, openHandoff, parseRecoveryKey, readHandoffPayload, recoveryKEK, recoveryKeyText, sealHandoff, tokenKey, toBase64, unwrap, verifierOf, wrap } from "../_shared/e2ee.ts";
import { newUser as plainUser, schemaDB, sqlFor } from "./pglite.ts";
import { account, app } from "./sealed.ts";

const SUPA = "https://proj.supabase.co";
const FUNCTION = `${SUPA}/functions/v1/mcp`;
const ALIAS = "https://mcp.ambernotes.app";
const SITE = "https://ambernotes.app";
const CHATGPT = "https://chatgpt.com/connector_platform_oauth_redirect";

Deno.env.set("SUPABASE_URL", SUPA);
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.delete("MCP_PUBLIC_URL");
Deno.env.delete("MCP_ALIAS_URLS");
Deno.env.delete("CONNECT_PAGE_URL");
Deno.env.set("MCP_PROXY_SECRET", "proxy-secret");

const { handleOAuth, setPushSender, publicBase, resolveAccessToken, subpath, clientIP, cleanName, claimsATrustedName, displayName, claimedName, sha256Hex } = await import("./oauth.ts");
const { handleRequest } = await import("./server.ts");

// MARK: Database: every migration, on PGlite

async function db() {
  const pg = await schemaDB();
  return { pg, sql: sqlFor(pg) };
}

// MARK: Fake Supabase Auth: a session is "Bearer jwt-<user id>".

const realFetch = globalThis.fetch;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  if (url === `${SUPA}/auth/v1/user`) {
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    const m = auth.match(/^Bearer jwt-([0-9a-f-]{36})$/);
    return Promise.resolve(m ? Response.json({ id: m[1] }) : Response.json({ msg: "invalid JWT" }, { status: 401 }));
  }
  return realFetch(input, init);
};

// MARK: Requests, as they reach the function

type Via = "function" | "proxy";

/// A request as the function sees it: straight to Supabase, or through the site's proxy, which
/// names the alias and passes the caller's address with the shared secret.
function request(via: Via, path: string, init: RequestInit & { ip?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", via === "proxy" ? "76.76.21.21" : (init.ip ?? "203.0.113.1"));
  if (via === "proxy") {
    headers.set("x-mcp-public-url", ALIAS);
    headers.set("x-mcp-client-ip", init.ip ?? "203.0.113.1");
    headers.set("x-mcp-proxy-secret", "proxy-secret");
  }
  return new Request(`${FUNCTION}${path}`, { ...init, headers });
}

async function call(sql: Sql, req: Request) {
  return await handleOAuth(req, sql, subpath(req));
}

function b64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pkce() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
  return { verifier, challenge };
}

type User = { id: string; jwt: string; dk: Bytes | null };

/** A user whose app has set up the account's key (null: signed in, but no key yet). */
async function newUser(pg: PGlite, withKey = true): Promise<User> {
  if (!withKey) {
    const id = await plainUser(pg);
    return { id, jwt: `jwt-${id}`, dk: null };
  }
  const a = await account(pg);
  return { id: a.id, jwt: `jwt-${a.id}`, dk: a.dk };
}

const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** What the app sends for Allow: it makes the code, and wraps the data key under it. */
async function appDecision(user: User, id: string, redirect_uri: string, allow = true, write = true) {
  const code = "amb_code_" + hex(32);
  const extra = allow && user.dk
    ? { code_hash: await sha256Hex(code), code_wrap: await wrap(user.dk, await tokenKey(code, "code"), "code", user.id) }
    : {};
  return { code, body: JSON.stringify({ id, allow, write, redirect_uri, ...extra }) };
}

/** The app opens the client's redirect with the code it made. */
function withCode(redirect: string, code: string) {
  const u = new URL(redirect);
  if (!u.searchParams.has("error")) u.searchParams.set("code", code);
  return u;
}

async function register(sql: Sql, via: Via, name = "ChatGPT", uris = [CHATGPT]) {
  const res = await call(sql, request(via, "/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: name, redirect_uris: uris }),
  }));
  assertEquals(res.status, 201);
  return (await res.json()).client_id as string;
}

async function authorize(sql: Sql, via: Via, clientId: string, challenge: string, resource = via === "proxy" ? ALIAS : FUNCTION) {
  const q = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: CHATGPT, code_challenge: challenge,
    code_challenge_method: "S256", state: "xyz", scope: "notes:read notes:write", resource,
  });
  return await call(sql, request(via, `/authorize?${q}`));
}

/// What the app does: ask who's asking, then answer with the exact return address it showed.
/// (A browser on the site's origin is let through too; any other origin isn't.)
async function consent(sql: Sql, requestId: string, user: User, allow = true, origin: string | null = SITE) {
  const headers: Record<string, string> = { authorization: `Bearer ${user.jwt}` };
  if (origin) headers.origin = origin;
  const described = await call(sql, request("function", `/connect/request?id=${requestId}`, { headers }));
  const shown = described.ok ? (await described.clone().json()).redirect_uri : CHATGPT;
  const { code, body } = await appDecision(user, requestId, shown, allow);
  const decided = await call(sql, request("function", "/connect/decide", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body,
  }));
  return { described, decided, code };
}

async function exchange(sql: Sql, via: Via, clientId: string, code: string, verifier: string, resource?: string) {
  const res = await call(sql, request(via, "/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, code, code_verifier: verifier, redirect_uri: CHATGPT, ...(resource ? { resource } : {}) }),
  }));
  return { status: res.status, body: await res.json() };
}

/// Register, authorize and consent on the web; returns the code and where the browser goes.
async function connect(sql: Sql, pg: PGlite, via: Via) {
  const clientId = await register(sql, via);
  const { verifier, challenge } = await pkce();
  const res = await authorize(sql, via, clientId, challenge);
  assertEquals(res.status, 302);
  const requestId = new URL(res.headers.get("location")!).searchParams.get("request")!;
  const me = await newUser(pg);
  const { described, decided, code } = await consent(sql, requestId, me);
  assertEquals(described.status, 200);
  assertEquals(decided.status, 200);
  const answer = await decided.json();
  // The server never makes or sees the code: the app adds it.
  assertEquals(new URL(answer.redirect).searchParams.get("code"), null);
  const back = withCode(answer.redirect, code);
  return { clientId, verifier, back, me, requestId };
}

// MARK: Tests

Deno.test("metadata through the proxy names mcp.ambernotes.app everywhere", async () => {
  const { sql } = await db();
  const as = await (await call(sql, request("proxy", "/.well-known/oauth-authorization-server"))).json();
  assertEquals(as.issuer, ALIAS);
  for (const k of ["authorization_endpoint", "token_endpoint", "registration_endpoint", "revocation_endpoint"]) {
    assert(String(as[k]).startsWith(`${ALIAS}/`), `${k}: ${as[k]}`);
  }
  const pr = await (await call(sql, request("proxy", "/.well-known/oauth-protected-resource"))).json();
  assertEquals(pr.resource, ALIAS);
  assertEquals(pr.authorization_servers, [ALIAS]);
  // RFC 9728's path-inserted form, which some clients try, answers the same.
  const inserted = await (await call(sql, request("proxy", "/.well-known/oauth-protected-resource/mcp"))).json();
  assertEquals(inserted.resource, ALIAS);
});

Deno.test("metadata at the Supabase address is unchanged, and a spoofed alias is ignored", async () => {
  const { sql } = await db();
  const plain = await (await call(sql, request("function", "/.well-known/oauth-authorization-server"))).json();
  assertEquals(plain.issuer, FUNCTION);
  assertEquals(plain.authorization_endpoint, `${FUNCTION}/authorize`);
  const spoofed = new Request(`${FUNCTION}/.well-known/oauth-protected-resource`, { headers: { "x-mcp-public-url": "https://evil.example" } });
  assertEquals((await (await call(sql, spoofed)).json()).resource, FUNCTION);
  // The alias counts only from the proxy, with its secret.
  assertEquals(publicBase(new Request(FUNCTION, { headers: { "x-mcp-public-url": ALIAS } })), FUNCTION);
  assertEquals(publicBase(new Request(FUNCTION, { headers: { "x-mcp-public-url": ALIAS, "x-mcp-proxy-secret": "guess" } })), FUNCTION);
  assertEquals(publicBase(new Request(FUNCTION, { headers: { "x-mcp-public-url": `${ALIAS}/`, "x-mcp-proxy-secret": "proxy-secret" } })), ALIAS);
});

Deno.test("/authorize sends the browser to the web consent page", async () => {
  const { sql } = await db();
  const clientId = await register(sql, "proxy");
  const res = await authorize(sql, "proxy", clientId, (await pkce()).challenge);
  assertEquals(res.status, 302);
  const to = new URL(res.headers.get("location")!);
  assertEquals(`${to.origin}${to.pathname}`, `${SITE}/connect`);
  assertMatch(to.searchParams.get("request")!, /^[0-9a-f-]{36}$/);
  // Nothing else rides along: no state, code, or token in the page's address.
  assertEquals([...to.searchParams.keys()], ["request"]);
});

Deno.test("a bad /authorize ends on our own page, never at the client's address", async () => {
  const { sql } = await db();
  const clientId = await register(sql, "proxy");
  const challenge = (await pkce()).challenge;
  const onOurPage = (res: Response) => {
    assertEquals(res.status, 302);
    const to = new URL(res.headers.get("location")!);
    assertEquals(`${to.origin}${to.pathname}`, `${SITE}/connect`);
    assertEquals([...to.searchParams.keys()], ["problem"]);
    return to.searchParams.get("problem");
  };
  assertEquals(onOurPage(await authorize(sql, "proxy", clientId, challenge, "https://evil.example/mcp")), "wrong_server");
  const q = (p: Record<string, string>) => call(sql, request("proxy", `/authorize?${new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: CHATGPT, code_challenge: challenge, code_challenge_method: "S256", state: "s", ...p })}`));
  assertEquals(onOurPage(await q({ response_type: "token" })), "unsupported");
  assertEquals(onOurPage(await q({ code_challenge_method: "plain" })), "pkce");
  assertEquals(onOurPage(await q({ redirect_uri: "https://evil.example/cb" })), "wrong_return");
  assertEquals(onOurPage(await q({ client_id: "amb_client_nope" })), "unknown_app");
});

Deno.test("full flow through mcp.ambernotes.app: iss, code, token, and the token works at both addresses", async () => {
  const { sql, pg } = await db();
  const { clientId, verifier, back, me } = await connect(sql, pg, "proxy");
  assertEquals(`${back.origin}${back.pathname}`, CHATGPT);
  assertEquals(back.searchParams.get("iss"), ALIAS);
  assertEquals(back.searchParams.get("state"), "xyz");
  const code = back.searchParams.get("code")!;
  assertMatch(code, /^amb_code_/);

  const t = await exchange(sql, "proxy", clientId, code, verifier, ALIAS);
  assertEquals(t.status, 200, JSON.stringify(t.body));
  const viaAlias = await resolveAccessToken(sql, t.body.access_token, request("proxy", ""));
  const viaFunction = await resolveAccessToken(sql, t.body.access_token, request("function", ""));
  assertEquals(viaAlias?.user_id, me.id);
  assertEquals(viaFunction?.user_id, me.id);
  assertEquals(viaAlias?.resource, ALIAS);
});

Deno.test("an existing connection made at the Supabase address keeps working, and works through the alias", async () => {
  const { sql, pg } = await db();
  const { clientId, verifier, back, me } = await connect(sql, pg, "function");
  assertEquals(back.searchParams.get("iss"), FUNCTION);
  const t = await exchange(sql, "function", clientId, back.searchParams.get("code")!, verifier, FUNCTION);
  assertEquals(t.status, 200);
  assertEquals((await resolveAccessToken(sql, t.body.access_token, request("function", "")))?.user_id, me.id);
  assertEquals((await resolveAccessToken(sql, t.body.access_token, request("proxy", "")))?.user_id, me.id);
});

Deno.test("a request belongs to the first account that opens it", async () => {
  const { sql, pg } = await db();
  const clientId = await register(sql, "proxy");
  const res = await authorize(sql, "proxy", clientId, (await pkce()).challenge);
  const requestId = new URL(res.headers.get("location")!).searchParams.get("request")!;
  const owner = await newUser(pg), other = await newUser(pg);
  const opened = await call(sql, request("function", `/connect/request?id=${requestId}`, { headers: { authorization: `Bearer ${owner.jwt}`, origin: SITE } }));
  assertEquals(opened.status, 200);
  assertEquals((await opened.json()).redirect_host, "chatgpt.com");
  const theirs = await consent(sql, requestId, other);
  assertEquals(theirs.described.status, 403);
  assertEquals(theirs.decided.status, 403);
  const mine = await consent(sql, requestId, owner);
  assertEquals(mine.decided.status, 200);
  // Answered once; a second answer finds nothing to answer.
  const again = await consent(sql, requestId, owner);
  assertEquals(again.decided.status, 404);
  const [{ n }] = await sql`select count(*)::int n from public.mcp_tokens where kind = 'oauth'` as { n: number }[];
  assertEquals(n, 1);
});

Deno.test("signed out, or from another site, the consent calls refuse", async () => {
  const { sql, pg } = await db();
  const clientId = await register(sql, "proxy");
  const res = await authorize(sql, "proxy", clientId, (await pkce()).challenge);
  const requestId = new URL(res.headers.get("location")!).searchParams.get("request")!;
  const anonymous = await call(sql, request("function", `/connect/request?id=${requestId}`, { headers: { origin: SITE } }));
  assertEquals(anonymous.status, 401);
  const me = await newUser(pg);
  const elsewhere = await consent(sql, requestId, me, true, "https://evil.example");
  assertEquals(elsewhere.described.status, 403);
  assertEquals(elsewhere.decided.status, 403);
  // The apps send no Origin at all.
  const app = await consent(sql, requestId, me, true, null);
  assertEquals(app.decided.status, 200);
});

Deno.test("Don't Allow sends access_denied back, with the alias as issuer", async () => {
  const { sql, pg } = await db();
  const clientId = await register(sql, "proxy");
  const res = await authorize(sql, "proxy", clientId, (await pkce()).challenge);
  const requestId = new URL(res.headers.get("location")!).searchParams.get("request")!;
  const me = await newUser(pg);
  const { decided } = await consent(sql, requestId, me, false);
  const back = new URL((await decided.json()).redirect);
  assertEquals(back.searchParams.get("error"), "access_denied");
  assertEquals(back.searchParams.get("iss"), ALIAS);
  assertEquals(back.searchParams.get("code"), null);
});

Deno.test("rate limits count the caller behind the proxy, and only with the proxy's secret", async () => {
  assertEquals(clientIP(request("proxy", "", { ip: "198.51.100.7" })), "198.51.100.7");
  const forged = new Request(FUNCTION, { headers: { "cf-connecting-ip": "203.0.113.9", "x-mcp-client-ip": "198.51.100.7", "x-mcp-proxy-secret": "guess" } });
  assertEquals(clientIP(forged), "203.0.113.9");

  const { sql } = await db();
  const clientId = await register(sql, "proxy");
  const challenge = (await pkce()).challenge;
  // One person behind the proxy runs out; someone else behind the same proxy doesn't.
  for (let i = 0; i < 60; i++) await (await authorize(sql, "proxy", clientId, challenge)).body?.cancel();
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: CHATGPT, code_challenge: challenge, code_challenge_method: "S256" });
  const limitedRes = await call(sql, request("proxy", `/authorize?${q}`));
  assertEquals(new URL(limitedRes.headers.get("location")!).searchParams.get("problem"), "too_many");
  const someoneElse = await call(sql, request("proxy", `/authorize?${q}`, { ip: "198.51.100.8" }));
  assert(new URL(someoneElse.headers.get("location")!).searchParams.get("request"));
});

// MARK: Who is asking

Deno.test("a name is cleaned: no control, format or direction characters, one line, short", () => {
  assertEquals(cleanName("Claude\u202Eevil\u200B\u0000\nApp"), "Claudeevil App");
  assertEquals(cleanName("  lots   of   space  "), "lots of space");
  assertEquals(cleanName("x".repeat(200)).length, 80);
});

Deno.test("trusted names are recognized through spacing, case, digits and look-alike letters", () => {
  for (const n of ["ChatGPT", "chat gpt", "Open AI", "CLAUDE", "Cl4ude", "Сlaude", "Anthropic Connector", "Amber Notes", "amber-notes sync", "ChаtGPT"]) {
    assert(claimsATrustedName(n), n);
  }
  for (const n of ["Notion", "Incredible", "My Script", "Cursor"]) assert(!claimsATrustedName(n), n);
  assertEquals(displayName("Claude", "https://claude.ai/api/mcp/auth_callback"), "Claude");
  assertEquals(displayName("Claude", "https://claude.ai/other"), "claude.ai");
  assertEquals(displayName("Claude Code", "http://127.0.0.1:4000/cb"), "An app on this computer");
  // Any unverified app is titled by its address, whatever it's called.
  assertEquals(displayName("Incredible", "https://incredible.one/cb"), "incredible.one");
});

async function ask(sql: Sql, pg: PGlite, name: string, uris: string[], redirect = uris[0]) {
  const clientId = await register(sql, "proxy", name, uris);
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirect, code_challenge: (await pkce()).challenge, code_challenge_method: "S256" });
  const res = await call(sql, request("proxy", `/authorize?${q}`));
  const requestId = new URL(res.headers.get("location")!).searchParams.get("request")!;
  const me = await newUser(pg);
  const described = await call(sql, request("function", `/connect/request?id=${requestId}`, { headers: { authorization: `Bearer ${me.jwt}`, origin: SITE } }));
  return { requestId, me, details: await described.json() };
}

Deno.test("a client calling itself Claude without Claude's callback is shown by its address", async () => {
  const { sql, pg } = await db();
  const fake = await ask(sql, pg, "Claude", ["https://evil.example/cb"]);
  assertEquals(fake.details.client_name, "evil.example");
  assertEquals(fake.details.verified_ai, null);
  assertEquals(fake.details.redirect_uri, "https://evil.example/cb");
  // Registering Claude's real callback too doesn't lend the name to a request going elsewhere.
  const mixed = await ask(sql, pg, "Claude", ["https://claude.ai/api/mcp/auth_callback", "https://evil.example/cb"], "https://evil.example/cb");
  assertEquals(mixed.details.client_name, "evil.example");
  assertEquals(mixed.details.verified_ai, null);
  // And the connection it would get is listed under that address too.
  const decided = await call(sql, request("function", "/connect/decide", {
    method: "POST", headers: { authorization: `Bearer ${mixed.me.jwt}`, origin: SITE, "content-type": "application/json" },
    body: (await appDecision(mixed.me, mixed.requestId, "https://evil.example/cb", true, false)).body,
  }));
  assertEquals((await decided.json()).client_name, "evil.example");
  const [{ name }] = await sql`select name from public.mcp_tokens where user_id = ${mixed.me.id}` as { name: string }[];
  assertEquals(name, "evil.example");
  // The real one keeps its name and mark.
  const real = await ask(sql, pg, "Claude", ["https://claude.ai/api/mcp/auth_callback"]);
  assertEquals(real.details.client_name, "Claude");
  assertEquals(real.details.verified_ai, "Claude");
  // A trusted name hidden with direction characters is caught too.
  const hidden = await ask(sql, pg, "Chat\u200BGPT\u202E", ["https://evil.example/cb"]);
  assertEquals(hidden.details.client_name, "evil.example");
});

// MARK: Code exchange

async function code(sql: Sql, pg: PGlite) {
  const clientId = await register(sql, "proxy");
  const { verifier, challenge } = await pkce();
  const res = await authorize(sql, "proxy", clientId, challenge);
  const requestId = new URL(res.headers.get("location")!).searchParams.get("request")!;
  const me = await newUser(pg);
  const { decided, code } = await consent(sql, requestId, me);
  assertEquals(decided.status, 200);
  return { clientId, verifier, code, me, requestId };
}

Deno.test("a stolen code without its verifier or client can't be spent, and doesn't cut off the real client", async () => {
  const { sql, pg } = await db();
  const c = await code(sql, pg);
  const other = await register(sql, "proxy");
  assertEquals((await exchange(sql, "proxy", c.clientId, c.code, "x".repeat(60))).body.error, "invalid_grant");
  assertEquals((await exchange(sql, "proxy", other, c.code, c.verifier)).body.error, "invalid_grant");
  const real = await exchange(sql, "proxy", c.clientId, c.code, c.verifier);
  assertEquals(real.status, 200);
  assertEquals((await resolveAccessToken(sql, real.body.access_token, request("proxy", "")))?.user_id, c.me.id);
});

Deno.test("two exchanges of one code at once: exactly one wins, and the connection is revoked", async () => {
  const { sql, pg } = await db();
  const c = await code(sql, pg);
  const both = await Promise.all([1, 2].map(() => exchange(sql, "proxy", c.clientId, c.code, c.verifier)));
  assertEquals(both.filter((r) => r.status === 200).length, 1);
  const won = both.find((r) => r.status === 200)!;
  assertEquals(await resolveAccessToken(sql, won.body.access_token, request("proxy", "")), undefined);
});

// MARK: Another account

Deno.test("Use another account: the first account lets go, and the second can answer", async () => {
  const { sql, pg } = await db();
  const clientId = await register(sql, "proxy");
  const res = await authorize(sql, "proxy", clientId, (await pkce()).challenge);
  const requestId = new URL(res.headers.get("location")!).searchParams.get("request")!;
  const first = await newUser(pg), second = await newUser(pg);
  const headers = (jwt: string) => ({ authorization: `Bearer ${jwt}`, origin: SITE, "content-type": "application/json" });
  assertEquals((await call(sql, request("function", `/connect/request?id=${requestId}`, { headers: headers(first.jwt) }))).status, 200);
  // Nobody else can let go of it for the first account.
  await call(sql, request("function", "/connect/release", { method: "POST", headers: headers(second.jwt), body: JSON.stringify({ id: requestId }) }));
  assertEquals((await call(sql, request("function", `/connect/request?id=${requestId}`, { headers: headers(second.jwt) }))).status, 403);
  const released = await call(sql, request("function", "/connect/release", { method: "POST", headers: headers(first.jwt), body: JSON.stringify({ id: requestId }) }));
  assertEquals(released.status, 200);
  const { decided } = await consent(sql, requestId, second);
  assertEquals(decided.status, 200);
  // Released from another site: refused.
  const elsewhere = await call(sql, request("function", "/connect/release", { method: "POST", headers: { ...headers(first.jwt), origin: "https://evil.example" }, body: JSON.stringify({ id: requestId }) }));
  assertEquals(elsewhere.status, 403);
});

// MARK: Security review probes (F1–F5). Each failed on the branch before the fixes.

const EVIL = "https://attacker.example/cb";
async function registerAs(sql: Sql, name: string, uris: string[]) {
  const res = await call(sql, request("proxy", "/register", { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ client_name: name, redirect_uris: uris }) }));
  return { status: res.status, body: await res.json() };
}

Deno.test("F1: DCR refuses a known AI's name for a client whose redirect isn't that AI's", async () => {
  const { sql } = await db();
  const r = await registerAs(sql, "ChatGPT", [EVIL]);
  assert(r.status === 400 || r.body.client_name !== "ChatGPT", `registered as ${JSON.stringify(r.body.client_name)}`);
});

Deno.test("F1b: client_name has no bidi or control characters", async () => {
  const { sql } = await db();
  const r = await registerAs(sql, "Claude‮​moc.elpmaxe", [EVIL]);
  assert(!/[\u0000-\u001f​-‏‪-‮⁦-⁩]/.test(String(r.body.client_name ?? "")), JSON.stringify(r.body));
  const plain = await registerAs(sql, "Notes‮​ Helper\u0007", [EVIL]);
  assertEquals(plain.body.client_name, "Notes Helper");
});

Deno.test("F2: /authorize is not an open redirector for a fresh client", async () => {
  const { sql } = await db();
  const { body } = await registerAs(sql, "x", [EVIL]);
  const q = new URLSearchParams({ response_type: "token", client_id: body.client_id, redirect_uri: EVIL });
  const loc = (await call(sql, request("proxy", `/authorize?${q}`))).headers.get("location") ?? "";
  assert(!loc.startsWith(EVIL), `302 -> ${loc}`);
});

Deno.test("F3: concurrent exchanges of one code yield one token set", async () => {
  const { sql, pg } = await db();
  const { clientId, verifier, back } = await connect(sql, pg, "proxy");
  const code = back.searchParams.get("code")!;
  const [a, b] = await Promise.all([exchange(sql, "proxy", clientId, code, verifier), exchange(sql, "proxy", clientId, code, verifier)]);
  assert(!(a.status === 200 && b.status === 200), "both concurrent exchanges returned tokens");
});

Deno.test("F3b: a wrong verifier doesn't burn the code or revoke the grant", async () => {
  const { sql, pg } = await db();
  const { clientId, verifier, back, me } = await connect(sql, pg, "proxy");
  const code = back.searchParams.get("code")!;
  assertEquals((await exchange(sql, "proxy", clientId, code, (await pkce()).verifier)).status, 400);
  const good = await exchange(sql, "proxy", clientId, code, verifier);
  assertEquals(good.status, 200);
  assertEquals((await resolveAccessToken(sql, good.body.access_token, request("proxy", "")))?.user_id, me.id);
});

Deno.test("F4: an attacker client named Claude is shown by its address, unverified", async () => {
  const { sql, pg } = await db();
  const { body } = await registerAs(sql, "Claude", [EVIL]);
  assert(body.client_name !== "Claude", `registered as ${body.client_name}`);
  const { challenge } = await pkce();
  const q = new URLSearchParams({ response_type: "code", client_id: body.client_id, redirect_uri: EVIL, code_challenge: challenge, code_challenge_method: "S256" });
  const id = new URL((await call(sql, request("proxy", `/authorize?${q}`))).headers.get("location")!).searchParams.get("request")!;
  const me = await newUser(pg);
  const described = await (await call(sql, request("function", `/connect/request?id=${id}`, { headers: { authorization: `Bearer ${me.jwt}`, origin: SITE } }))).json();
  // What the consent screen gets: the attacker's own address, and no AI to vouch for it (the page
  // and the app then lead with the host and start at Read Only).
  assertEquals(described.client_name, "attacker.example");
  assertEquals(described.redirect_host, "attacker.example");
  assertEquals(described.verified_ai, null);
});

Deno.test("F5: x-mcp-public-url without the proxy secret is ignored", () => {
  assertEquals(publicBase(new Request(FUNCTION, { headers: { "x-mcp-public-url": ALIAS } })), FUNCTION);
  assertEquals(publicBase(new Request(FUNCTION, { headers: { "x-mcp-public-url": ALIAS, "x-mcp-proxy-secret": "proxy-secret" } })), ALIAS);
});

Deno.test("look-alike names are never a title: the address is, and the claim is plain ASCII", async () => {
  const { sql, pg } = await db();
  // "OpenAl" (lower-case L), "CIaude" (capital i), Cyrillic Т, ė (a mark), small-capital ʟ, Cherokee Ꮯ.
  const names = ["OpenAl", "CIaude", "ChatGP\u0422", "Claud\u0117", "C\u0301laude", "C\u029Faude", "\u13DFlaude"];
  for (const name of names) {
    const { requestId, me, details } = await ask(sql, pg, name, ["https://attacker.example/cb"]);
    assertEquals(details.client_name, "attacker.example", name);
    assertEquals(details.verified_ai, null, name);
    // Some are renamed at registration already (defence in depth); either way the claim is plain.
    assert(details.claimed_name === null || /^[a-z0-9 .,:;'&()+_!?-]+$/.test(details.claimed_name), `${name}: ${details.claimed_name}`);
    const decided = await call(sql, request("function", "/connect/decide", {
      method: "POST", headers: { authorization: `Bearer ${me.jwt}`, origin: SITE, "content-type": "application/json" },
      body: (await appDecision(me, requestId, details.redirect_uri, true, false)).body,
    }));
    assertEquals((await decided.json()).client_name, "attacker.example", name);
    const [{ title }] = await sql`select name as title from public.mcp_tokens where user_id = ${me.id}` as { title: string }[];
    assertEquals(title, "attacker.example", name);
  }
  // Marks go, so these read as what they imitate, but only ever as a claim under the address.
  assertEquals(claimedName("C\u0301laude"), "claude");
  assertEquals(claimedName("Claud\u0117"), "claude");
  assertEquals(claimedName("Cla\u20DDude"), "claude");
  assertEquals(claimedName("OpenAl"), "openal");
  assertEquals(claimedName("CIaude\u202E\u200B"), "ciaude");
  assertEquals(claimedName("\u13DFlaude"), "?laude");
  assertEquals(claimedName("C\u029Faude"), "c?aude");
  assertEquals(claimedName("ChatGP\u0422"), "chatgp?");
  assertEquals(claimedName("Notes Helper 2"), "notes helper 2");
});

Deno.test("a name registered before cleaning never shows bidi or control characters", async () => {
  const { sql, pg } = await db();
  // As an older server stored it: raw.
  const clientId = "amb_client_" + "a".repeat(32);
  await sql`insert into public.oauth_clients (id, client_name, redirect_uris) values
    (${clientId}, ${"Claude\u202E\u200B\u0007 web"}, ${["https://claude.ai/api/mcp/auth_callback"]})`;
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: "https://claude.ai/api/mcp/auth_callback", code_challenge: (await pkce()).challenge, code_challenge_method: "S256" });
  const id = new URL((await call(sql, request("proxy", `/authorize?${q}`))).headers.get("location")!).searchParams.get("request")!;
  const me = await newUser(pg);
  const { described, decided } = await consent(sql, id, me);
  assertEquals((await described.json()).client_name, "Claude web");
  assertEquals((await decided.json()).client_name, "Claude web");
  assertEquals(displayName("\u202E\u200B", "https://chatgpt.com/connector_platform_oauth_redirect"), "ChatGPT");
});

// MARK: End-to-end encryption: the data key's wraps

async function pendingRequest(sql: Sql, via: Via = "proxy") {
  const clientId = await register(sql, via);
  const { verifier, challenge } = await pkce();
  const res = await authorize(sql, via, clientId, challenge);
  return { clientId, verifier, requestId: new URL(res.headers.get("location")!).searchParams.get("request")! };
}

async function decideAs(sql: Sql, user: User, body: Record<string, unknown>) {
  const res = await call(sql, request("function", "/connect/decide", {
    method: "POST", headers: { authorization: `Bearer ${user.jwt}`, "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  return { status: res.status, body: await res.json() };
}

const opens = async (wrapped: string | null, secret: string, purpose: "code" | "access" | "refresh", user: User) =>
  wrapped !== null && (await unwrap(wrapped, await tokenKey(secret, purpose), purpose, user.id).then((k) => k.join() === user.dk!.join(), () => false));

async function refresh(sql: Sql, token: string) {
  const res = await call(sql, request("proxy", "/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token }),
  }));
  return { status: res.status, body: await res.json() };
}

const tokenRow = async (sql: Sql, token: string) =>
  (await sql`select used_at, dk_wrap from public.oauth_tokens where token_hash = ${await sha256Hex(token)}` as { used_at: Date | null; dk_wrap: string | null }[])[0];

Deno.test("decide takes the exact return address the app showed, or nothing happens", async () => {
  const { sql, pg } = await db();
  const { requestId } = await pendingRequest(sql);
  const me = await newUser(pg);
  const changed = "This request changed. Start connecting again from the other app.";
  for (const redirect_uri of [undefined, `${CHATGPT}/`, "https://chatgpt.com/connector_platform_oauth_redirect?x=1", CHATGPT.toUpperCase()]) {
    const { body } = await appDecision(me, requestId, CHATGPT);
    const r = await decideAs(sql, me, { ...JSON.parse(body), redirect_uri });
    assertEquals(r.status, 409, String(redirect_uri));
    assertEquals(r.body.error, changed);
  }
  const [row] = await sql`select decided_at, grant_id from public.oauth_requests where id = ${requestId}` as { decided_at: Date | null; grant_id: string | null }[];
  assertEquals([row.decided_at, row.grant_id], [null, null]);
  const ok = await decideAs(sql, me, JSON.parse((await appDecision(me, requestId, CHATGPT)).body));
  assertEquals(ok.status, 200);
});

Deno.test("decide stores the code's hash and wrap, and answers without a code", async () => {
  const { sql, pg } = await db();
  const { requestId } = await pendingRequest(sql);
  const me = await newUser(pg);
  const { code, body } = await appDecision(me, requestId, CHATGPT);
  const sent = JSON.parse(body);
  // A hash that isn't one, or a wrap under another key, is refused before anything is decided.
  assertEquals((await decideAs(sql, me, { ...sent, code_hash: "nope" })).status, 400);
  assertEquals((await decideAs(sql, me, { ...sent, code_wrap: undefined })).body.error, "Update Amber Notes to connect an AI.");
  const stale = sent.code_wrap.replace(/^amb2\.[0-9a-f]{16}\./, `amb2.${hex(8)}.`);
  assertEquals((await decideAs(sql, me, { ...sent, code_wrap: stale })).status, 409);
  const r = await decideAs(sql, me, sent);
  assertEquals(r.status, 200);
  assertEquals(r.body.client_name, "ChatGPT");
  assertEquals(r.body.can_write, true);
  const back = new URL(r.body.redirect);
  assertEquals(`${back.origin}${back.pathname}`, CHATGPT);
  assertEquals([...back.searchParams.keys()].sort(), ["iss", "state"]);
  const [row] = await sql`select code_hash, code_wrap, code_expires_at > now() + interval '50 seconds' as fresh
    from public.oauth_requests where id = ${requestId}` as { code_hash: string; code_wrap: string; fresh: boolean }[];
  assertEquals(row.code_hash, await sha256Hex(code));
  assertEquals(row.code_wrap, sent.code_wrap);
  assert(row.fresh);
  assert(await opens(row.code_wrap, code, "code", me));
});

Deno.test("an account without a key can't approve: the app sets it up first", async () => {
  const { sql, pg } = await db();
  const { requestId } = await pendingRequest(sql);
  const me = await newUser(pg, false);
  const r = await decideAs(sql, me, { id: requestId, allow: true, write: true, redirect_uri: CHATGPT, code_hash: hex(32), code_wrap: `amb2.${hex(8)}.AAAA` });
  assertEquals([r.status, r.body.error], [409, "Set up Amber Notes on this device first."]);
  // Declining needs no key.
  const denied = await decideAs(sql, me, { id: requestId, allow: false, redirect_uri: CHATGPT });
  assertEquals(new URL(denied.body.redirect).searchParams.get("error"), "access_denied");
});

Deno.test("the code opens its wrap once; the key moves to the access and refresh tokens", async () => {
  const { sql, pg } = await db();
  const { clientId, verifier, back, me, requestId } = await connect(sql, pg, "proxy");
  const t = await exchange(sql, "proxy", clientId, back.searchParams.get("code")!, verifier);
  assertEquals(t.status, 200, JSON.stringify(t.body));
  const [req] = await sql`select code_wrap, code_used_at from public.oauth_requests where id = ${requestId}` as { code_wrap: string | null; code_used_at: Date | null }[];
  assertEquals(req.code_wrap, null);
  assert(req.code_used_at);
  assert(await opens((await tokenRow(sql, t.body.access_token)).dk_wrap, t.body.access_token, "access", me));
  assert(await opens((await tokenRow(sql, t.body.refresh_token)).dk_wrap, t.body.refresh_token, "refresh", me));
  // Neither opens with the other token, or under the other purpose.
  assert(!(await opens((await tokenRow(sql, t.body.access_token)).dk_wrap, t.body.refresh_token, "access", me)));
  assert(!(await opens((await tokenRow(sql, t.body.access_token)).dk_wrap, t.body.access_token, "refresh", me)));
  const g = await resolveAccessToken(sql, t.body.access_token, request("proxy", ""));
  assert(await opens(g!.dk_wrap, t.body.access_token, "access", me));
});

Deno.test("a code whose wrap doesn't open gets invalid_grant, and no tokens", async () => {
  const { sql, pg } = await db();
  const { clientId, verifier, back, me, requestId } = await connect(sql, pg, "proxy");
  // A wrap under some other code, as a buggy or old app might send.
  const other = await wrap(me.dk!, await tokenKey("amb_code_" + hex(32), "code"), "code", me.id);
  await sql`update public.oauth_requests set code_wrap = ${other} where id = ${requestId}`;
  const t = await exchange(sql, "proxy", clientId, back.searchParams.get("code")!, verifier);
  assertEquals([t.status, t.body.error, t.body.error_description], [400, "invalid_grant", "Connect again."]);
  assertEquals((await sql`select 1 from public.oauth_tokens`).length, 0);
});

Deno.test("refresh rotation moves the wrap to the new pair and removes the old one's", async () => {
  const { sql, pg } = await db();
  const { clientId, verifier, back, me } = await connect(sql, pg, "proxy");
  const first = (await exchange(sql, "proxy", clientId, back.searchParams.get("code")!, verifier)).body;
  const second = await refresh(sql, first.refresh_token);
  assertEquals(second.status, 200, JSON.stringify(second.body));
  const old = await tokenRow(sql, first.refresh_token);
  assert(old.used_at);
  assertEquals(old.dk_wrap, null);
  assert(await opens((await tokenRow(sql, second.body.access_token)).dk_wrap, second.body.access_token, "access", me));
  assert(await opens((await tokenRow(sql, second.body.refresh_token)).dk_wrap, second.body.refresh_token, "refresh", me));
  // A refresh token without its wrap can't make a connection that opens nothing.
  await sql`update public.oauth_tokens set dk_wrap = null where token_hash = ${await sha256Hex(second.body.refresh_token)}`;
  const third = await refresh(sql, second.body.refresh_token);
  assertEquals([third.status, third.body.error], [400, "invalid_grant"]);
});

Deno.test("reusing a code or a refresh token revokes the connection, and its wraps go", async () => {
  const { sql, pg } = await db();
  const a = await connect(sql, pg, "proxy");
  const code = a.back.searchParams.get("code")!;
  const t = (await exchange(sql, "proxy", a.clientId, code, a.verifier)).body;
  assertEquals((await exchange(sql, "proxy", a.clientId, code, a.verifier)).body.error, "invalid_grant");
  const wraps = async (userId: string) => {
    const [r] = await sql`select
        (select count(*)::int from public.oauth_tokens t join public.mcp_tokens g on g.id = t.grant_id where g.user_id = ${userId}) as tokens,
        (select count(*)::int from public.oauth_requests q join public.mcp_tokens g on g.id = q.grant_id where g.user_id = ${userId} and q.code_wrap is not null) as codes,
        (select count(*)::int from public.mcp_tokens where user_id = ${userId} and (dk_wrap is not null or revoked_at is null)) as live` as { tokens: number; codes: number; live: number }[];
    return r;
  };
  assertEquals(await wraps(a.me.id), { tokens: 0, codes: 0, live: 0 });
  assertEquals(await resolveAccessToken(sql, t.access_token, request("proxy", "")), undefined);

  const b = await connect(sql, pg, "proxy");
  const tb = (await exchange(sql, "proxy", b.clientId, b.back.searchParams.get("code")!, b.verifier)).body;
  assertEquals((await refresh(sql, tb.refresh_token)).status, 200);
  assertEquals((await refresh(sql, tb.refresh_token)).body.error, "invalid_grant");
  assertEquals(await wraps(b.me.id), { tokens: 0, codes: 0, live: 0 });
});

Deno.test("revoking a connection deletes its wraps", async () => {
  const { sql, pg } = await db();
  const c = await connect(sql, pg, "proxy");
  const t = (await exchange(sql, "proxy", c.clientId, c.back.searchParams.get("code")!, c.verifier)).body;
  const res = await call(sql, request("proxy", "/revoke", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token: t.refresh_token }),
  }));
  assertEquals(res.status, 200);
  assertEquals((await sql`select 1 from public.oauth_tokens`).length, 0);
  // From the app: Disconnect sets revoked_at, and the trigger takes every wrap.
  const d = await connect(sql, pg, "proxy");
  await exchange(sql, "proxy", d.clientId, d.back.searchParams.get("code")!, d.verifier);
  await app(pg, d.me.id, `update public.mcp_tokens set revoked_at = now() where kind = 'oauth'`);
  assertEquals((await sql`select 1 from public.oauth_tokens`).length, 0);
});

Deno.test("/connect/label names the address for the web page, without a session, and no AI's mark", async () => {
  const { sql, pg } = await db();
  const { requestId } = await pendingRequest(sql);
  const res = await call(sql, request("proxy", `/connect/label?id=${requestId}`, { headers: { origin: SITE } }));
  assertEquals(res.status, 200);
  // Before anyone signs in there's no telling whose sign-in this is: no mark, the name only as a claim.
  assertEquals(await res.json(), { client_name: "chatgpt.com", claimed_name: "chatgpt", redirect_host: "chatgpt.com", verified_ai: null });
  const fake = await ask(sql, pg, "Claude", ["https://evil.example/cb"]);
  assertEquals(await (await call(sql, request("proxy", `/connect/label?id=${fake.requestId}`))).json(),
    { client_name: "evil.example", claimed_name: fake.details.claimed_name, redirect_host: "evil.example", verified_ai: null });
  assertEquals((await call(sql, request("proxy", `/connect/label?id=${crypto.randomUUID()}`))).status, 404);
  assertEquals((await call(sql, request("proxy", `/connect/label?id=nope`))).status, 404);
  assertEquals((await call(sql, request("proxy", `/connect/label?id=${requestId}`, { method: "POST" }))).status, 405);
  // Once answered, there's nothing to name.
  const me = await newUser(pg);
  await consent(sql, requestId, me);
  assertEquals((await call(sql, request("proxy", `/connect/label?id=${requestId}`))).status, 404);
});

// MARK: The MCP endpoint

const rpc = (sql: Sql, auth: string | null, path = "", body: unknown = { jsonrpc: "2.0", id: 1, method: "tools/list" }) =>
  handleRequest(new Request(`${FUNCTION}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.1", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  }), sql);

Deno.test("the MCP endpoint opens the key per request; a connection without a wrap that opens must connect again", async () => {
  const { sql, pg } = await db();
  const c = await connect(sql, pg, "function");
  const t = (await exchange(sql, "function", c.clientId, c.back.searchParams.get("code")!, c.verifier)).body;
  const ok = await rpc(sql, `Bearer ${t.access_token}`);
  assertEquals(ok.status, 200);
  assert((await ok.json()).result.tools.length > 10);
  // The refresh token's wrap in the access token's place: it doesn't open with the access token.
  const hash = await sha256Hex(t.access_token);
  const refreshWrap = (await tokenRow(sql, t.refresh_token)).dk_wrap;
  await sql`update public.oauth_tokens set dk_wrap = ${refreshWrap} where token_hash = ${hash}`;
  for (const wrapNow of [refreshWrap, null]) {
    await sql`update public.oauth_tokens set dk_wrap = ${wrapNow} where token_hash = ${hash}`;
    const res = await rpc(sql, `Bearer ${t.access_token}`);
    assertEquals(res.status, 401);
    assertStringIncludes(res.headers.get("www-authenticate")!, `error="invalid_token"`);
    await res.body?.cancel();
  }
});

Deno.test("a pane_ token works only in the Authorization header, never in the address", async () => {
  const { sql, pg } = await db();
  const a = await account(pg);
  const token = "pane_" + hex(32);
  const wrapped = await wrap(a.dk, await tokenKey(token, "pane"), "pane", a.id);
  await app(pg, a.id, `select public.create_mcp_token('Claude Code', true, $1, $2)`, [await sha256Hex(token), wrapped]);
  const ok = await rpc(sql, `Bearer ${token}`);
  assertEquals(ok.status, 200);
  await ok.body?.cancel();
  const logged: string[] = [];
  const real = console.log;
  console.log = (...args: unknown[]) => { logged.push(args.map(String).join(" ")); };
  try {
    for (const [path, auth] of [[`/${token}`, null], [`/${token}`, `Bearer ${token}`], [`/anything/else`, `Bearer ${token}`], [`?token=${token}`, null], [`?access_token=amb_at_${hex(32)}`, `Bearer ${token}`]] as const) {
      const res = await rpc(sql, auth, path);
      assertEquals(res.status, 401, path);
      const body = await res.json();
      assertStringIncludes(body.error.message, "Tokens in the address aren't accepted");
      assertStringIncludes(body.error.message, "Authorization header");
    }
  } finally {
    console.log = real;
  }
  // Refused without the path or the token ever reaching a log.
  assert(logged.length > 0);
  assert(logged.every((l) => !l.includes(token) && !l.includes("pane_") && !l.includes("amb_at_")), logged.join("\n"));
  // A pane_ token whose connection lost its wrap has to be made again.
  await sql`update public.mcp_tokens set dk_wrap = null where user_id = ${a.id}`;
  const gone = await rpc(sql, `Bearer ${token}`);
  assertEquals(gone.status, 401);
  assertStringIncludes(gone.headers.get("www-authenticate")!, `error="invalid_token"`);
});

// MARK: Approving from your devices, for a browser anywhere; or with the recovery key in the browser

/** The page's pickup secret (32 random bytes, as lowercase hex) and its hash, as web/lib/connect-flow.ts makes them. */
async function newPickup() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return { pickup: toHex(bytes), pickup_hash: toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))) };
}

/** The page asks: its key, its pickup hash, and its commit to the key and a nonce it keeps
 *  (matchCommit), as web/lib/connect-flow.ts sends them. `commit: null` leaves the commit out. */
async function askAs(sql: Sql, user: User, id: string, browserKey: string, from = "Chrome on a Mac", pickup?: { pickup: string; pickup_hash: string } | null, commit?: string | null) {
  const p = pickup === undefined ? await newPickup() : pickup;
  const nonce = crypto.getRandomValues(new Uint8Array(16));
  let raw: Uint8Array = new Uint8Array(0);
  try { raw = fromBase64(browserKey); } catch { /* not a key: refused before the commit matters */ }
  const c = commit === undefined ? await matchCommit(raw, nonce) : commit;
  const res = await call(sql, request("function", "/connect/ask", {
    method: "POST", headers: { authorization: `Bearer ${user.jwt}`, origin: SITE, "content-type": "application/json" },
    body: JSON.stringify({ id, browser_key: browserKey, from, ...(p ? { pickup_hash: p.pickup_hash } : {}), ...(c ? { match_commit: c } : {}) }),
  }));
  return { status: res.status, body: await res.json(), pickup: p?.pickup ?? "", nonce };
}

/** The device writes its nonce (POST /connect/nonce, with the session, from the app). */
async function deviceNonce(sql: Sql, user: User, id: string, nonce: string) {
  const res = await call(sql, request("function", "/connect/nonce", {
    method: "POST", headers: { authorization: `Bearer ${user.jwt}`, "content-type": "application/json" }, body: JSON.stringify({ id, nonce }),
  }));
  return { status: res.status, body: await res.json() };
}

/** The page reveals its nonce (POST /connect/reveal, no session, with the pickup). */
async function reveal(sql: Sql, id: string, pickup: string, nonce: string) {
  const res = await call(sql, request("proxy", "/connect/reveal", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, pickup, nonce }),
  }));
  return { status: res.status, body: await res.json() };
}

/** Number matching the way it goes when nothing is wrong: the device writes its nonce, the page
 *  sees it and reveals its own. Returns the device's nonce. */
async function matchUp(sql: Sql, user: User, id: string, pickup: string, pageNonce: Uint8Array) {
  const d = crypto.getRandomValues(new Uint8Array(16));
  assertEquals((await deviceNonce(sql, user, id, toHex(d))).status, 200);
  assertEquals((await reveal(sql, id, pickup, toHex(pageNonce))).status, 200);
  return d;
}

const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map((b) => parseInt(b, 16)));

/** /connect/status as the page calls it: a POST with the pickup secret (or without one). */
async function statusOf(sql: Sql, id: string, pickup?: string) {
  return await (await call(sql, request("proxy", "/connect/status", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, ...(pickup ? { pickup } : {}) }),
  }))).json();
}

Deno.test("a browser asks the account's devices; the device seals the code to the page, which picks it up once", async () => {
  const { sql, pg } = await db();
  const { clientId, verifier, requestId } = await pendingRequest(sql);
  const me = await newUser(pg);
  assertEquals((await statusOf(sql, requestId)).state, "pending");
  const page = await newHandoffKeys();
  assertEquals((await askAs(sql, me, requestId, "not a key")).status, 400);
  // The page's pickup hash is required: lowercase hex SHA-256.
  assertEquals((await askAs(sql, me, requestId, toBase64(page.publicRaw), "Chrome on a Mac", null)).status, 400);
  assertEquals((await askAs(sql, me, requestId, toBase64(page.publicRaw), "Chrome on a Mac", { pickup: "", pickup_hash: "A".repeat(64) })).status, 400);
  // So is the commit to the page's key and nonce: lowercase hex SHA-256.
  assertEquals((await askAs(sql, me, requestId, toBase64(page.publicRaw), "Chrome on a Mac", undefined, null)).status, 400);
  assertEquals((await askAs(sql, me, requestId, toBase64(page.publicRaw), "Chrome on a Mac", undefined, "A".repeat(64))).status, 400);
  const askedNow = await askAs(sql, me, requestId, toBase64(page.publicRaw));
  assertEquals(askedNow.status, 200);
  const pickup = askedNow.pickup;
  assertEquals((await statusOf(sql, requestId)).state, "asked");
  // The pickup sees whether a device has written its nonce yet; nobody else does.
  assertEquals(await statusOf(sql, requestId, pickup), { state: "asked", device_nonce: null });
  const dNonce = await matchUp(sql, me, requestId, pickup, askedNow.nonce);
  assertEquals(await statusOf(sql, requestId), { state: "asked" });
  assertEquals(await statusOf(sql, requestId, pickup), { state: "asked", device_nonce: toHex(dNonce) });

  // Every device of the account sees the ask (realtime reads it under RLS); nobody else does.
  const [seen] = await app(pg, me.id, `select request_id, browser_key, started_from, match_commit, page_nonce from public.connect_asks`);
  assertEquals([seen.request_id, seen.started_from], [requestId, "Chrome on a Mac"]);
  // The device checks the page's commit, then shows the number the page shows.
  assertEquals(await matchCommit(fromBase64(seen.browser_key), fromHex(seen.page_nonce)), seen.match_commit);
  assertEquals(await matchNumber(fromBase64(seen.browser_key), fromHex(seen.page_nonce), dNonce, requestId),
    await matchNumber(page.publicRaw, askedNow.nonce, dNonce, requestId));
  const other = await newUser(pg);
  assertEquals((await app(pg, other.id, `select 1 from public.connect_asks`)).length, 0);
  const asked = await (await call(sql, request("function", `/connect/request?id=${requestId}`, { headers: { authorization: `Bearer ${me.jwt}` } }))).json();
  assertEquals([asked.asked, asked.started_from], [true, "Chrome on a Mac"]);
  // A device answering a browser it can't see: no AI's mark, the address as the title, the name a claim.
  assertEquals([asked.verified_ai, asked.client_name, asked.claimed_name, asked.redirect_host], [null, "chatgpt.com", "chatgpt", "chatgpt.com"]);
  // What the device builds the redirect from: the same as clientRedirect on the server.
  assertEquals([asked.redirect_uri, asked.state, asked.iss], [CHATGPT, "xyz", ALIAS]);
  const built = new URL(asked.redirect_uri);
  if (asked.state) built.searchParams.set("state", asked.state);
  built.searchParams.set("iss", asked.iss);

  // The device must seal the code (with the redirect) to the page.
  const { code, body } = await appDecision(me, requestId, CHATGPT);
  assertEquals((await decideAs(sql, me, JSON.parse(body))).status, 400);
  const handoff = await sealHandoff(handoffPayload({ code, redirect: built.toString() }), fromBase64(seen.browser_key), requestId);
  const r = await decideAs(sql, me, { ...JSON.parse(body), handoff });
  assertEquals([r.status, r.body.handoff], [200, true]);
  assertEquals(r.body.redirect, built.toString());

  // Nothing the server keeps holds the code.
  const kept = JSON.stringify(await sql`select * from public.connect_asks` ) + JSON.stringify(await sql`select * from public.oauth_requests`);
  assertEquals(kept.includes(code), false);

  // Without the pickup secret, or with another one, only the state: someone who learns the
  // request id can't collect the answer, and trying doesn't spend it.
  assertEquals(await statusOf(sql, requestId), { state: "approved" });
  assertEquals(await statusOf(sql, requestId, (await newPickup()).pickup), { state: "approved" });
  assertEquals(await statusOf(sql, requestId, pickup.toUpperCase()), { state: "approved" });
  // Only POST: nothing secret goes in an address.
  const get = await call(sql, request("proxy", `/connect/status?id=${requestId}&pickup=${pickup}`));
  assertEquals(get.status, 405);
  await get.body?.cancel();
  const done = await statusOf(sql, requestId, pickup);
  assertEquals(done.state, "approved");
  const payload = readHandoffPayload(await openHandoff(done.handoff, page.privateKey, requestId));
  assertEquals(payload, { code, redirect: done.redirect });
  const opened = payload.code;
  assertEquals(new URL(done.redirect).searchParams.has("code"), false);
  // Handed over once.
  assertEquals(await statusOf(sql, requestId, pickup), { state: "delivered" });
  assertEquals(await statusOf(sql, requestId), { state: "delivered" });
  const tokens = await exchange(sql, "proxy", clientId, opened, verifier);
  assertEquals(tokens.status, 200);
});

Deno.test("declined on a device, the page gets the declined redirect", async () => {
  const { sql, pg } = await db();
  const { requestId } = await pendingRequest(sql);
  const me = await newUser(pg);
  const page = await newHandoffKeys();
  const { pickup } = await askAs(sql, me, requestId, toBase64(page.publicRaw));
  const r = await decideAs(sql, me, { id: requestId, allow: false, redirect_uri: CHATGPT });
  assertEquals(r.status, 200);
  assertEquals(await statusOf(sql, requestId), { state: "denied" });
  const s = await statusOf(sql, requestId, pickup);
  assertEquals(s.state, "denied");
  assertEquals(new URL(s.redirect).searchParams.get("error"), "access_denied");
  assertEquals(await statusOf(sql, requestId, pickup), { state: "delivered" });
  // Declining makes no notice.
  assertEquals((await app(pg, me.id, `select 1 from public.account_notices`)).length, 0);
  // One answer per request.
  const again = await decideAs(sql, me, JSON.parse((await appDecision(me, requestId, CHATGPT)).body));
  assertEquals(again.status, 404);
});

Deno.test("asks are limited per account, and expire with their request", async () => {
  const { sql, pg } = await db();
  const me = await newUser(pg);
  const page = toBase64((await newHandoffKeys()).publicRaw);
  for (let i = 0; i < 10; i++) {
    const { requestId } = await pendingRequest(sql, "function");
    assertEquals((await askAs(sql, me, requestId, page)).status, 200);
  }
  const { requestId } = await pendingRequest(sql, "function");
  assertEquals((await askAs(sql, me, requestId, page)).status, 429);
  await sql`update public.oauth_requests set expires_at = now() - interval '1 second' where id = ${requestId}`;
  assertEquals((await statusOf(sql, requestId)).state, "expired");
});

Deno.test("with the recovery key the page opens the key itself and decides the same way", async () => {
  const { sql, pg } = await db();
  const { clientId, verifier, requestId } = await pendingRequest(sql);
  // An account whose recovery key this test knows.
  const id = await plainUser(pg);
  const dk = crypto.getRandomValues(new Uint8Array(32));
  const recovery = crypto.getRandomValues(new Uint8Array(16));
  await app(pg, id, `select * from public.create_account_key($1, $2, $3, 0)`,
    [await keyIdOf(dk), await verifierOf(dk, id), await wrap(dk, await recoveryKEK(recovery, id), "recovery", id)]);
  const me: User = { id, jwt: `jwt-${id}`, dk };
  const page = await newHandoffKeys();
  await askAs(sql, me, requestId, toBase64(page.publicRaw));

  // In the browser: the typed key, the server's wrap, the verifier check, a code made there.
  const typed = (await recoveryKeyText(recovery)).toLowerCase().replace(/-/g, " ");
  const [row] = await app(pg, id, `select key_id, verifier, recovery_wrap from public.account_keys`);
  const opened = await unwrap(row.recovery_wrap, await recoveryKEK((await parseRecoveryKey(typed))!, id), "recovery", id);
  assertEquals(await verifierOf(opened, id), row.verifier);
  const code = "amb_code_" + hex(32);
  const res = await call(sql, request("function", "/connect/decide", {
    method: "POST", headers: { authorization: `Bearer ${me.jwt}`, origin: SITE, "content-type": "application/json" },
    body: JSON.stringify({ id: requestId, allow: true, write: false, redirect_uri: CHATGPT,
      code_hash: await sha256Hex(code), code_wrap: await wrap(opened, await tokenKey(code, "code"), "code", id) }),
  }));
  const r = await res.json();
  assertEquals([res.status, r.handoff], [200, undefined]);
  // The page redirects itself; devices see it answered, and nothing waits to be picked up.
  assertEquals((await statusOf(sql, requestId)).state, "delivered");
  assertEquals((await exchange(sql, "proxy", clientId, code, verifier)).status, 200);
});

// MARK: Every device hears of a new connection

Deno.test("Allow tells every device: a notice names the connection and where it was asked from", async () => {
  const { sql, pg } = await db();
  // Asked from a browser: the notice says which one, and points at the grant (for Disconnect).
  const { requestId } = await pendingRequest(sql);
  const me = await newUser(pg);
  const page = await newHandoffKeys();
  const firefox = await askAs(sql, me, requestId, toBase64(page.publicRaw), "Firefox on Windows");
  await matchUp(sql, me, requestId, firefox.pickup, firefox.nonce);
  const { code, body } = await appDecision(me, requestId, CHATGPT);
  const r = await decideAs(sql, me, { ...JSON.parse(body), handoff: await sealHandoff(handoffPayload({ code, redirect: CHATGPT }), page.publicRaw, requestId) });
  assertEquals(r.status, 200);
  const [grant] = await app(pg, me.id, `select id from public.mcp_tokens where kind = 'oauth'`);
  assertEquals(await app(pg, me.id, `select kind, grant_id, what from public.account_notices`),
    [{ kind: "ai_connected", grant_id: grant.id, what: "Connected ChatGPT from Firefox on Windows" }]);
  // Approved in the app on the device itself: "this device". Nobody else reads them.
  const again = await pendingRequest(sql);
  await consent(sql, again.requestId, me);
  assertEquals((await app(pg, me.id, `select what from public.account_notices order by id`)).map((n) => n.what),
    ["Connected ChatGPT from Firefox on Windows", "Connected ChatGPT from this device"]);
  const other = await newUser(pg);
  assertEquals((await app(pg, other.id, `select 1 from public.account_notices`)).length, 0);
  // The notice is written with the grant: a decide that doesn't make one leaves none.
  const refused = await pendingRequest(sql);
  const stale = JSON.parse((await appDecision(me, refused.requestId, CHATGPT)).body);
  await decideAs(sql, me, { ...stale, code_wrap: stale.code_wrap.replace(/^amb2\.[0-9a-f]{16}\./, `amb2.${hex(8)}.`) });
  assertEquals((await app(pg, me.id, `select 1 from public.account_notices`)).length, 2);
});

// MARK: Number matching, commit then reveal

Deno.test("number matching goes in order: commit, the device's nonce, the reveal, then Allow", async () => {
  const { sql, pg } = await db();
  const { clientId, verifier, requestId } = await pendingRequest(sql);
  const me = await newUser(pg);
  const page = await newHandoffKeys();
  const asked = await askAs(sql, me, requestId, toBase64(page.publicRaw));
  const pNonce = toHex(asked.nonce);

  // The page can't reveal before a device has written its nonce, nor without its pickup.
  assertEquals((await reveal(sql, requestId, asked.pickup, pNonce)).status, 409);
  const d1 = hex(16);
  // Only the account's own app writes the device's nonce, and only a well-formed one.
  const other = await newUser(pg);
  assertEquals((await deviceNonce(sql, other, requestId, d1)).status, 404);
  assertEquals((await deviceNonce(sql, me, requestId, "A".repeat(32))).status, 400);
  const fromElsewhere = await call(sql, request("function", "/connect/nonce", {
    method: "POST", headers: { authorization: `Bearer ${me.jwt}`, origin: "https://evil.example", "content-type": "application/json" }, body: JSON.stringify({ id: requestId, nonce: d1 }),
  }));
  assertEquals(fromElsewhere.status, 403);
  await fromElsewhere.body?.cancel();
  const signedOut = await call(sql, request("function", "/connect/nonce", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: requestId, nonce: d1 }) }));
  assertEquals(signedOut.status, 401);
  await signedOut.body?.cancel();
  // Written once: the same nonce again is fine, another is refused.
  assertEquals((await deviceNonce(sql, me, requestId, d1)).status, 200);
  assertEquals((await deviceNonce(sql, me, requestId, d1)).status, 200);
  assertEquals((await deviceNonce(sql, me, requestId, hex(16))).status, 409);
  assertEquals(await statusOf(sql, requestId, asked.pickup), { state: "asked", device_nonce: d1 });

  // Allow before the page has revealed: refused, and the request stays open.
  const { code, body } = await appDecision(me, requestId, CHATGPT);
  const [seen] = await app(pg, me.id, `select browser_key from public.connect_asks`);
  const handoff = await sealHandoff(handoffPayload({ code, redirect: CHATGPT }), fromBase64(seen.browser_key), requestId);
  const early = await decideAs(sql, me, { ...JSON.parse(body), handoff });
  assertEquals([early.status, early.body.error], [409, "Finish on the page in your browser first."]);
  assertEquals((await statusOf(sql, requestId)).state, "asked");

  // The reveal: only with the pickup, once; the same nonce again is fine, another is refused.
  assertEquals((await reveal(sql, requestId, (await newPickup()).pickup, pNonce)).status, 403);
  assertEquals((await reveal(sql, requestId, asked.pickup, "A".repeat(32))).status, 400);
  assertEquals((await reveal(sql, requestId, asked.pickup, pNonce)).status, 200);
  assertEquals((await reveal(sql, requestId, asked.pickup, pNonce)).status, 200);
  assertEquals((await reveal(sql, requestId, asked.pickup, hex(16))).status, 409);
  // The device's nonce can't change after the reveal either.
  assertEquals((await deviceNonce(sql, me, requestId, hex(16))).status, 409);

  // Both screens show the same two digits, and now Allow goes through.
  const [row] = await app(pg, me.id, `select browser_key, match_commit, page_nonce from public.connect_asks`);
  assertEquals(await matchCommit(fromBase64(row.browser_key), fromHex(row.page_nonce)), row.match_commit);
  assertEquals(await matchNumber(fromBase64(row.browser_key), fromHex(row.page_nonce), fromHex(d1), requestId),
    await matchNumber(page.publicRaw, asked.nonce, fromHex(d1), requestId));
  assertEquals((await decideAs(sql, me, { ...JSON.parse(body), handoff })).status, 200);
  const done = await statusOf(sql, requestId, asked.pickup);
  assertEquals(readHandoffPayload(await openHandoff(done.handoff, page.privateKey, requestId)).code, code);
  assertEquals((await exchange(sql, "proxy", clientId, code, verifier)).status, 200);
  // Answered: no more nonces or reveals.
  assertEquals((await deviceNonce(sql, me, requestId, d1)).status, 404);
  assertEquals((await reveal(sql, requestId, asked.pickup, pNonce)).status, 404);
});

Deno.test("a page that asks again starts both nonces over", async () => {
  const { sql, pg } = await db();
  const { requestId } = await pendingRequest(sql);
  const me = await newUser(pg);
  const first = await askAs(sql, me, requestId, toBase64((await newHandoffKeys()).publicRaw));
  await matchUp(sql, me, requestId, first.pickup, first.nonce);
  const again = await askAs(sql, me, requestId, toBase64((await newHandoffKeys()).publicRaw));
  assertEquals(again.status, 200);
  const [row] = await app(pg, me.id, `select device_nonce, page_nonce from public.connect_asks`);
  assertEquals(row, { device_nonce: null, page_nonce: null });
  assertEquals(await statusOf(sql, requestId, again.pickup), { state: "asked", device_nonce: null });
  // The reloaded page reveals only after a device's new nonce.
  assertEquals((await reveal(sql, requestId, again.pickup, toHex(again.nonce))).status, 409);
  await matchUp(sql, me, requestId, again.pickup, again.nonce);
});

Deno.test("a key swapped in the database after the commit fails the device's check", async () => {
  const { sql, pg } = await db();
  const { requestId } = await pendingRequest(sql);
  const me = await newUser(pg);
  const page = await newHandoffKeys();
  const asked = await askAs(sql, me, requestId, toBase64(page.publicRaw));
  const d = await matchUp(sql, me, requestId, asked.pickup, asked.nonce);
  // Someone who can write the database puts their own key in the page's place.
  const attacker = await newHandoffKeys();
  await pg.query(`update public.connect_asks set browser_key = $1 where request_id = $2`, [toBase64(attacker.publicRaw), requestId]);
  // The device, before showing a number: the revealed nonce doesn't open the commit for this key,
  // so it shows no number and seals nothing.
  const [row] = await app(pg, me.id, `select browser_key, match_commit, page_nonce from public.connect_asks`);
  assertEquals(row.browser_key, toBase64(attacker.publicRaw));
  assert((await matchCommit(fromBase64(row.browser_key), fromHex(row.page_nonce))) !== row.match_commit);
  // With the page's own key it does open: the check is what catches the swap.
  assertEquals(await matchCommit(page.publicRaw, fromHex(row.page_nonce)), row.match_commit);
  // To pass the check the writer must commit afresh, but the page's nonce is already revealed and
  // the device's already written: a new commit needs a new page nonce, which the server refuses.
  assertEquals((await reveal(sql, requestId, asked.pickup, hex(16))).status, 409);
  assertEquals((await deviceNonce(sql, me, requestId, toHex(d))).status, 200);
});

Deno.test("a wrong number pauses the account's asks for an hour and tells every device", async () => {
  const { sql, pg } = await db();
  const { requestId } = await pendingRequest(sql);
  const me = await newUser(pg);
  const asked = await askAs(sql, me, requestId, toBase64((await newHandoffKeys()).publicRaw));
  await matchUp(sql, me, requestId, asked.pickup, asked.nonce);
  const r = await decideAs(sql, me, { id: requestId, allow: false, redirect_uri: CHATGPT, wrong_number: true });
  assertEquals(r.status, 200);
  // Declined as usual: the page gets the declined redirect.
  const s = await statusOf(sql, requestId, asked.pickup);
  assertEquals([s.state, new URL(s.redirect).searchParams.get("error")], ["denied", "access_denied"]);
  assertEquals(await app(pg, me.id, `select kind, grant_id, what from public.account_notices`), [{ kind: "wrong_number", grant_id: null, what: "wrong_number" }]);
  const [block] = await app(pg, me.id, `select blocked_until > now() + interval '59 minutes' and blocked_until <= now() + interval '1 hour' as ok from public.connect_blocks`);
  assertEquals(block.ok, true);
  // No new asks for an hour.
  const next = await pendingRequest(sql);
  const refused = await askAs(sql, me, next.requestId, toBase64((await newHandoffKeys()).publicRaw));
  assertEquals([refused.status, refused.body.error], [429, "Connecting AIs is paused for an hour on this account because a wrong number was typed. If that wasn't you, change your password."]);
  // Other accounts ask as usual.
  const other = await newUser(pg);
  const theirs = await pendingRequest(sql);
  assertEquals((await askAs(sql, other, theirs.requestId, toBase64((await newHandoffKeys()).publicRaw))).status, 200);
  // After the hour, asks go through again.
  await pg.query(`update public.connect_blocks set blocked_until = now() - interval '1 second'`);
  assertEquals((await askAs(sql, me, next.requestId, toBase64((await newHandoffKeys()).publicRaw))).status, 200);
  // A plain decline blocks nothing.
  await pg.query(`delete from public.connect_blocks`);
  const plain = await pendingRequest(sql);
  const p = await askAs(sql, other, plain.requestId, toBase64((await newHandoffKeys()).publicRaw));
  await matchUp(sql, other, plain.requestId, p.pickup, p.nonce);
  assertEquals((await decideAs(sql, other, { id: plain.requestId, allow: false, redirect_uri: CHATGPT })).status, 200);
  assertEquals((await pg.query(`select 1 from public.connect_blocks`)).rows.length, 0);
});

Deno.test("the right number typed on a device ends a pause from an earlier wrong one", async () => {
  const { sql, pg } = await db();
  const { requestId } = await pendingRequest(sql);
  const me = await newUser(pg);
  const page = await newHandoffKeys();
  const asked = await askAs(sql, me, requestId, toBase64(page.publicRaw));
  await matchUp(sql, me, requestId, asked.pickup, asked.nonce);
  // A wrong number on another request paused the account meanwhile.
  await pg.query(`insert into public.connect_blocks (user_id, blocked_until) values ($1, now() + interval '1 hour')`, [me.id]);
  const { code, body } = await appDecision(me, requestId, CHATGPT);
  const r = await decideAs(sql, me, { ...JSON.parse(body), handoff: await sealHandoff(handoffPayload({ code, redirect: CHATGPT }), page.publicRaw, requestId) });
  assertEquals(r.status, 200);
  assertEquals((await pg.query(`select 1 from public.connect_blocks`)).rows.length, 0);
});

Deno.test("a declined redirect goes to the page only when it's https, or http on this computer", async () => {
  const { sql, pg } = await db();
  const declined = async (uris: string[], planted?: string) => {
    const { requestId: id, me } = await ask(sql, pg, "Some app", uris);
    const a = await askAs(sql, me, id, toBase64((await newHandoffKeys()).publicRaw));
    assertEquals((await decideAs(sql, me, { id, allow: false, redirect_uri: uris[0] })).status, 200);
    if (planted) await pg.query(`update public.connect_asks set redirect = $1 where request_id = $2`, [planted, id]);
    return await statusOf(sql, id, a.pickup);
  };
  const loopback = await declined(["http://127.0.0.1:8765/cb"]);
  assertEquals([loopback.state, new URL(loopback.redirect).origin], ["denied", "http://127.0.0.1:8765"]);
  assertEquals((await declined(["https://app.example/cb"])).redirect.startsWith("https://app.example/cb?"), true);
  // A redirect a database writer put in the row: withheld unless it's one the page may follow.
  for (const bad of ["http://evil.example/cb?error=access_denied", "javascript:alert(1)", "data:text/html,hi"]) {
    assertEquals(await declined(["https://app.example/cb"], bad), { state: "denied" }, bad);
  }
});

// MARK: Push: a new ask wakes the account's devices (APNs), with nothing of the notes in it

Deno.test("an ask pushes to every device of that account, generic words and the request id only; gone tokens go", async () => {
  const { sql, pg } = await db();
  const me = await newUser(pg);
  const other = await newUser(pg);
  const token = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
  const register = (u: User, device: string, t: string, environment = "sandbox", platform = "ios") =>
    app(pg, u.id, `select public.register_device_token($1, $2, $3, $4)`, [device, platform, t, environment]);
  const [phone, mac] = [crypto.randomUUID(), crypto.randomUUID()];
  await register(me, phone, token(1));
  await register(me, mac, token(2), "production", "macos");
  await register(other, crypto.randomUUID(), token(3));
  // A device registering again replaces its token; another account can't see or remove mine.
  await register(me, phone, token(4));
  assertEquals((await app(pg, other.id, `select token from public.device_tokens`)).map((r: any) => r.token), [token(3)]);
  await app(pg, other.id, `delete from public.device_tokens where token = $1`, [token(4)]);
  assertEquals((await app(pg, me.id, `select 1 from public.device_tokens`)).length, 2);

  const sent: { token: string; environment: string; payload: any }[] = [];
  setPushSender((p) => { sent.push(p); return Promise.resolve(p.token === token(2) ? "gone" : "sent"); });
  try {
    const { requestId } = await pendingRequest(sql);
    assertEquals((await askAs(sql, me, requestId, toBase64((await newHandoffKeys()).publicRaw))).status, 200);
    assertEquals(sent.map((p) => [p.token, p.environment]).sort(), [[token(2), "production"], [token(4), "sandbox"]]);
    const payload = sent[0].payload;
    assertEquals(payload.ask, requestId);
    // Fixed words: not the name the app gives itself.
    assertEquals(payload.aps.alert, { title: "An AI connection request", body: "Open Amber Notes to see it." });
    assertEquals(Object.keys(payload).sort(), ["aps", "ask"]);
    // Apple said token 2 is gone: it's deleted.
    assertEquals((await app(pg, me.id, `select token from public.device_tokens`)).map((r: any) => r.token), [token(4)]);
  } finally {
    setPushSender(null);
  }
});

Deno.test("without an APNs key an ask still goes through, and the log says push is off", async () => {
  const { sql, pg } = await db();
  const me = await newUser(pg);
  await app(pg, me.id, `select public.register_device_token($1, 'ios', $2, 'production')`, [crypto.randomUUID(), "ef".repeat(32)]);
  const lines: string[] = [];
  const original = console.log;
  console.log = (s: string) => lines.push(s);
  setPushSender(null);
  try {
    const { requestId } = await pendingRequest(sql);
    assertEquals((await askAs(sql, me, requestId, toBase64((await newHandoffKeys()).publicRaw))).status, 200);
  } finally {
    console.log = original;
  }
  assert(lines.some((l) => JSON.parse(l).event === "push_off"));
  assert(!lines.join("").includes("ef".repeat(32)), "never the token");
});

Deno.test("a token another account registers on this device leaves the old account", async () => {
  const { pg } = await db();
  const a = await newUser(pg), b = await newUser(pg);
  const t = "cd".repeat(32);
  await app(pg, a.id, `select public.register_device_token($1, 'ios', $2, 'sandbox')`, [crypto.randomUUID(), t]);
  await app(pg, b.id, `select public.register_device_token($1, 'ios', $2, 'sandbox')`, [crypto.randomUUID(), t.toUpperCase()]);
  assertEquals((await pg.query(`select user_id from public.device_tokens`)).rows, [{ user_id: b.id }]);
});

Deno.test("device tokens: written only through the function, 10 per account, and old ones get no push", async () => {
  const { sql, pg } = await db();
  const me = await newUser(pg);
  const token = (n: number) => n.toString(16).padStart(2, "0").repeat(32);
  // Not directly: only register_device_token writes (the limits are there).
  let refusedInsert = false;
  try {
    await app(pg, me.id, `insert into public.device_tokens (user_id, device_id, platform, token, environment) values ($1, $2, 'ios', $3, 'sandbox')`,
      [me.id, crypto.randomUUID(), token(1)]);
  } catch { refusedInsert = true; }
  assert(refusedInsert, "a direct insert is refused");
  const devices = Array.from({ length: 12 }, () => crypto.randomUUID());
  for (let i = 0; i < 12; i++) {
    await app(pg, me.id, `select public.register_device_token($1, 'ios', $2, 'sandbox')`, [devices[i], token(i + 1)]);
    await pg.query(`update public.device_tokens set updated_at = now() - make_interval(mins => $1) where token = $2`, [12 - i, token(i + 1)]);
  }
  const kept = (await app(pg, me.id, `select token from public.device_tokens order by updated_at`)).map((r: any) => r.token);
  assertEquals(kept.length, 10);
  assertEquals(kept.includes(token(1)) || kept.includes(token(2)), false, "the two longest unseen went");
  let refusedUpdate = false;
  try { await app(pg, me.id, `update public.device_tokens set environment = 'production'`); } catch { refusedUpdate = true; }
  assert(refusedUpdate, "a direct update is refused");
  // The owner can still remove a row (sign-out).
  await app(pg, me.id, `delete from public.device_tokens where device_id = $1`, [devices[11]]);
  assertEquals((await app(pg, me.id, `select 1 from public.device_tokens`)).length, 9);
  // A token not seen for 90 days gets no push.
  await pg.query(`update public.device_tokens set updated_at = now() - interval '91 days' where token <> $1`, [token(11)]);
  const sent: string[] = [];
  setPushSender((p) => { sent.push(p.token); return Promise.resolve("sent"); });
  try {
    const { requestId } = await pendingRequest(sql);
    assertEquals((await askAs(sql, me, requestId, toBase64((await newHandoffKeys()).publicRaw))).status, 200);
    assertEquals(sent, [token(11)]);
  } finally {
    setPushSender(null);
  }
});

Deno.test("registering tokens is rate-limited", async () => {
  const { pg } = await db();
  const me = await newUser(pg);
  let limited = false;
  for (let i = 0; i < 40 && !limited; i++) {
    try {
      await app(pg, me.id, `select public.register_device_token($1, 'ios', $2, 'sandbox')`, [crypto.randomUUID(), (i + 16).toString(16).repeat(32).slice(0, 64)]);
    } catch (e) {
      limited = String((e as Error).message).includes("Too many");
    }
  }
  assert(limited, "30 quick registrations, then it slows down");
});

Deno.test("a device that signed out offline forgets its token later, without a session", async () => {
  const { pg } = await db();
  const me = await newUser(pg);
  const t = "ef".repeat(32);
  await app(pg, me.id, `select public.register_device_token($1, 'ios', $2, 'sandbox')`, [crypto.randomUUID(), t]);
  const anon = (sql: string, params: unknown[]) =>
    pg.transaction(async (tx) => { await tx.exec(`set local role anon`); return (await tx.query<any>(sql, params)).rows; });
  assertEquals((await anon(`select public.forget_device_token($1) as n`, ["00".repeat(32)]))[0].n, 0);
  assertEquals((await anon(`select public.forget_device_token($1) as n`, [t.toUpperCase()]))[0].n, 1);
  assertEquals((await pg.query(`select 1 from public.device_tokens`)).rows.length, 0);
});
