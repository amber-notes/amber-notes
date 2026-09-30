// A stand-in Supabase for trying the web consent page (web/app/connect) without Docker: the real
// OAuth code (supabase/functions/mcp/oauth.ts) on an in-process Postgres (PGlite), and a fake
// Supabase Auth with one account. Nothing here touches a real project.
//
//   deno run -A scripts/connect-lab.ts            # serves http://127.0.0.1:54999
//   cd web && SUPABASE_URL=http://127.0.0.1:54999 SUPABASE_ANON_KEY=lab MCP_PROXY_SECRET=lab pnpm build
//   SUPABASE_URL=http://127.0.0.1:54999 SUPABASE_ANON_KEY=lab MCP_PROXY_SECRET=lab pnpm start -p 5299
//
// Then GET http://127.0.0.1:54999/lab/start: it registers a client, starts /authorize the way
// ChatGPT would, and redirects to the consent page. Sign in as lab@example.com / "correct horse
// battery staple", or with Apple (the lab skips Apple's page). After Allow, the browser lands on /lab/callback, which exchanges the code and
// shows the result. curl -H "Host: mcp.ambernotes.app" http://localhost:5299/.well-known/oauth-authorization-server
// shows the proxy's metadata.
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import type { Sql } from "npm:postgres@3.4.5";

const PORT = Number(Deno.env.get("LAB_PORT") ?? 54999);
const SITE = Deno.env.get("LAB_SITE") ?? "http://localhost:5299";
const HERE = `http://127.0.0.1:${PORT}`;
const EMAIL = "lab@example.com";
const PASSWORD = "correct horse battery staple";
const USER = "7f1d9c1e-7c2a-4c8e-9a53-3f0b8d2c9e11";

Deno.env.set("SUPABASE_URL", HERE);
Deno.env.set("SUPABASE_ANON_KEY", "lab");
Deno.env.set("CONNECT_PAGE_URL", `${SITE}/connect`);
Deno.env.set("MCP_PROXY_SECRET", "lab");
const { handleOAuth, subpath, resolveAccessToken } = await import("../supabase/functions/mcp/oauth.ts");

const pg = new PGlite();
await pg.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema extensions;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
  create function extensions.digest(t text, alg text) returns bytea language sql immutable as $$ select sha256(convert_to(t, 'UTF8')) $$;
  create function extensions.gen_random_bytes(n int) returns bytea language sql as $$ select decode(md5(random()::text), 'hex') $$;
