// Pane's MCP server: lets Claude, ChatGPT, Claude Code and Codex read and edit your notes.
//
// Transport: MCP Streamable HTTP (JSON responses). Auth: an OAuth access token from signing in
// (ChatGPT, Claude; see oauth.ts), or an Amber Notes access token sent as `Authorization: Bearer pane_…`
// (Claude Code, Codex). Older setups put the token in the URL; that still works but is flagged in the app.
// Every tool runs inside a transaction as the token's owner with row-level security on,
// so the server can only ever see that person's notes. Writes are revisioned by the database.

import postgres from "npm:postgres@3.4.5";
import { tools, runTool, ToolContext, ToolError } from "./tools.ts";
import { challenge, handleOAuth, isOAuthPath, publicBase, resolveAccessToken, subpath } from "./oauth.ts";
import { OPENAI_CHALLENGE_PATH, openaiChallenge } from "./verification.ts";

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
const SERVER_INFO = { name: "amber-notes", title: "Amber Notes", version: "1.0.0" };
const INSTRUCTIONS = `Amber Notes is the user's personal notes app. Notes are markdown; the first line is the title.
Start with get_overview or search_notes to find things. Read a note before editing it.
Prefer edit_note (exact find/replace) and append_to_note over replace_note_body, so nothing else changes.
Tables are markdown tables; trackers are tables with typed columns. Use read_table, then log_table_row (it validates values and, in trackers, upserts by date).
Checklists are "- [ ] item" lines; use set_checklist_item to tick them. A line like [Title](pane-note:<id>) links a sub-note: a whole note that lives inside
its parent. Use create_sub_note to make one; read it with read_note(id). Deleted notes go to Recently Deleted
and can be restored; every edit keeps the previous version (note_history / restore_revision).
A note marked locked: true is locked by the user: its text is encrypted on their devices, so only its title is visible here.
It can't be read, searched or changed here; only the user can open it, in Amber Notes.`;

const sql = postgres(Deno.env.get("SUPABASE_DB_URL")!, { max: 3, idle_timeout: 20, prepare: false });

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "authorization, content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version, www-authenticate",
  "Access-Control-Max-Age": "86400",
};

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors, ...headers } });
}

type Presented = { token: string; oauth: boolean; inURL: boolean };

function tokenFrom(req: Request): Presented | null {
  const auth = req.headers.get("authorization") ?? "";
  const oauth = auth.match(/^Bearer\s+(amb_at_[0-9a-f]{64})$/i);
  if (oauth) return { token: oauth[1], oauth: true, inURL: false };
  const m = auth.match(/^Bearer\s+(pane_[0-9a-f]{64})$/i);
  if (m) return { token: m[1], oauth: false, inURL: false };
  const last = new URL(req.url).pathname.split("/").filter(Boolean).pop() ?? "";
  return /^pane_[0-9a-f]{64}$/.test(last) ? { token: last, oauth: false, inURL: true } : null;
}

async function authenticate(p: Presented, req: Request) {
  if (p.oauth) return await resolveAccessToken(sql, p.token, req);
  const rows = await sql`select * from public.resolve_mcp_token(${p.token})`;
  const who = rows[0] as { user_id: string; token_id: string; name: string; can_write: boolean } | undefined;
  // A token in the URL ends up in logs and histories: remember it so the app can say so.
  if (who && p.inURL) await sql`update public.mcp_tokens set url_used_at = now() where id = ${who.token_id} and url_used_at is null`;
  return who;
}

Deno.serve(async (req) => {
  const path = subpath(req);
  if (path === OPENAI_CHALLENGE_PATH) return openaiChallenge(Deno.env.get("OPENAI_APPS_CHALLENGE"));
  if (isOAuthPath(path)) return handleOAuth(req, sql, path);
  const base = publicBase(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  const presented = tokenFrom(req);
  // Clients learn how to sign in from a 401, so anything unauthenticated gets one.
  if (!presented && (req.method === "GET" || req.method === "POST")) return unauthorized(base);
  if (req.method === "GET") {
    // No server-initiated stream; clients fall back to plain POST.
    return new Response("Amber Notes MCP server. POST JSON-RPC here.", { status: 405, headers: { ...cors, allow: "POST" } });
  }
  if (req.method === "DELETE") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const who = presented ? await authenticate(presented, req).catch((e) => { console.error("token lookup failed:", (e as Error).message); return undefined; }) : undefined;
  if (!who) return unauthorized(base, presented ? "invalid_token" : undefined);

  // A client that names a protocol version we don't speak gets told so up front.
  const version = req.headers.get("mcp-protocol-version");
  if (version && !PROTOCOL_VERSIONS.includes(version)) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `Unsupported MCP-Protocol-Version ${version}. Supported: ${PROTOCOL_VERSIONS.join(", ")}.` } }, 400);
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }
  if (Array.isArray(payload) && !payload.length) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request: empty batch" } }, 400);
  }

  const ctx: ToolContext = { sql, userId: who.user_id, client: who.name, canWrite: who.can_write };
  const batch = Array.isArray(payload);
  // Messages in a batch run one after another, so writes land in the order they were sent.
  const results: unknown[] = [];
  for (const m of batch ? (payload as unknown[]) : [payload]) {
    const r = await handle(m, ctx);
    if (r !== null) results.push(r);
  }
  if (!results.length) return new Response(null, { status: 202, headers: cors });
  return json(batch ? results : results[0]);
});

function unauthorized(base: string, error?: string) {
  return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Sign in to Amber Notes to use your notes. In Amber Notes: Settings → Connect an AI." } }, 401,
    { "www-authenticate": challenge(base, error) });
}

function isRpc(m: unknown): m is Rpc {
  if (typeof m !== "object" || m === null || Array.isArray(m)) return false;
  const r = m as Record<string, unknown>;
  return r.jsonrpc === "2.0" && typeof r.method === "string" &&
    (r.id === undefined || r.id === null || typeof r.id === "string" || typeof r.id === "number");
}

async function handle(raw: unknown, ctx: ToolContext): Promise<unknown | null> {
  if (!isRpc(raw)) {
    const rawId = (raw as { id?: unknown } | null)?.id;
    const id = typeof rawId === "string" || typeof rawId === "number" ? rawId : null;
    return { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request: expected a JSON-RPC 2.0 message with a method." } };
  }
  const msg = raw;
  const id = msg.id ?? null;
  // Notifications (no id) are never answered; results of ones we don't know are dropped.
  const isNotification = msg.id === undefined;
  const reply = await respond(msg, id, ctx);
  return isNotification ? null : reply;
}

async function respond(msg: Rpc, id: string | number | null, ctx: ToolContext): Promise<unknown> {
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
        if (!tools.some((t) => t.name === name)) {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${name || "(none)"}` } };
        }
        const given = msg.params?.arguments ?? {};
        if (typeof given !== "object" || given === null || Array.isArray(given)) {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid params: arguments must be an object." } };
        }
        const args = given as Record<string, unknown>;
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
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
    }
  } catch (e) {
    return { jsonrpc: "2.0", id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } };
  }
}

function ok(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
