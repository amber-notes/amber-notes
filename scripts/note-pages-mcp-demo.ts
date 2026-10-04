// Note pages (prototype): an AI making a habit tracker page through the real MCP request handler
// (supabase/functions/mcp/server.ts), served over HTTP on this Mac, against an in-process Postgres
// (PGlite) with every migration. No Docker, no hosted backend, demo data only.
//   deno run -A scripts/note-pages-mcp-demo.ts [out.json]
// Writes the JSON-RPC exchange, and what the database holds for the page (only a sealed box).
import { tokenKey, toBase64, wrap } from "../supabase/functions/_shared/e2ee.ts";
import { schemaDB, sqlFor } from "../supabase/functions/mcp/pglite.ts";
import { account, app, note } from "../supabase/functions/mcp/sealed.ts";

Deno.env.set("SUPABASE_URL", "http://127.0.0.1");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "local-only");
const { handleRequest } = await import("../supabase/functions/mcp/server.ts");

const out = Deno.args[0] ?? "note-pages-mcp.json";
const root = new URL("../", import.meta.url);
const pageHTML = await Deno.readTextFile(new URL("demo/note-pages/habit-tracker.html", root));

// The habit tracker as the app's demo seeds it (Capture.habitNote).
const pad = (n: number) => String(n).padStart(2, "0");
const day = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const marks = ["✓✓·✓", "✓✓✓✓", "·✓✓·", "✓✓✓✓", "✓·✓✓", "✓✓✓·", "··✓✓", "✓✓✓✓", "✓✓·✓", "✓✓✓✓", "✓·✓✓", "✓✓✓✓", "✓✓✓·", "✓✓✓✓", "✓···"];
const rows = marks.map((m, i) => {
  const d = new Date(); d.setDate(d.getDate() + i - (marks.length - 1));
  return `| ${day(d)} | ` + [...m].map((c) => (c === "✓" ? "✓" : " ")).join(" | ") + " |";
});
const body = "Habit tracker\n\nSmall things, most days. A ✓ means done.\n\n| Date | Walk | Read | Stretch | No phone in bed |\n| --- | --- | --- | --- | --- |\n" + rows.join("\n") + "\n";

const pg = await schemaDB();
const sql = sqlFor(pg);
const a = await account(pg);
const id = await note(pg, a, body, { pinned: true });

// A Claude Code style token, its wrap of the account key made as the app makes it.
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
const listed = await rpc("tools/list", {}, "The page tools are listed with the rest");
const call = (name: string, args: Record<string, unknown>, why: string) => rpc("tools/call", { name, arguments: args }, why);
await call("read_note", { title: "Habit tracker" }, "Claude reads the note first");
await call("set_note_page", { id, html: pageHTML.replace("<main", `<link rel="stylesheet" href="https://fonts.example.com/inter.css"><main`) },
  "A first try that loads a web font: refused, with the reason");
const set = await call("set_note_page", { id, html: pageHTML }, "The page, self-contained");
const got = await call("get_note_page", { id }, "Read back");
const reread = await call("read_note", { id }, "read_note now says the note has a page; its markdown is unchanged");

const [stored] = (await pg.query<{ page_ct: string; client: string }>(`select page_ct, client from public.note_pages where note_id = $1`, [id])).rows;
const opened = await a.vault.openPage(id, stored.page_ct);
const summary = {
  server: "supabase/functions/mcp/server.ts handleRequest, served with Deno.serve on 127.0.0.1, PGlite database with every migration",
  tools: listed.tools.filter((t: { name: string }) => t.name.endsWith("note_page")).map((t: { name: string; annotations: unknown }) => ({ name: t.name, annotations: t.annotations })),
  set_result: set.structuredContent,
  get_has_page: got.structuredContent.has_page,
  markdown_unchanged: reread.structuredContent.markdown === body,
  stored: { client: stored.client, page_ct_prefix: stored.page_ct.slice(0, 60) + "…", page_ct_bytes: stored.page_ct.length, opens_to_same_html: opened === pageHTML },
};
await Deno.writeTextFile(out, JSON.stringify({ summary, exchange: log, note_body: body }, null, 2));
await server.shutdown();
console.log(JSON.stringify(summary, null, 2));
