// Pane's MCP server: lets Claude, ChatGPT, Claude Code and Codex read and edit your notes.
//
// Transport: MCP Streamable HTTP (JSON responses). Auth: a Pane access token, sent as
// `Authorization: Bearer pane_…` or as the last path segment (for connectors that only take a URL).
// Every tool runs inside a transaction as the token's owner with row-level security on,
// so the server can only ever see that person's notes. Writes are revisioned by the database.

import postgres from "npm:postgres@3.4.5";
import { tools, runTool, ToolContext, ToolError } from "./tools.ts";

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "amber-notes", title: "Amber Notes", version: "1.0.0" };
const INSTRUCTIONS = `Amber Notes is the user's personal notes app. Notes are markdown; the first line is the title.
Start with get_overview or search_notes to find things. Read a note before editing it.
Prefer edit_note (exact find/replace) and append_to_note over replace_note_body, so nothing else changes.
Trackers are typed tables: use read_table, then log_table_row (it validates values and upserts by date).
Checklists are "- [ ] item" lines; use set_checklist_item to tick them. To tuck details into a collapsible card
(shown as a tappable card in the app), write: <details>\n<summary>Card title</summary>\n\ncontent in markdown\n\n</details>. Deleted notes go to Recently Deleted
and can be restored; every edit keeps the previous version (note_history / restore_revision).`;

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 3, idle_timeout: 20, prepare: false });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-session-id, mcp-protocol-version",
  "Access-Control-Expose-Headers": "mcp-session-id",
};

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors, ...headers } });
}

function tokenFrom(req: Request): string | null {
  const auth = req.headers.get("authorization") ?? "";
  const m = auth.match(/^Bearer\s+(pane_[0-9a-f]{64})$/i);
  if (m) return m[1];
  const last = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  return /^pane_[0-9a-f]{64}$/.test(last) ? last : null;
}

async function authenticate(token: string) {
  const rows = await sql`select * from public.resolve_mcp_token(${token})`;
  return rows[0] as { user_id: string; token_id: string; name: string; can_write: boolean } | undefined;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method === "GET") {
    // No server-initiated stream; clients fall back to plain POST.
    return new Response("Amber Notes MCP server. POST JSON-RPC here.", { status: 405, headers: { ...cors, allow: "POST" } });
  }
  if (req.method === "DELETE") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const token = tokenFrom(req);
  const who = token ? await authenticate(token).catch(() => undefined) : undefined;
  if (!who) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Missing or revoked Amber Notes access token. Create one in Amber Notes → Settings → AI access." } }, 401,
      { "www-authenticate": 'Bearer realm="pane"' });
  }

  let payload: Rpc | Rpc[];
  try {
    payload = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }

  const ctx: ToolContext = { sql, userId: who.user_id, client: who.name, canWrite: who.can_write };
  const batch = Array.isArray(payload);
  const results = (await Promise.all((batch ? payload : [payload]).map((m) => handle(m, ctx)))).filter((r) => r !== null);
  if (!results.length) return new Response(null, { status: 202, headers: cors });
  return json(batch ? results : results[0]);
});

async function handle(msg: Rpc, ctx: ToolContext): Promise<unknown | null> {
  const id = msg.id ?? null;
  const isNotification = msg.id === undefined;
  try {
    switch (msg.method) {
      case "initialize": {
        const asked = String(msg.params?.protocolVersion ?? "");
        return ok(id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions: INSTRUCTIONS,
        });
      }
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: tools.filter((t) => ctx.canWrite || t.annotations.readOnlyHint) });
      case "tools/call": {
        const name = String(msg.params?.name ?? "");
        const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
        try {
          const result = await runTool(name, args, ctx);
          return ok(id, {
            content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
            ...(typeof result === "object" && result !== null && !Array.isArray(result) ? { structuredContent: result } : {}),
          });
        } catch (e) {
          // Tool errors go back to the model as results so it can correct itself.
          const message = e instanceof ToolError || e instanceof Error ? e.message : String(e);
          return ok(id, { content: [{ type: "text", text: message }], isError: true });
        }
      }
      case "resources/list":
        return ok(id, { resources: [] });
      case "prompts/list":
        return ok(id, { prompts: [] });
      default:
        if (isNotification) return null;
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Unknown method ${msg.method}` } };
    }
  } catch (e) {
    if (isNotification) return null;
    return { jsonrpc: "2.0", id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } };
  }
}

function ok(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
