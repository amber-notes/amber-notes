// Amber Notes's MCP server: lets Claude, ChatGPT, Claude Code and Codex read and edit your notes.
// index.ts serves it; tests call handleRequest directly.
//
// Transport: MCP Streamable HTTP (JSON responses). Auth: an OAuth access token from connecting in
// the app (ChatGPT, Claude; see oauth.ts), or an Amber Notes access token sent as
// `Authorization: Bearer pane_…` (Claude Code, Codex). A token in the address is refused: it ends
// up in logs and histories.
//
// Notes are end-to-end encrypted. Every connection holds the account's data key wrapped under its
// own token, which only the AI has. Each HTTP request opens that wrap once and the tools use the
// resulting vault; nothing keeps it after the request. Every tool runs inside a transaction as the
// token's owner with row-level security on, so the server can only ever see that person's notes.
// Writes are revisioned by the database.

import type { Sql } from "npm:postgres@3.4.5";
import { tokenKey, unwrap, Vault } from "../_shared/e2ee.ts";
import { errorKind, log } from "../_shared/log.ts";
import { Content, runTool, servedTools, ToolContext, ToolError } from "./tools.ts";
import { FILE_INSTRUCTIONS, FILE_TOOLS, runFileTool } from "./files_tools.ts";
// The file-like tool set (prototype) when AMBER_MCP_TOOLS=files; otherwise what servedTools() serves.
const fileSet = () => Deno.env.get("AMBER_MCP_TOOLS") === "files";
import { toolErrorKind } from "./tool_errors.ts";
import { challenge, handleOAuth, isOAuthPath, publicBase, resolveAccessToken, subpath } from "./oauth.ts";
import { SERVER_CARD_PATH, SERVER_INFO, serverCardResponse } from "./card.ts";
import { BASE_CSS_URI, GUIDE_URI, PAGE_INSTRUCTIONS, PAGE_PROMPTS, pageGuide } from "./page_guide.ts";
import { AMBER_BASE_CSS } from "./amber-base.ts";

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];
export const INSTRUCTIONS = `Amber Notes is the user's personal notes app. Notes are markdown; the first line is the title.
Start with get_overview or search_notes to find things. Read a note before editing it.
Prefer edit_note (exact find/replace) and append_to_note over replace_note_body, so nothing else changes.
Tables are markdown tables; trackers are tables with typed columns. Use read_table, then log_table_row (it validates values and, in trackers, upserts by date).
Checklists are "- [ ] item" lines; use set_checklist_item to tick them. Link to another note by its title, as in Obsidian:
[[Title]], [[Title|shown text]] or [[Title#Heading]]; the app shows it as a link and follows it by title. A line like [Title](pane-note:<id>) links a sub-note: a whole note that lives inside
its parent. Use create_sub_note to make one; read it with read_note(id). Deleted notes go to Recently Deleted
and can be restored; every edit keeps the previous version (note_history / restore_revision).
${PAGE_INSTRUCTIONS}
A note marked locked: true is locked by the user with a separate password: its title is visible here, and nothing else.
It can't be read, searched or changed here; only the user can open it, in Amber Notes.`;

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS, DELETE",
  "Access-Control-Allow-Headers": "authorization, content-type, accept, mcp-session-id, mcp-protocol-version, last-event-id",
  "Access-Control-Expose-Headers": "mcp-session-id, mcp-protocol-version, www-authenticate, server-timing",
  "Access-Control-Max-Age": "86400",
};

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...cors, ...headers } });
}

type Presented = { token: string; oauth: boolean };

function tokenFrom(req: Request): Presented | null {
  const auth = req.headers.get("authorization") ?? "";
  const oauth = auth.match(/^Bearer\s+(amb_at_[0-9a-f]{64})$/i);
  if (oauth) return { token: oauth[1], oauth: true };
  const m = auth.match(/^Bearer\s+(pane_[0-9a-f]{64})$/i);
  return m ? { token: m[1], oauth: false } : null;
}

type Caller = { user_id: string; name: string; can_write: boolean; vault: Vault; ms?: Record<string, number> };

/** The token's owner, with the data key its wrap holds; undefined when either is missing. */
async function authenticate(sql: Sql, p: Presented, req: Request): Promise<Caller | undefined> {
  const t0 = performance.now();
  const who = p.oauth
    ? await resolveAccessToken(sql, p.token, req)
    : (await sql<{ user_id: string; name: string; can_write: boolean; dk_wrap: string | null }[]>`
        select * from public.resolve_mcp_token(${p.token})`)[0];
  if (!who?.dk_wrap) return undefined;
  const t1 = performance.now();
  const purpose = p.oauth ? "access" : "pane";
  let dataKey;
  try {
    dataKey = await unwrap(who.dk_wrap, await tokenKey(p.token, purpose), purpose, who.user_id);
  } catch {
    return undefined;
  }
  // Vault.from wipes the raw key once it's imported.
  const t2 = performance.now();
  const vault = await Vault.from(dataKey, who.user_id);
  return { user_id: who.user_id, name: who.name, can_write: who.can_write, vault, ms: { auth_lookup: t1 - t0, auth_unwrap: t2 - t1, auth_vault: performance.now() - t2 } };
}