`);
for (const f of ["20260927190000_mcp_tokens.sql", "20260928220500_mcp_token_columns.sql", "20260928222800_oauth_connectors.sql", "20260930140000_oauth_request_claims.sql"]) {
  await pg.exec(await Deno.readTextFile(new URL(`../supabase/migrations/${f}`, import.meta.url)));
}
await pg.query(`insert into auth.users (id) values ($1)`, [USER]);

type Q = { query: PGlite["query"] };
const run = (db: Q) => async (strings: TemplateStringsArray, ...values: unknown[]) => {
  let text = strings[0];
  values.forEach((_, i) => (text += `$${i + 1}` + strings[i + 1]));
  return (await db.query(text, values)).rows;
};
const sql = Object.assign(run(pg), {
  begin: (fn: (tx: unknown) => unknown) => pg.transaction((tx) => fn(run(tx)) as Promise<unknown>),
}) as unknown as Sql;

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "authorization, apikey, content-type, x-client-info",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: cors });
const REDIRECT = `${HERE}/lab/callback`;
let lab: { clientId: string; verifier: string } | undefined;
const appleCodes = new Map<string, string>();

function b64url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

Deno.serve({ port: PORT, hostname: "127.0.0.1" }, async (req) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS" && url.pathname.startsWith("/auth/")) return new Response(null, { status: 204, headers: cors });

  // Fake Supabase Auth: one account; a session is "jwt-<user id>". Apple's page is skipped: the
  // browser comes straight back with a code bound to the PKCE challenge.
  if (url.pathname === "/auth/v1/authorize") {
    const code = crypto.randomUUID();
    appleCodes.set(code, url.searchParams.get("code_challenge") ?? "");
    const back = new URL(url.searchParams.get("redirect_to")!);
    back.searchParams.set("code", code);
    return Response.redirect(back.toString(), 302);
  }
  if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "pkce") {
    const b = await req.json().catch(() => ({}));
    const challenge = appleCodes.get(b.auth_code);
    appleCodes.delete(b.auth_code);
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(b.code_verifier))));
    if (!challenge || b64url(digest) !== challenge) return json({ error_code: "bad_code_verifier", msg: "invalid" }, 400);
    return json({ access_token: `jwt-${USER}`, token_type: "bearer", user: { id: USER, email: "apple-relay@privaterelay.appleid.com" } });
  }
  if (url.pathname === "/auth/v1/token") {
    const b = await req.json().catch(() => ({}));
    if (b.email !== EMAIL || b.password !== PASSWORD) return json({ error_code: "invalid_credentials", msg: "Invalid login credentials" }, 400);
    return json({ access_token: `jwt-${USER}`, token_type: "bearer", user: { id: USER, email: EMAIL } });
  }
  if (url.pathname === "/auth/v1/user") {
    const m = (req.headers.get("authorization") ?? "").match(/^Bearer jwt-([0-9a-f-]{36})$/);
    return m ? json({ id: m[1], email: EMAIL }) : json({ msg: "invalid JWT" }, 401);
  }
  if (url.pathname === "/auth/v1/logout") return new Response(null, { status: 204, headers: cors });

  // The ChatGPT side: start connecting, and take the code back.
  if (url.pathname === "/lab/start") {
    const reg = await handleOAuth(new Request(`${HERE}/functions/v1/mcp/register`, {
      method: "POST", headers: { "content-type": "application/json", host: `127.0.0.1:${PORT}` },
      body: JSON.stringify({ client_name: "Lab Client", redirect_uris: [REDIRECT] }),
    }), sql, "/register");
    const clientId = (await reg.json()).client_id;
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    lab = { clientId, verifier };
    const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, code_challenge: challenge, code_challenge_method: "S256", state: "lab", scope: "notes:read notes:write" });
    return Response.redirect(`${HERE}/functions/v1/mcp/authorize?${q}`, 302);
  }
  if (url.pathname === "/lab/callback") {
    const code = url.searchParams.get("code");
    const result: Record<string, unknown> = Object.fromEntries(url.searchParams);
    if (code && lab) {
      const t = await handleOAuth(new Request(`${HERE}/functions/v1/mcp/token`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", host: `127.0.0.1:${PORT}` },
        body: new URLSearchParams({ grant_type: "authorization_code", client_id: lab.clientId, code, code_verifier: lab.verifier, redirect_uri: REDIRECT }),
      }), sql, "/token");
      const tokens = await t.json();
      const grant = tokens.access_token ? await resolveAccessToken(sql, tokens.access_token, new Request(`${HERE}/functions/v1/mcp`, { headers: { host: `127.0.0.1:${PORT}` } })) : undefined;
      result.token_status = t.status;
      result.scope = tokens.scope;
      result.grant_user = grant?.user_id;
      result.can_write = grant?.can_write;
      delete result.code;
    }
    return new Response(`<!doctype html><title>Lab callback</title><pre id="result">${JSON.stringify(result, null, 2)}</pre>`, { headers: { "content-type": "text/html" } });
  }

  // The MCP function (its OAuth half).
  if (url.pathname.startsWith("/functions/v1/mcp")) {
    const path = subpath(req);
    return await handleOAuth(req, sql, path);
  }
  return new Response("Not found", { status: 404 });
});
console.log(`connect lab on ${HERE} (consent page at ${SITE}/connect)`);
