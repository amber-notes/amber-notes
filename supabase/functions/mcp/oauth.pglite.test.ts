// OAuth for AI connectors (oauth.ts) on an in-process Postgres (PGlite), with Supabase Auth faked.
// Needs no Docker or local stack:
//   cd supabase/functions/mcp && deno test -A oauth.pglite.test.ts
// Covers the custom address (mcp.ambernotes.app through the site's proxy), the web consent page's
// calls, and who may answer a request. oauth.e2e.test.ts runs the app's flow against the real stack.
import { assert, assertEquals, assertMatch } from "jsr:@std/assert@1";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import type { Sql } from "npm:postgres@3.4.5";

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

const { handleOAuth, publicBase, resolveAccessToken, subpath, clientIP, cleanName, claimsATrustedName, displayName, claimedName } = await import("./oauth.ts");

// MARK: Database

const migrations = [
  "20260927190000_mcp_tokens.sql",
  "20260928220500_mcp_token_columns.sql",
  "20260928222800_oauth_connectors.sql",
  "20260930140000_oauth_request_claims.sql",
].map((f) => new URL(`../../migrations/${f}`, import.meta.url));

const stubs = `
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema extensions;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as
    $$ select (nullif(current_setting('request.jwt.claims', true), '')::json->>'sub')::uuid $$;
  create function extensions.digest(t text, alg text) returns bytea language sql immutable as $$ select sha256(convert_to(t, 'UTF8')) $$;
  create function extensions.gen_random_bytes(n int) returns bytea language sql as $$ select decode(md5(random()::text), 'hex') $$;
`;

/// The subset of postgres.js oauth.ts uses (tagged queries and begin), backed by PGlite.
function adapter(pg: PGlite): Sql {
  type Q = { query: PGlite["query"] };
  const run = (db: Q) => async (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = strings[0];
    values.forEach((_, i) => (text += `$${i + 1}` + strings[i + 1]));
    return (await db.query(text, values)).rows;
  };
  const sql = Object.assign(run(pg), {
    begin: (fn: (tx: unknown) => unknown) => pg.transaction((tx) => fn(run(tx)) as Promise<unknown>),
  });
  return sql as unknown as Sql;
}

async function db() {
  const pg = new PGlite();
  await pg.exec(stubs);
  for (const m of migrations) await pg.exec(await Deno.readTextFile(m));
  return { pg, sql: adapter(pg) };
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

async function newUser(pg: PGlite) {
  const id = crypto.randomUUID();
  await pg.query(`insert into auth.users (id) values ($1)`, [id]);
  return { id, jwt: `jwt-${id}` };
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

/// What the web page does: ask who's asking, then answer, from the site's origin.
async function consent(sql: Sql, requestId: string, jwt: string, allow = true, origin: string | null = SITE) {
  const headers: Record<string, string> = { authorization: `Bearer ${jwt}` };
  if (origin) headers.origin = origin;
  const described = await call(sql, request("function", `/connect/request?id=${requestId}`, { headers }));
  const decided = await call(sql, request("function", "/connect/decide", {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ id: requestId, allow, write: true }),
  }));
  return { described, decided };
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
  const { described, decided } = await consent(sql, requestId, me.jwt);
  assertEquals(described.status, 200);
  assertEquals(decided.status, 200);
  const back = new URL((await decided.json()).redirect);
  return { clientId, verifier, back, me };
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
  const theirs = await consent(sql, requestId, other.jwt);
  assertEquals(theirs.described.status, 403);
  assertEquals(theirs.decided.status, 403);
  const mine = await consent(sql, requestId, owner.jwt);
  assertEquals(mine.decided.status, 200);
  // Answered once; a second answer finds nothing to answer.
  const again = await consent(sql, requestId, owner.jwt);
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
  const elsewhere = await consent(sql, requestId, me.jwt, true, "https://evil.example");
  assertEquals(elsewhere.described.status, 403);
  assertEquals(elsewhere.decided.status, 403);
  // The apps send no Origin at all.
  const app = await consent(sql, requestId, me.jwt, true, null);
  assertEquals(app.decided.status, 200);
});

Deno.test("Don't Allow sends access_denied back, with the alias as issuer", async () => {
  const { sql, pg } = await db();
  const clientId = await register(sql, "proxy");
  const res = await authorize(sql, "proxy", clientId, (await pkce()).challenge);
  const requestId = new URL(res.headers.get("location")!).searchParams.get("request")!;
  const me = await newUser(pg);
  const { decided } = await consent(sql, requestId, me.jwt, false);
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
    body: JSON.stringify({ id: mixed.requestId, allow: true, write: false }),
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
  const { decided } = await consent(sql, requestId, me.jwt);
  return { clientId, verifier, code: new URL((await decided.json()).redirect).searchParams.get("code")!, me };
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
  const { decided } = await consent(sql, requestId, second.jwt);
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
  // "OpenAl" (lower-case L), "CIaude" (capital i), Cyrillic Т, a combining mark, small-capital ʟ, Cherokee Ꮯ.
  const names = ["OpenAl", "CIaude", "ChatGP\u0422", "C\u0301laude", "C\u029Faude", "\u13DFlaude"];
  for (const name of names) {
    const { requestId, me, details } = await ask(sql, pg, name, ["https://attacker.example/cb"]);
    assertEquals(details.client_name, "attacker.example", name);
    assertEquals(details.verified_ai, null, name);
    // Some are renamed at registration already (defence in depth); either way the claim is plain.
    assert(details.claimed_name === null || /^[a-z0-9 .,:;'&()+_!?-]+$/.test(details.claimed_name), `${name}: ${details.claimed_name}`);
    const decided = await call(sql, request("function", "/connect/decide", {
      method: "POST", headers: { authorization: `Bearer ${me.jwt}`, origin: SITE, "content-type": "application/json" },
      body: JSON.stringify({ id: requestId, allow: true, write: false }),
    }));
    assertEquals((await decided.json()).client_name, "attacker.example", name);
    const [{ title }] = await sql`select name as title from public.mcp_tokens where user_id = ${me.id}` as { title: string }[];
    assertEquals(title, "attacker.example", name);
  }
  // NFKC composes C + a combining accent into one non-ASCII letter, which shows as "?".
  assertEquals(claimedName("C\u0301laude"), "?laude");
  assertEquals(claimedName("Cla\u20DDude"), "claude");
  assertEquals(claimedName("\u13DFlaude"), "?laude");
  assertEquals(claimedName("C\u029Faude"), "c?aude");
  assertEquals(claimedName("ChatGP\u0422"), "chatgp?");
  assertEquals(claimedName("Notes Helper 2"), "notes helper 2");
});