/** Only the MCP endpoint, the OAuth paths and the well-known files exist. Anything else is most
 *  likely an old setup with the token in the address. */
const TOKEN_IN_ADDRESS = "Tokens in the address aren't accepted. Put your token in an Authorization header instead (Amber Notes › Settings › Connect an AI).";

/// Whether answering this request reads or writes the database. Discovery (the server card, the
/// /.well-known/ documents), preflights and the answers that only say "sign in" or "use POST" don't,
/// so they never wait for a connection and stay instant when the database is slow.
export function needsDatabase(req: Request): boolean {
  if (req.method === "OPTIONS") return false;
  const path = subpath(req);
  if (path === SERVER_CARD_PATH || path.startsWith("/.well-known/")) return false;
  if (isOAuthPath(path)) return true;
  return req.method === "POST" && path === "" && Boolean(tokenFrom(req));
}

export async function handleRequest(req: Request, sql: Sql): Promise<Response> {
  const path = subpath(req);
  if (path === SERVER_CARD_PATH && (req.method === "GET" || req.method === "HEAD")) return serverCardResponse();
  if (isOAuthPath(path)) return handleOAuth(req, sql, path);
  const base = publicBase(req);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  // Never logged: the path or query may hold a token.
  const search = new URL(req.url).search;
  let query = search;
  try { query = decodeURIComponent(search); } catch { /* malformed: checked as it is */ }
  if (path !== "" || /(pane|amb)_/i.test(query)) {
    log("address_refused", { path_kind: path === "" ? "query" : /pane_|amb_/i.test(path) ? "token" : "unknown", method: req.method });
    return json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: TOKEN_IN_ADDRESS } }, 401,
      { "www-authenticate": challenge(base, "invalid_request") });
  }
  const presented = tokenFrom(req);
  // Clients learn how to sign in from a 401, so anything unauthenticated gets one.
  if (!presented && (req.method === "GET" || req.method === "POST")) return unauthorized(base);
  if (req.method === "GET") {
    // No server-initiated stream; clients fall back to plain POST.
    return new Response("Amber Notes MCP server. POST JSON-RPC here.", { status: 405, headers: { ...cors, allow: "POST" } });
  }
  if (req.method === "DELETE") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const tAuth = performance.now();
  const who = presented
    ? await authenticate(sql, presented, req).catch((e) => { log("token_lookup_failed", errorKind(e)); return undefined; })
    : undefined;
  const authMs = performance.now() - tAuth;
  // No connection, or one without a key that opens (made before encryption, or revoked): the
  // client is told to connect again.
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

  // The client's session, for what it has read (the file tools' read-before-edit rule). A client
  // that starts one without an Mcp-Session-Id is given one; one that never sends it is known by its token.
  const given = req.headers.get("mcp-session-id");
  const starts = (Array.isArray(payload) ? payload : [payload]).some((m) => (m as Rpc | null)?.method === "initialize");
  const issued = !given && starts ? crypto.randomUUID() : null;
  const session = given && /^[\x21-\x7e]{1,100}$/.test(given) ? given : issued ?? `t:${await tokenHash(presented!.token)}`;
  // One vault for the whole HTTP request; it goes out of scope with it.
  const ctx: ToolContext = { sql, userId: who.user_id, client: who.name, canWrite: who.can_write, vault: who.vault, session, timing: { auth: authMs, ...who.ms, isolate_age: tAuth },
    // Benchmarks on staging (AMBER_BENCH=1) may ask for a call without cached titles.
    cold: Deno.env.get("AMBER_BENCH") === "1" && req.headers.get("x-amber-cold") === "1" };
  const batch = Array.isArray(payload);
  // Messages in a batch run one after another, so writes land in the order they were sent.
  const results: unknown[] = [];
  for (const m of batch ? (payload as unknown[]) : [payload]) {
    const r = await handle(m, ctx);
    if (r !== null) results.push(r);
  }
  const headers: Record<string, string> = {
    ...(issued ? { "mcp-session-id": issued } : {}),
    ...(Object.keys(ctx.timing!).length ? { "server-timing": Object.entries(ctx.timing!).map(([k, v]) => `${k};dur=${Math.round(v)}`).join(", ") } : {}),
  };
  if (!results.length) return new Response(null, { status: 202, headers: { ...cors, ...headers } });
  return json(batch ? results : results[0], 200, headers);
}

