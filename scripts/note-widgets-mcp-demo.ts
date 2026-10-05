// Note page widgets (prototype): an AI giving the habit tracker a home-screen widget through the
// real MCP request handler (supabase/functions/mcp/server.ts), served over HTTP on this Mac,
// against an in-process Postgres (PGlite) with every migration. Demo data only.
//   deno run -A scripts/note-widgets-mcp-demo.ts [out.json]
// Writes the JSON-RPC exchange, and what the database holds for the widget (only a sealed box).
import { tokenKey, wrap } from "../supabase/functions/_shared/e2ee.ts";
import { schemaDB, sqlFor } from "../supabase/functions/mcp/pglite.ts";
import { account, app, note } from "../supabase/functions/mcp/sealed.ts";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "local-only");
const { handleRequest } = await import("../supabase/functions/mcp/server.ts");

const out = Deno.args[0] ?? "note-widgets-mcp.json";
const root = new URL("../", import.meta.url);
const widget = JSON.parse(await Deno.readTextFile(new URL("demo/note-pages/habit-tracker.widget.json", root)));

const body = "Habit tracker\n\nSmall things, most days. A ✓ means done.\n\n| Date | Walk | Read | Stretch | No phone in bed |\n| --- | --- | --- | --- | --- |\n| 2026-10-04 | ✓ | ✓ |  | ✓ |\n";
const pg = await schemaDB();
const sql = sqlFor(pg);
const a = await account(pg);
const id = await note(pg, a, body, { pinned: true });

const token = "pane_" + [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, "0")).join("");
await app(pg, a.id, `select public.create_mcp_token('Claude', true, $1, $2)`, [hash, await wrap(a.dk.slice(), await tokenKey(token, "pane"), "pane", a.id)]);

const server = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, (req) => {
  const u = new URL(req.url);
  return handleRequest(new Request(`http://127.0.0.1/functions/v1/mcp${u.pathname === "/" ? "" : u.pathname}`, req), sql);
});
const url = `http://127.0.0.1:${server.addr.port}/`;

const log: unknown[] = [];
let n = 0;
async function rpc(method: string, params: Record<string, unknown> = {}, note?: string) {
  const request = { jsonrpc: "2.0", id: ++n, method, params };
  const res = await fetch(url, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(request) });
  const response = await res.json();
  log.push({ note, request, status: res.status, response });
  return response.result;
}

await rpc("initialize", { protocolVersion: "2025-06-18", clientInfo: { name: "demo", version: "1" } }, "Connect");
const listed = await rpc("tools/list", {}, "set_note_widget is listed with the page tools");
const call = (name: string, args: Record<string, unknown>, why: string) => rpc("tools/call", { name, arguments: args }, why);
const bad = await call("set_note_widget", { id, widget: { small: [{ type: "webview", html: "<b>12</b>" }] } }, "A first try with a block that isn't one: refused, with the blocks there are");
const set = await call("set_note_widget", { id, widget }, "The widget: a streak ring and a Walk button (small), a week grid (medium), the Lock Screen");
const got = await call("get_note_page", { id }, "Read back with the page");

const [stored] = (await pg.query<{ widget_ct: string; client: string }>(`select widget_ct, client from public.note_pages where note_id = $1`, [id])).rows;
const summary = {
  server: "supabase/functions/mcp/server.ts handleRequest, served with Deno.serve on 127.0.0.1, PGlite database with every migration",
  tool: listed.tools.find((t: { name: string }) => t.name === "set_note_widget"),
  refused: bad.content?.[0]?.text,
  set_result: set.structuredContent,
  read_back_matches: JSON.stringify(got.structuredContent.widget) === JSON.stringify(widget),
  stored: { client: stored.client, widget_ct_prefix: stored.widget_ct.slice(0, 60) + "…", widget_ct_bytes: stored.widget_ct.length, opens_to_same_spec: (await a.vault.openWidget(id, stored.widget_ct)) === JSON.stringify(widget) },
};
await Deno.writeTextFile(out, JSON.stringify({ summary, exchange: log, note_body: body }, null, 2));
await server.shutdown();
console.log(JSON.stringify({ ...summary, tool: { name: summary.tool?.name, annotations: summary.tool?.annotations } }, null, 2));
