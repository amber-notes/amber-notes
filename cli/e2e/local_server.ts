// For local testing only: the real MCP server (supabase/functions/mcp/server.ts, its request
// handler and OAuth unchanged, files tools on) over HTTP, on an in-process Postgres with every
// migration (pglite.ts), with a seeded, end-to-end encrypted test account. No Docker, no Supabase,
// nothing remote.
//
//   deno run -A cli/e2e/local_server.ts --port 8787 [--token-file <path>]
//
// What production gets from elsewhere is stood in for here, and only that:
// - GET /auth/v1/user answers for the test account's session ("Bearer jwt-<user id>"), as Supabase Auth would.
// - GET /connect is the consent step: ambernotes.app/connect plus the app's approval sheet in one
//   page. Allow does what the app does: GET /connect/request and POST /connect/decide with a code
//   it makes and the data key wrapped under it, then sends the browser to the redirect with the code.
// - GET /__app/connections and POST /__app/revoke are Settings › Connect an AI: the list the app
//   shows, and its Disconnect (the same update of mcp_tokens, as the signed-in person).
// --token-file writes a pane_ access token (made as Settings › Connect an AI makes one) for
// `amber login --token`; it's never printed.
import { parseArgs } from "@std/cli/parse-args";

const args = parseArgs(Deno.args, { string: ["port", "token-file"] });
const port = Number(args.port ?? 8787);
const base = `http://127.0.0.1:${port}`;
Deno.env.set("MCP_PUBLIC_URL", `${base}/mcp`);
Deno.env.set("SUPABASE_URL", base);
Deno.env.set("SUPABASE_ANON_KEY", "local");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "local");
Deno.env.set("CONNECT_PAGE_URL", `${base}/connect`);
Deno.env.set("AMBER_MCP_TOOLS", "files");

const mcp = "../../supabase/functions/mcp";
const { schemaDB, sqlFor } = await import(`${mcp}/pglite.ts`);
const { account, app, folder, lockedNote, note, notesPassword } = await import(`${mcp}/sealed.ts`);
const { hex, tokenKey, wrap } = await import("../../supabase/functions/_shared/e2ee.ts");
const { handleRequest } = await import(`${mcp}/server.ts`);

const pg = await schemaDB();
const a = await account(pg);
const session = `Bearer jwt-${a.id}`;
const sha256 = async (s: string) => hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));

if (args["token-file"]) {
  const token = `pane_${hex(crypto.getRandomValues(new Uint8Array(32)))}`;
  await app(pg, a.id, `select public.create_mcp_token('Access token', true, $1, $2)`, [await sha256(token), await wrap(a.dk.slice(), await tokenKey(token, "pane"), "pane", a.id)]);
  await Deno.writeTextFile(args["token-file"], token, { mode: 0o600 });
}

// The seeded account.
const work = await folder(pg, a, "Work");
const clients = await folder(pg, a, "Clients", work);
const travel = await folder(pg, a, "Travel");
await note(pg, a, "Groceries\n\n## Dairy\n- [ ] Milk\n- [ ] Butter\n\nSee [[Recipes]] for ideas.\n", { pinned: true });
await note(pg, a, "Recipes\n\n- Shakshuka\n- Pasta e ceci\n");
await note(pg, a, "# Acme\n\nKickoff Monday 10:00 with Dana and Lee.\n\n## Open questions\n- Budget for Q1?\n- Who owns the rollout?\n", { folder: clients });
await note(pg, a, "Weekly review\n\n- [ ] Inbox zero\n- [ ] Plan next week\n", { folder: work });
const trip = await note(pg, a, "Trip\n\nLisbon in May.\n", { folder: travel });
await note(pg, a, "Packing\n\n- [ ] Passport\n- [ ] Charger\n", { folder: travel, parent: trip });
await lockedNote(pg, a, await notesPassword(pg, a), "Diary", { folder: work });

const sql = sqlFor(pg);
const local = (path: string, init: RequestInit = {}) => handleRequest(new Request(`${base}/mcp${path}`, init), sql);
const html = (body: string) => new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
const esc = (s: string) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));

const STYLE = `<style>
:root{--bg:#f6f4ef;--card:#fff;--fg:#1c1a16;--muted:#6d675c;--line:#e3ded3;--accent:#c8790b;--warn:#b25e00;color-scheme:light;font:15px/1.45 -apple-system,system-ui,sans-serif}
@media (prefers-color-scheme:dark){:root{--bg:#141310;--card:#1f1d19;--fg:#eee9df;--muted:#a59d8f;--line:#35312a;--accent:#f0a33a;--warn:#f0a33a;color-scheme:dark}}
body{margin:0;background:var(--bg);color:var(--fg);display:grid;place-items:center;min-height:100vh;padding:24px;box-sizing:border-box}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:28px 26px;max-width:360px;width:100%;display:flex;flex-direction:column;gap:14px;text-align:center}
.marks{display:flex;justify-content:center;align-items:center;gap:14px;font-size:26px}.tile{width:56px;height:56px;border-radius:17px;display:grid;place-items:center;background:var(--line)}
.amber{background:var(--accent);color:#fff;font-weight:700}
h1{font-size:21px;margin:0;font-weight:600;text-wrap:balance}.warn{color:var(--warn);font-size:13px;text-align:left}
button{font:inherit;border:0;border-radius:12px;padding:12px;cursor:pointer;width:100%}.allow{background:var(--accent);color:#fff;font-weight:600}.deny{background:none;color:var(--accent)}
.seg{display:flex;border:1px solid var(--line);border-radius:9px;overflow:hidden}.seg label{flex:1;padding:6px;font-size:13px;cursor:pointer}.seg input{display:none}.seg input:checked+span{font-weight:600}
.seg label:has(input:checked){background:var(--line)}.fine{font-size:12px;color:var(--muted)}.stand{font-size:11px;color:var(--muted);border-top:1px solid var(--line);padding-top:10px}
</style>`;