/** A token's stand-in as a session: the first 24 hex digits of its SHA-256. */
async function tokenHash(token: string): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

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
          capabilities: { tools: { listChanged: false }, resources: { listChanged: false }, prompts: { listChanged: false } },
          serverInfo: SERVER_INFO,
          // AMBER_MCP_INSTRUCTIONS=none: none at all, as clients that drop them see it (an eval arm).
          ...(Deno.env.get("AMBER_MCP_INSTRUCTIONS") === "none" ? {} : { instructions: fileSet() ? FILE_INSTRUCTIONS : INSTRUCTIONS }),
        });
      }
      case "ping":
        return ok(id, {});
      case "tools/list":
        return ok(id, { tools: (fileSet() ? FILE_TOOLS : servedTools()).filter((t) => ctx.canWrite || t.annotations.readOnlyHint) });
      case "tools/call": {
        const name = String(msg.params?.name ?? "");
        if (!(fileSet() ? FILE_TOOLS : servedTools()).some((t) => t.name === name)) {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${name || "(none)"}` } };
        }
        const given = msg.params?.arguments ?? {};
        if (typeof given !== "object" || given === null || Array.isArray(given)) {
          return { jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid params: arguments must be an object." } };
        }
        const args = given as Record<string, unknown>;
        const started = performance.now();
        try {
          const result = fileSet() ? await runFileTool(name, args, ctx) : await runTool(name, args, ctx);
          if (ctx.timing) ctx.timing.total = performance.now() - started;
          if (result instanceof Content) {
            return ok(id, { content: result.content, ...(result.structured ? { structuredContent: result.structured } : {}) });
          }
          return ok(id, {
            content: [{ type: "text", text: typeof result === "string" ? result : JSON.stringify(result, null, 2) }],
            ...(typeof result === "object" && result !== null && !Array.isArray(result) ? { structuredContent: result } : {}),
          });
        } catch (e) {
          // Tool errors go back to the model as results so it can correct itself, and are logged
          // by their kind. Anything else is logged by its class and code only: a message can
          // quote a note.
          if (e instanceof ToolError) log("tool_error", { tool: name, kind: toolErrorKind(e.message) });
          else log("tool_failed", { tool: name, ms: performance.now() - started, ...errorKind(e) });
          const message = e instanceof ToolError || e instanceof Error ? e.message : String(e);
          return ok(id, { content: [{ type: "text", text: message }], isError: true });
        }
      }
      case "resources/list":
        return ok(id, { resources: fileSet() ? [] : (await RESOURCES()).map(({ text: _, ...r }) => r) });
      case "resources/templates/list":
        return ok(id, { resourceTemplates: [] });
      case "resources/read": {
        const uri = String(msg.params?.uri ?? "");
        const r = (await RESOURCES()).find((x) => x.uri === uri);
        if (!r) return { jsonrpc: "2.0", id, error: { code: -32002, message: `Resource not found: ${uri}` } };
        return ok(id, { contents: [{ uri: r.uri, mimeType: r.mimeType, text: r.text }] });
      }
      case "prompts/list":
        return ok(id, { prompts: fileSet() ? [] : PAGE_PROMPTS.map(({ text: _, ...p }) => p) });
      case "prompts/get": {
        const p = PAGE_PROMPTS.find((x) => x.name === msg.params?.name);
        if (!p) return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown prompt: ${String(msg.params?.name ?? "")}` } };
        const args = (msg.params?.arguments ?? {}) as Record<string, string>;
        const missing = p.arguments.filter((x) => x.required && !String(args[x.name] ?? "").trim()).map((x) => x.name);
        if (missing.length) return { jsonrpc: "2.0", id, error: { code: -32602, message: `Missing argument${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}` } };
        return ok(id, { description: p.description, messages: [{ role: "user", content: { type: "text", text: p.text(args) } }] });
      }
      default:
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${msg.method}` } };
    }
  } catch (e) {
    log("rpc_failed", { method: msg.method, ...errorKind(e) });
    return { jsonrpc: "2.0", id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } };
  }
}

/** Read-only documents a client can attach: the guide, the default stylesheet and an example app
 *  project. Made the first time a client asks (they're big; most requests never need them). */
let resources: Promise<{ uri: string; name: string; title: string; description: string; mimeType: string; text: string }[]> | null = null;
const RESOURCES = () => resources ??= (async () => {
  const { APP_EXAMPLES } = await import("./app_examples.gen.ts");
  return [
    { uri: GUIDE_URI, name: "note-pages-guide", title: "Building note pages", description: "How to build and edit Amber Notes pages: the window.amber API, data model, design rules and a starter page.", mimeType: "text/markdown", text: await pageGuide() },
    { uri: BASE_CSS_URI, name: "amber-base-css", title: "amber-base.css", description: "The default stylesheet every note's app gets, before its own styles and in a cascade layer: override any rule, or opt out with <meta name=\"amber-base\" content=\"none\">.", mimeType: "text/css", text: AMBER_BASE_CSS },
    ...Object.entries(APP_EXAMPLES).flatMap(([name, ex]) => Object.entries(ex.files).map(([path, text]) => ({ uri: `amber://examples/${name}${path}`, name: `example-${name}${path.replace(/[/.]/g, "-")}`, title: `Example app ${name}: ${path}`, description: `A file of the ${name} example project.`, mimeType: path.endsWith(".md") ? "text/markdown" : path.endsWith(".css") ? "text/css" : path.endsWith(".html") ? "text/html" : "text/javascript", text: text as string }))),
  ];
})();

function ok(id: unknown, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}
