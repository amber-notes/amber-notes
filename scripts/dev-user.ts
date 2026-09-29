// Creates test users on the LOCAL Supabase stack and prints shell exports for the MCP tests.
//   eval "$(deno run -A scripts/dev-user.ts)"
// Refuses to run against anything but 127.0.0.1, so it can never touch production.
import postgres from "npm:postgres@3.4.5";

const status = new TextDecoder().decode((await new Deno.Command("supabase", { args: ["status", "-o", "env"], stderr: "null" }).output()).stdout);
const env = Object.fromEntries(status.split("\n").filter((l) => l.includes("=")).map((l) => {
  const i = l.indexOf("=");
  return [l.slice(0, i), l.slice(i + 1).replace(/^"|"$/g, "")];
}));
const api = env.API_URL, anon = env.ANON_KEY, service = env.SERVICE_ROLE_KEY, db = env.DB_URL;
if (!api || !/^http:\/\/127\.0\.0\.1:/.test(api)) throw new Error(`Not a local stack: ${api}. Run supabase start.`);

const sql = postgres(db, { max: 1, prepare: false });
const password = "pane-dev-password-1";

async function user(email: string) {
  await sql`insert into public.signup_allowlist (email) values (${email}) on conflict do nothing`;
  const created = await fetch(`${api}/auth/v1/admin/users`, {
    method: "POST",
    headers: { authorization: `Bearer ${service}`, apikey: service, "content-type": "application/json" },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  await created.body?.cancel();
  const login = await fetch(`${api}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then((r) => r.json());
  if (!login.access_token) throw new Error(`Sign-in failed for ${email}: ${JSON.stringify(login)}`);
  return login.access_token as string;
}

async function token(jwt: string, name: string, write: boolean) {
  const res = await fetch(`${api}/rest/v1/rpc/create_mcp_token`, {
    method: "POST",
    headers: { authorization: `Bearer ${jwt}`, apikey: anon, "content-type": "application/json" },
    body: JSON.stringify({ token_name: name, write_access: write }),
  });
  if (!res.ok) throw new Error(`create_mcp_token: ${await res.text()}`);
  return (await res.json()) as string;
}

try {
  const a = await user(Deno.env.get("PANE_EMAIL") ?? "dev@pane.local");
  const b = await user("other@pane.local");
  // Each run makes fresh tokens; retire the last run's so the 50-connection limit and
  // the token rate limit never trip on test users.
  await sql`update public.mcp_tokens set revoked_at = now() where revoked_at is null
            and user_id in (select id from auth.users where email in ('dev@pane.local', 'other@pane.local', ${Deno.env.get("PANE_EMAIL") ?? "dev@pane.local"}))`;
  await sql`delete from public.pane_rate where user_id in (select id from auth.users where email in ('dev@pane.local', 'other@pane.local'))`;
  const out = {
    PANE_API: api,
    PANE_ANON: anon,
    PANE_DB_URL: db,
    PANE_MCP_URL: `${api}/functions/v1/mcp`,
    PANE_USER_JWT: a,
    PANE_OTHER_JWT: b,
    PANE_TOKEN: await token(a, "Claude Code (test)", true),
    PANE_READONLY_TOKEN: await token(a, "Read-only (test)", false),
    PANE_OTHER_TOKEN: await token(b, "Other user (test)", false),
    PANE_OTHER_WRITE_TOKEN: await token(b, "Other user writer (test)", true),
  };
  for (const [k, v] of Object.entries(out)) console.log(`export ${k}='${v}'`);
} finally {
  await sql.end();
}