async function connectPage(id: string): Promise<Response> {
  const r = await (await local(`/connect/request?id=${encodeURIComponent(id)}`, { headers: { authorization: session } })).json();
  if (r.error) return html(`${STYLE}<div class="card"><h1>Couldn't connect</h1><p>${esc(r.error)}</p></div>`);
  return html(`<!doctype html><meta name="viewport" content="width=device-width"><title>Connect to Amber Notes</title>${STYLE}
<form class="card" method="post" action="/connect/answer">
  <div class="marks"><div class="tile">${r.loopback ? "&#x1F5A5;&#xFE0E;" : "&#x1F310;&#xFE0E;"}</div><span class="fine">&#x1F517;&#xFE0E;</span><div class="tile amber">A</div></div>
  <h1>Allow ${esc(r.verified_ai ?? (r.loopback ? "an app on this computer" : r.redirect_host))} to use your notes?</h1>
  ${r.verified_ai ? "" : `<div class="warn">&#x26A0;&#xFE0E; Amber Notes doesn't recognize this app. Only allow it if you just started connecting it.${r.claimed_name ? ` It calls itself "${esc(r.claimed_name)}".` : ""}</div>`}
  <input type="hidden" name="id" value="${esc(r.id)}">
  <button class="allow" name="allow" value="1" id="allow">Allow</button>
  <button class="deny" name="allow" value="0" id="deny">Don't Allow</button>
  <div class="seg"><label><input type="radio" name="write" value="1" ${r.wants_write ? "checked" : "disabled"}><span>Read and edit</span></label><label><input type="radio" name="write" value="0" ${r.wants_write ? "" : "checked"}><span>Read only</span></label></div>
  <div class="fine">Access goes to <b>${esc(r.redirect_host)}</b>. Locked notes stay private.</div>
  <div class="stand">Local test stand-in for ambernotes.app/connect and the approval sheet in the Amber Notes app.</div>
</form>`);
}

/** What the app does on Allow or Don't Allow. */
async function answer(form: FormData): Promise<Response> {
  const id = String(form.get("id"));
  const r = await (await local(`/connect/request?id=${encodeURIComponent(id)}`, { headers: { authorization: session } })).json();
  if (r.error) return html(`${STYLE}<div class="card"><h1>Couldn't connect</h1><p>${esc(r.error)}</p></div>`);
  const allow = form.get("allow") === "1";
  const code = `amb_code_${hex(crypto.getRandomValues(new Uint8Array(32)))}`;
  const decided = await (await local("/connect/decide", {
    method: "POST", headers: { authorization: session, "content-type": "application/json" },
    body: JSON.stringify({ id, allow, write: form.get("write") === "1", redirect_uri: r.redirect_uri,
      ...(allow ? { code_hash: await sha256(code), code_wrap: await wrap(a.dk.slice(), await tokenKey(code, "code"), "code", a.id) } : {}) }),
  })).json();
  if (!decided.redirect) return html(`${STYLE}<div class="card"><h1>Couldn't connect</h1><p>${esc(decided.error ?? "")}</p></div>`);
  const back = new URL(decided.redirect);
  if (allow) back.searchParams.set("code", code);
  return new Response(null, { status: 302, headers: { location: back.toString() } });
}

/** Settings › Connect an AI: titled as the app titles them (ConnectAI.swift, Connection.title). */
async function connections() {
  const rows = await app(pg, a.id, `select id, name, kind, can_write, redirect_host, created_at, last_used_at, revoked_at from public.mcp_tokens order by created_at`);
  const loop = (h: string | null) => ["localhost", "127.0.0.1", "[::1]", "::1"].includes(String(h).toLowerCase());
  return rows.map((c: Record<string, unknown>) => ({
    id: c.id, title: c.kind === "oauth" ? (loop(c.redirect_host as string) ? "An app on this computer" : c.redirect_host) : c.name,
    access: c.can_write ? "Read and edit" : "Read only", connected: c.created_at, last_used: c.last_used_at, revoked: c.revoked_at !== null,
  }));
}

Deno.serve({ port, hostname: "127.0.0.1", onListen: () => console.log(`local Amber Notes MCP server on ${base}/mcp (files tools, OAuth on)`) }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/__ready") return new Response("ok");
  if (url.pathname === "/auth/v1/user") return req.headers.get("authorization") === session ? Response.json({ id: a.id }) : Response.json({}, { status: 401 });
  if (url.pathname === "/connect" && req.method === "GET") return url.searchParams.get("request") ? await connectPage(url.searchParams.get("request")!) : html(`${STYLE}<div class="card"><h1>Couldn't connect</h1><p>${esc(url.searchParams.get("problem") ?? "")}</p></div>`);
  if (url.pathname === "/connect/answer" && req.method === "POST") return await answer(await req.formData());
  if (url.pathname === "/__app/connections") return Response.json(await connections());
  if (url.pathname === "/__app/revoke" && req.method === "POST") {
    const { id } = await req.json();
    await app(pg, a.id, `update public.mcp_tokens set revoked_at = now() where id = $1`, [id]);
    return Response.json({ revoked: id });
  }
  return await handleRequest(req, sql);
});
