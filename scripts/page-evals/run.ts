// Page evals: real model sessions against the local MCP server, scored automatically.
//
//   deno run -A scripts/page-evals/run.ts --round r1 [--model sonnet|opus|openai] [--tasks a,b]
//     [--server <checkout root>] [--skill] [--concurrency 3] [--budget 25]
//
// Each task gets a fresh in-process Postgres (PGlite, every migration) with one account, its seed
// notes and pages, and an MCP connection made the way Claude Code's is. The model sees the
// server's instructions and tools/list exactly as a client does and works until it stops. Then
// the note, its page and its data are read back and scored (tasks.ts, score below), and the page
// is opened in headless WebKit (render.ts). Results go to scripts/page-evals/results/<round>/.
//
// Keys come from the environment (ANTHROPIC_API_KEY, OPENAI_API_KEY); nothing is printed.
import Anthropic from "npm:@anthropic-ai/sdk@0.131.0";
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { closeBrowser, renderPage, type Render } from "../page-render/render.ts";
import { TASKS, type Check, type Final, type NoteState, type Seed, type Task } from "./tasks.ts";
import { scoreTask } from "./score.ts";

const args = parseArgs(Deno.args, { string: ["round", "model", "tasks", "server", "concurrency", "budget", "repeat", "label", "hide", "cli-model", "max-turns", "minutes", "tools", "arm"], boolean: ["skill", "no-render", "allow-paid"] });
// --tools files: the file-like tool set (files_tools.ts) instead of the classic one. --arm screens:
// the try experiment's control (see_app screenshots only, no tests on save). Set before the server loads.
// The classic set with every prototype tool otherwise (production serves only main's tools).
Deno.env.set("AMBER_MCP_TOOLS", args.tools === "files" ? "files" : "pages");
if (args.arm === "screens") Deno.env.set("AMBER_NO_TRY", "1");
/** Tools taken out of tools/list for this run (an A/B on check_app and preview_app, say). */
const hidden = new Set((args.hide ?? "").split(",").map((x) => x.trim()).filter(Boolean));
const round = args.round ?? "dev";
// The subscription CLIs by default; per-token APIs only with --allow-paid (Emil, 2026-10-05).
const modelKey = args.model ?? "claude-cli";
const here = new URL(".", import.meta.url);
const root = args.server ? new URL(args.server.endsWith("/") ? args.server : args.server + "/", "file://" + Deno.cwd() + "/") : new URL("../../", import.meta.url);
const outDir = new URL(`results/${round}/`, here);
await Deno.mkdir(outDir, { recursive: true });
const BUDGET = Number(args.budget ?? 25);
const SPEND = new URL("results/spend.jsonl", here);

Deno.env.set("SUPABASE_URL", "http://127.0.0.1");
Deno.env.set("SUPABASE_ANON_KEY", "anon");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "local-only");

// The render service behind check_app and preview_app, in process, as a deployment would run it.
Deno.env.set("RENDER_SECRET", "evals");
const { handle: renderHandle } = await import("../page-render/server.ts");
const renderServer = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, renderHandle);
Deno.env.set("RENDER_URL", `http://127.0.0.1:${renderServer.addr.port}`);

// Storage for files the AI saves: kept in memory, per run.
const storage = new Map<string, Uint8Array>();
const realFetch = globalThis.fetch;
globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input instanceof Request ? input.url : input);
  const at = url.indexOf("/storage/v1/object/files/");
  if (url.startsWith("http://127.0.0.1/") && at >= 0) {
    const key = decodeURIComponent(url.slice(at + 25));
    if ((init?.method ?? "GET") === "POST") { storage.set(key, new Uint8Array(init!.body as Uint8Array)); return Promise.resolve(new Response("{}")); }
    const b = storage.get(key);
    return Promise.resolve(b ? new Response(new Uint8Array(b)) : new Response("not found", { status: 404 }));
  }
  return realFetch(input, init);
};
const mcp = (p: string) => new URL(`supabase/functions/${p}`, root).href;
const { handleRequest } = await import(mcp("mcp/server.ts"));
const { schemaDB, sqlFor } = await import(mcp("mcp/pglite.ts"));
const { account, app, edit, file, folder, note, opened } = await import(mcp("mcp/sealed.ts"));
const { tokenKey, wrap } = await import(mcp("_shared/e2ee.ts"));
const { pageProblems } = await import(mcp("mcp/page.ts"));
const { renderedFindings } = await import(new URL("supabase/functions/mcp/app_check.ts", root).href);
type Rendered = Parameters<typeof renderedFindings>[0];
// What the server refuses: a one-file page's problems, or a project's (servers without projects: the page's).
const { staticReport } = await import(mcp("mcp/app_check.ts")).catch(() => ({ staticReport: null }));
const serverProblems = (stored: string): string[] => staticReport ? staticReport(stored, "", []).errors : pageProblems(stored);

const MODELS: Record<string, { id: string; provider: "anthropic" | "openai" | "openrouter" | "claude-cli" | "codex-cli"; inPerM: number; outPerM: number; cacheReadPerM: number; cacheWritePerM: number }> = {
  // Subscription CLIs (no per-token billing): Claude Code headless and the Codex CLI.
  "claude-cli": { id: `claude-code:${args["cli-model"] ?? "sonnet"}`, provider: "claude-cli", inPerM: 0, outPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0 },
  "codex-cli": { id: `codex:${args["cli-model"] ?? "default"}`, provider: "codex-cli", inPerM: 0, outPerM: 0, cacheReadPerM: 0, cacheWritePerM: 0 },
  // Through OpenRouter (its own cost accounting is what gets logged).
  "or-sonnet": { id: "anthropic/claude-sonnet-5.5", provider: "openrouter", inPerM: 2, outPerM: 10, cacheReadPerM: 0.2, cacheWritePerM: 2.5 },
  "or-opus": { id: "anthropic/claude-opus-5.5", provider: "openrouter", inPerM: 4, outPerM: 20, cacheReadPerM: 0.2, cacheWritePerM: 5 },
  "or-gpt": { id: "openai/gpt-5.5", provider: "openrouter", inPerM: 5, outPerM: 30, cacheReadPerM: 0.5, cacheWritePerM: 5 },
  sonnet: { id: "claude-sonnet-5-5", provider: "anthropic", inPerM: 2, outPerM: 10, cacheReadPerM: 0.2, cacheWritePerM: 2.5 },
  opus: { id: "claude-opus-5-5", provider: "anthropic", inPerM: 4, outPerM: 20, cacheReadPerM: 0.2, cacheWritePerM: 5 },
  openai: { id: Deno.env.get("OPENAI_EVAL_MODEL") ?? "gpt-5.5", provider: "openai", inPerM: 5, outPerM: 30, cacheReadPerM: 0.5, cacheWritePerM: 5 },
};
const model = MODELS[modelKey];
if (!model) throw new Error(`Unknown model ${modelKey}`);
const paid = !["claude-cli", "codex-cli"].includes(model.provider);
if (paid && !args["allow-paid"]) throw new Error(`${modelKey} bills per token. Use claude-cli or codex-cli, or pass --allow-paid with explicit approval.`);

// What a chat client tells the model around an MCP server, kept short and neutral.
const CLIENT_SYSTEM = `You are an AI assistant. The person has connected their Amber Notes app to you with an MCP server, and its tools are available. The person is busy and won't answer questions before you finish: make sensible choices, do the whole task with the tools, then reply briefly with what you did. Today is 2026-10-05.`;
const variantKey = modelKey + (args.tools === "files" ? "-files" : "") + (args.arm === "screens" ? "-screens" : "") + (args.skill ? "-skill" : "") + (hidden.size ? `-no-${[...hidden].join("-")}` : "");
const skill = args.skill ? await Deno.readTextFile(new URL("plugins/amber-notes/skills/note-pages/SKILL.md", root)).catch(() => "") : "";

// MARK: An account and a connection

async function setup(task: Task) {
  const pg = await schemaDB();
  const sql = sqlFor(pg);
  const a = await account(pg);
  // Folders by path, created as needed; earlier texts become the note's history.
  const folderIds = new Map<string, string>();
  const folderOf = async (path?: string): Promise<string | undefined> => {
    if (!path) return undefined;
    let parent: string | null = null, at = "";
    for (const part of path.split("/").filter(Boolean)) {
      at = at ? `${at}/${part}` : part;
      if (!folderIds.has(at)) folderIds.set(at, await folder(pg, a, part, parent));
      parent = folderIds.get(at)!;
    }
    return parent ?? undefined;
  };
  const seedNote = async (s: Seed) => {
    const nid = await note(pg, a, s.earlier?.[0] ?? s.body, { folder: await folderOf(s.folder), pinned: s.pinned });
    for (const b of [...(s.earlier ?? []).slice(1), ...(s.earlier?.length ? [s.body] : [])]) await edit(pg, a, nid, b);
    return nid;
  };
  const id = await seedNote(task.seed);
  const others: string[] = [];
  for (const o of task.others ?? []) others.push(await seedNote(o));
  const token = "pane_" + [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)))].map((b) => b.toString(16).padStart(2, "0")).join("");
  await app(pg, a.id, `select public.create_mcp_token('Claude', true, $1, $2)`, [hash, await wrap(a.dk.slice(), await tokenKey(token, "pane"), "pane", a.id)]);
  let n = 0;
  const rpc = async (method: string, params: Record<string, unknown> = {}) => {
    const req = new Request("http://127.0.0.1/functions/v1/mcp", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++n, method, params }) });
    const res = await handleRequest(req, sql);
    const j = await res.json();
    if (j.error) throw new Error(`${method}: ${j.error.message}`);
    return j.result;
  };
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "page-evals", version: "1" } });
  const call = async (name: string, a: Record<string, unknown>) => {
    const r = await rpc("tools/call", { name, arguments: a });
    const blocks = (r.content ?? []) as { type: string; text?: string; data?: string; mimeType?: string }[];
    return { text: blocks.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n"), isError: r.isError === true, images: blocks.filter((c) => c.type === "image").map((c) => ({ data: c.data!, mimeType: c.mimeType! })), raw: r.content };
  };
  for (const [nid, s] of [[id, task.seed], ...(task.others ?? []).map((o, i) => [others[i], o] as const)] as const) {
    // A project (compiled JSON) goes in as the app stores it; a one-file page through the tool.
    if (s.page?.startsWith("{")) await app(pg, a.id, `insert into public.note_pages (note_id, page_ct) values ($1, $2) on conflict (note_id) do update set page_ct = excluded.page_ct`, [nid, await a.vault.sealPage(nid, s.page)]);
    else if (s.page) { const r = await call("set_note_page", { id: nid, html: s.page }); if (r.isError) throw new Error(`seed page: ${r.text}`); }
    if (s.data) {
      const box = await a.vault.sealPageData(nid, JSON.stringify({ values: {}, collections: {}, ...s.data }));
      await app(pg, a.id, `insert into public.note_pages (note_id, data_ct) values ($1, $2) on conflict (note_id) do update set data_ct = excluded.data_ct`, [nid, box]);
    }
  }
  for (const k of task.apiKeys ?? []) {
    const kid = crypto.randomUUID();
    await app(pg, a.id, `insert into public.api_key_names (id, meta_ct) values ($1, $2)`, [kid, await a.vault.sealAPIKeyMeta(kid, JSON.stringify(k))]);
  }
  const fileIds: string[] = [];
  for (const f of task.files ?? []) {
    const made = await file(pg, a, f.name, f.type, new TextEncoder().encode(f.text));
    storage.set(made.path, made.sealed);
    fileIds.push(made.id);
  }
  const state = async (nid: string) => {
    const body = (await opened(pg, a, nid)).body as string;
    const [p] = (await pg.query(`select page_ct from public.note_pages where note_id = $1`, [nid])).rows;
    const page = p?.page_ct ? await a.vault.openPage(nid, p.page_ct) : null;
    let data: unknown = null;
    try {
      const [d] = (await pg.query(`select data_ct from public.note_pages where note_id = $1`, [nid])).rows as { data_ct: string | null }[];
      data = d?.data_ct ? JSON.parse(await a.vault.openPageData(nid, d.data_ct)) : null;
    } catch { /* a server without page data */ }
    return { body, page, data };
  };
  // The same server over HTTP on this Mac, for the CLIs. Every tools/call is kept as it crossed the
  // wire (request and response bodies), for the verbatim trace.
  const wire: Wire[] = [];
  const http = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen: () => {} }, async (req) => {
    const u = new URL(req.url);
    const body = req.method === "POST" ? await req.text() : undefined;
    const res = await handleRequest(new Request(`http://127.0.0.1/functions/v1/mcp${u.pathname === "/" ? "" : u.pathname}`, { method: req.method, headers: req.headers, body }), sql);
    let call: { id?: unknown; params?: { name?: string; arguments?: unknown } } | undefined;
    try { const j = JSON.parse(body ?? ""); if (j?.method === "tools/call") call = j; } catch { /* not JSON-RPC */ }
    if (!call) return res;
    const text = await res.text();
    wire.push({ at: performance.now(), name: String(call.params?.name ?? ""), args: call.params?.arguments, response: text });
    return new Response(text, { status: res.status, headers: res.headers });
  });
  const url = `http://127.0.0.1:${http.addr.port}/`;
  // Every note: title, text, folder path, pinned, in Recently Deleted, parent.
  const snapshot = async (): Promise<NoteState[]> => {
    const fs = (await pg.query(`select id, name_ct, parent_id from public.folders where deleted_at is null`)).rows as { id: string; name_ct: string; parent_id: string | null }[];
    const names = new Map<string, { name: string; parent: string | null }>();
    for (const f of fs) names.set(f.id, { name: await a.vault.openFolder(f.id, f.name_ct), parent: f.parent_id });
    const pathOf = (fid: string | null): string => { const parts: string[] = []; for (let k = fid, g = 0; k && g < 20; g++) { const f = names.get(k); if (!f) break; parts.unshift(f.name); k = f.parent; } return parts.join("/"); };
    const rows = (await pg.query(`select id, folder_id, parent_id, is_pinned, trashed_at from public.notes where deleted_at is null`)).rows as { id: string; folder_id: string | null; parent_id: string | null; is_pinned: boolean; trashed_at: string | null }[];
    const out: NoteState[] = [];
    for (const r of rows) { const o = await opened(pg, a, r.id); out.push({ id: r.id, title: o.head?.title ?? "", body: o.body ?? "", folder: pathOf(r.folder_id), pinned: r.is_pinned, trashed: r.trashed_at !== null, parent: r.parent_id }); }
    return out;
  };
  return { pg, id, others, rpc, call, init, state, fileIds, url, token, http, snapshot, wire };
}

// MARK: A model session

type Called = { text: string; isError: boolean; images?: { data: string; mimeType: string }[]; raw?: unknown };

// MARK: Verbatim traces
//
// Next to each result, <stem>.trace.json holds the whole session in order, nothing shortened: the
// prompt, every assistant text and (where the model path exposes it) thinking, every tool call with
// its exact arguments and every tool result exactly as returned, then the answer. Images keep their
// base64 data. Its context is only what we serve and control: the server's instructions and
// tools/list as returned, the seeded notes, the run's settings and backend. A CLI's own built-in
// prompt isn't in it.

type TraceEvent = { t: number; type: "user" | "assistant_text" | "thinking" | "tool_call" | "tool_result" | "answer"; name?: string; id?: string; text?: string; args?: unknown; result?: unknown; error?: boolean; server_result?: unknown };
type Wire = { at: number; name: string; args: unknown; response: string };
type Trace = { start: number; started_at: string; events: TraceEvent[]; raw?: string; add: (e: Omit<TraceEvent, "t">, at?: number) => void };
function tracer(): Trace {
  const start = performance.now();
  const events: TraceEvent[] = [];
  return { start, started_at: new Date().toISOString(), events, add: (e, at = performance.now()) => { events.push({ t: Math.round(at - start), ...e }); } };
}
const decodedBytes = (b64: string) => Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
/** A result's content as returned, with every image (Anthropic or MCP shape) as {type, mime, bytes, data}. */
// deno-lint-ignore no-explicit-any
const verbatim = (c: any): unknown => !Array.isArray(c) ? c : c.map((b: any) => {
  if (b?.type !== "image") return b;
  const data: string = b.source?.data ?? b.data ?? "";
  return { type: "image", mime: b.source?.media_type ?? b.mimeType ?? b.mime_type ?? "", bytes: decodedBytes(data), data };
});
/** A CLI's stdout, line by line with the time each line arrived; stopped after --minutes (default 30). */
async function streamed(cmd: Deno.Command): Promise<{ lines: { at: number; line: string }[]; stdout: string; stderr: string }> {
  const p = cmd.spawn();
  const timer = setTimeout(() => { try { p.kill("SIGTERM"); } catch { /* gone */ } }, Number(args.minutes ?? 30) * 60_000);
  const lines: { at: number; line: string }[] = [];
  let stdout = "", buf = "";
  const err = new Response(p.stderr).text();
  try {
    for await (const chunk of p.stdout.pipeThrough(new TextDecoderStream())) {
      stdout += chunk; buf += chunk;
      let i: number;
      while ((i = buf.indexOf("\n")) >= 0) { lines.push({ at: performance.now(), line: buf.slice(0, i) }); buf = buf.slice(i + 1); }
    }
    if (buf) lines.push({ at: performance.now(), line: buf });
    await p.status;
  } finally { clearTimeout(timer); }
  return { lines, stdout, stderr: await err };
}
/** The MCP result the server sent for this call, for a CLI's trace: the first unclaimed one with this tool and arguments. */
function wireResult(wire: Wire[], used: Set<number>, name: string, a: unknown, before: number): unknown {
  // Only calls that reached the server before the CLI reported the result (a call the CLI refused never does).
  const open = (w: Wire, k: number) => !used.has(k) && w.at <= before && w.name === name;
  const key = JSON.stringify(a ?? {});
  const i = wire.findIndex((w, k) => open(w, k) && JSON.stringify(w.args ?? {}) === key);
  const k = i >= 0 ? i : wire.findIndex(open);
  if (k < 0) return undefined;
  used.add(k);
  let r: { result?: { content?: unknown; isError?: boolean }; error?: unknown } | undefined;
  try { r = JSON.parse(wire[k].response); } catch {
    // An SSE response: the data line holds the JSON-RPC message.
    const d = wire[k].response.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).pop();
    try { r = JSON.parse(d ?? ""); } catch { return wire[k].response; }
  }
  return r?.result ? { ...r.result, content: verbatim(r.result.content) } : r;
}

type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; turns: number };
type Logged = { name: string; args: Record<string, unknown>; error: boolean; result: string };

const short = (v: unknown, n = 400) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + `… (${s.length} chars)` : s; };

async function claudeSession(system: string, tools: { name: string; description: string; inputSchema: unknown }[], prompt: string, call: (n: string, a: Record<string, unknown>) => Promise<Called>, tr: Trace) {
  const client = new Anthropic({ maxRetries: 4 });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
  const log: Logged[] = [];
  let answer = "";
  const defs = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema as Anthropic.Tool.InputSchema }));
  for (let turn = 0; turn < 30; turn++) {
    const res = await client.messages.stream({
      model: model.id, max_tokens: 48000, system, tools: defs, messages,
      cache_control: { type: "ephemeral" },
      output_config: { effort: modelKey === "opus" ? "medium" : "medium" },
    } as Anthropic.MessageStreamParams).finalMessage();
    usage.turns++;
    usage.input += res.usage.input_tokens; usage.output += res.usage.output_tokens;
    usage.cacheRead += res.usage.cache_read_input_tokens ?? 0; usage.cacheWrite += res.usage.cache_creation_input_tokens ?? 0;
    messages.push({ role: "assistant", content: res.content });
    for (const b of res.content) {
      if (b.type === "text") tr.add({ type: "assistant_text", text: b.text });
      else if (b.type === "thinking") tr.add({ type: "thinking", text: b.thinking });
      else if (b.type === "redacted_thinking") tr.add({ type: "thinking", text: "", result: b });
      else if (b.type === "tool_use") tr.add({ type: "tool_call", name: b.name, id: b.id, args: b.input });
    }
    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n");
    if (text) answer = text;
    if (res.stop_reason !== "tool_use" || !uses.length) break;
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of uses) {
      const r: Called = await call(u.name, u.input as Record<string, unknown>).catch((e) => ({ text: String(e), isError: true }));
      log.push({ name: u.name, args: u.input as Record<string, unknown>, error: r.isError, result: short(r.text, 600) });
      tr.add({ type: "tool_result", name: u.name, id: u.id, result: verbatim(r.raw ?? r.text), error: r.isError });
      const content: Anthropic.ToolResultBlockParam["content"] = r.images?.length
        ? [{ type: "text", text: r.text }, ...r.images.map((im) => ({ type: "image" as const, source: { type: "base64" as const, media_type: im.mimeType as "image/png", data: im.data } }))]
        : r.text;
      results.push({ type: "tool_result", tool_use_id: u.id, content, ...(r.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }
  return { usage, log, answer };
}

async function openaiSession(system: string, tools: { name: string; description: string; inputSchema: unknown }[], prompt: string, call: (n: string, a: Record<string, unknown>) => Promise<Called>, tr: Trace) {
  const key = Deno.env.get("OPENAI_API_KEY");
  if (!key) throw new Error("OPENAI_API_KEY isn't set");
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
  const log: Logged[] = [];
  let answer = "";
  const defs = tools.map((t) => ({ type: "function", name: t.name, description: t.description, parameters: t.inputSchema, strict: false }));
  let input: unknown[] = [{ role: "user", content: prompt }];
  let previous: string | undefined;
  for (let turn = 0; turn < 30; turn++) {
    const body = JSON.stringify({ model: model.id, instructions: system, tools: defs, input, ...(previous ? { previous_response_id: previous } : {}), reasoning: { effort: "medium" } });
    let res!: Response;
    // Their 5xx and 429 are passing: try again, a few times.
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body, signal: AbortSignal.timeout(240_000) })
        .catch((e) => new Response(String(e), { status: 599 }));
      if (res.status < 500 && res.status !== 429) break;
      await res.body?.cancel();
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
    }
    const j = await res.json();
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${short(j.error?.message ?? j, 300)}`);
    usage.turns++;
    usage.input += (j.usage?.input_tokens ?? 0) - (j.usage?.input_tokens_details?.cached_tokens ?? 0);
    usage.cacheRead += j.usage?.input_tokens_details?.cached_tokens ?? 0;
    usage.output += j.usage?.output_tokens ?? 0;
    previous = j.id;
    for (const o of j.output ?? []) {
      if (o.type === "reasoning") tr.add({ type: "thinking", text: (o.summary ?? []).map((x: { text?: string }) => x.text ?? "").join("\n"), ...(o.encrypted_content ? { result: { encrypted: true } } : {}) });
      if (o.type === "message") for (const c of o.content ?? []) if (c.type === "output_text") tr.add({ type: "assistant_text", text: c.text });
      if (o.type === "function_call") { let a: unknown = o.arguments; try { a = JSON.parse(o.arguments || "{}"); } catch { /* kept as the string sent */ } tr.add({ type: "tool_call", name: o.name, id: o.call_id, args: a }); }
    }
    const calls = (j.output ?? []).filter((o: { type: string }) => o.type === "function_call");
    const text = (j.output ?? []).filter((o: { type: string }) => o.type === "message").flatMap((o: { content: { type: string; text: string }[] }) => o.content.filter((c) => c.type === "output_text").map((c) => c.text)).join("\n");
    if (text) answer = text;
    if (!calls.length) break;
    input = [];
    for (const c of calls) {
      let a: Record<string, unknown> = {};
      try { a = JSON.parse(c.arguments || "{}"); } catch { /* sent as is */ }
      const r: Called = await call(c.name, a).catch((e) => ({ text: String(e), isError: true }));
      log.push({ name: c.name, args: a, error: r.isError, result: short(r.text, 600) });
      tr.add({ type: "tool_result", name: c.name, id: c.call_id, result: verbatim(r.raw ?? r.text), error: r.isError });
      input.push({ type: "function_call_output", call_id: c.call_id, output: r.isError ? `Error: ${r.text}` : r.images?.length
        ? [{ type: "input_text", text: r.text }, ...r.images.map((im) => ({ type: "input_image", image_url: `data:${im.mimeType};base64,${im.data}` }))]
        : r.text });
    }
  }
  return { usage, log, answer };
}

// The CLIs see none of the person's own setup: no API keys in their environment (so they use the
// subscription), a fresh empty working directory, no user or project settings or CLAUDE.md, and
// only the Amber MCP server.
// Without try_app and run_app_tests (an experiment's control arm), the guide doesn't mention them.
if (args.hide?.split(",").includes("try_app")) Deno.env.set("AMBER_GUIDE_WITHOUT_TRY", "1");
const CLI_ENV = (() => { const e = Deno.env.toObject(); for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "RENDER_SECRET"]) delete e[k]; return e; })();
const scratch = () => Deno.makeTempDir({ prefix: "amber-eval-" });

/** Text of an MCP tool result as the CLIs report it. */
// deno-lint-ignore no-explicit-any
const resultText = (c: any): string => typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (b?.type === "text" ? b.text : b?.type ? `[${b.type}]` : JSON.stringify(b))).join("\n") : JSON.stringify(c ?? "");

async function claudeCliSession(system: string, url: string, token: string, prompt: string, hide: Set<string>, tr: Trace, wire: Wire[]) {
  const dir = await scratch();
  const config = `${dir}/mcp.json`;
  await Deno.writeTextFile(config, JSON.stringify({ mcpServers: { amber: { type: "http", url, headers: { Authorization: `Bearer ${token}` } } } }));
  const cmd = new Deno.Command("nice", {
    args: ["-n", "10", "claude", "-p", prompt, "--model", args["cli-model"] ?? "sonnet", "--system-prompt", system,
      "--setting-sources", "local", "--strict-mcp-config", "--mcp-config", config, "--tools", "", "--allowedTools", "mcp__amber__*",
      ...(hide.size ? ["--disallowedTools", ...[...hide].map((h) => `mcp__amber__${h}`)] : []),
      "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--max-turns", String(args["max-turns"] ?? 40)],
    cwd: dir, env: CLI_ENV, clearEnv: true, stdout: "piped", stderr: "piped",
  });
  const out = await streamed(cmd);
  tr.raw = out.stdout;
  const usage: Usage & { equivalentUsd?: number } = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
  const log: Logged[] = [];
  const pending = new Map<string, Logged>();
  const called = new Map<string, string>();
  const used = new Set<number>();
  let answer = "";
  for (const { at, line } of out.lines) {
    // deno-lint-ignore no-explicit-any
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.type === "system" && ev.subtype === "init" && ev.apiKeySource && ev.apiKeySource !== "none") throw new Error(`claude used ${ev.apiKeySource}, not the subscription: stopping.`);
    if (ev.type === "assistant") {
      usage.turns++;
      for (const b of ev.message?.content ?? []) {
        if (b.type === "text" && b.text?.trim()) answer = b.text;
        if (b.type === "text") tr.add({ type: "assistant_text", text: b.text }, at);
        // The CLI prints thinking as a signature only; that stays in the raw stream.
        if (b.type === "thinking" && b.thinking) tr.add({ type: "thinking", text: b.thinking }, at);
        if (b.type === "tool_use") { const l = { name: String(b.name).replace(/^mcp__amber__/, ""), args: b.input ?? {}, error: false, result: "" }; log.push(l); pending.set(b.id, l); called.set(b.id, String(b.name)); tr.add({ type: "tool_call", name: b.name, id: b.id, args: b.input }, at); }
      }
    }
    if (ev.type === "user") {
      for (const b of ev.message?.content ?? []) {
        if (b.type === "tool_result" && pending.has(b.tool_use_id)) { const l = pending.get(b.tool_use_id)!; l.error = b.is_error === true; l.result = short(resultText(b.content), 600); }
        if (b.type === "tool_result") {
          // What the model saw (the CLI's tool_result), plus what the server sent when the CLI changed it.
          const l = pending.get(b.tool_use_id);
          const seen = verbatim(b.content);
          const sent = l ? wireResult(wire, used, l.name, l.args, at) : undefined;
          const same = sent && typeof sent === "object" && JSON.stringify((sent as { content?: unknown }).content) === JSON.stringify(typeof seen === "string" ? [{ type: "text", text: seen }] : seen);
          tr.add({ type: "tool_result", name: called.get(b.tool_use_id), id: b.tool_use_id, result: seen, error: b.is_error === true, ...(sent !== undefined && !same ? { server_result: sent } : {}) }, at);
        }
      }
    }
    if (ev.type === "result") {
      if (typeof ev.result === "string" && ev.result.trim()) answer = ev.result;
      const u = ev.usage ?? {};
      usage.input = u.input_tokens ?? 0; usage.output = u.output_tokens ?? 0; usage.cacheRead = u.cache_read_input_tokens ?? 0; usage.cacheWrite = u.cache_creation_input_tokens ?? 0;
      usage.equivalentUsd = ev.total_cost_usd;
    }
  }
  if (!answer && !log.length) throw new Error(`claude -p produced nothing: ${out.stderr.slice(0, 300)}`);
  await Deno.remove(dir, { recursive: true }).catch(() => {});
  return { usage: { ...usage, usd: 0 }, log, answer };
}

async function codexCliSession(system: string, url: string, token: string, prompt: string, hide: Set<string>, tr: Trace, wire: Wire[]) {
  // Its own CODEX_HOME: no user config or AGENTS.md, the login linked from ~/.codex.
  const home = await scratch();
  const dir = await scratch();
  await Deno.symlink(`${Deno.env.get("HOME")}/.codex/auth.json`, `${home}/auth.json`);
  await Deno.writeTextFile(`${home}/config.toml`, [
    ...(args["cli-model"] ? [`model = "${args["cli-model"]}"`] : []),
    `model_reasoning_effort = "medium"`,
    // Tool calls run without asking, as a person who already approved the connection would have it.
    `[mcp_servers.amber]`, `url = "${url}"`, `bearer_token_env_var = "AMBER_EVAL_TOKEN"`, `default_tools_approval_mode = "approve"`,
    ...(hide.size ? [`disabled_tools = ${JSON.stringify([...hide])}`] : []),
  ].join("\n") + "\n");
  const cmd = new Deno.Command("nice", {
    args: ["-n", "10", "codex", "exec", "--json", "--skip-git-repo-check", "--ephemeral", "-s", "read-only",
      `${system}\n\n---\n\n${prompt}`],
    cwd: dir, env: { ...CLI_ENV, CODEX_HOME: home, AMBER_EVAL_TOKEN: token }, clearEnv: true, stdout: "piped", stderr: "piped",
  });
  const out = await streamed(cmd);
  tr.raw = out.stdout;
  const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0 };
  const log: Logged[] = [];
  const used = new Set<number>();
  let answer = "";
  for (const { at, line } of out.lines) {
    // deno-lint-ignore no-explicit-any
    let ev: any;
    try { ev = JSON.parse(line); } catch { continue; }
    const item = ev.item ?? {};
    if (ev.type === "item.completed" && item.type === "mcp_tool_call") {
      log.push({ name: String(item.tool), args: item.arguments ?? {}, error: item.status === "failed" || item.result?.isError === true || !!item.error, result: short(resultText(item.result?.content ?? item.error ?? ""), 600) });
      // Codex reports a call once it's done: the call at its start (item.started), the result here.
      if (!tr.events.some((e) => e.type === "tool_call" && e.id === item.id)) tr.add({ type: "tool_call", name: String(item.tool), id: item.id, args: item.arguments }, at);
      const seen = item.result ? verbatim(item.result.content) : item.error;
      const sent = wireResult(wire, used, String(item.tool), item.arguments, at);
      const same = sent && typeof sent === "object" && JSON.stringify((sent as { content?: unknown }).content) === JSON.stringify(seen);
      tr.add({ type: "tool_result", name: String(item.tool), id: item.id, result: seen, error: log[log.length - 1].error, ...(sent !== undefined && !same ? { server_result: sent } : {}) }, at);
    }
    if (ev.type === "item.started" && item.type === "mcp_tool_call") tr.add({ type: "tool_call", name: String(item.tool), id: item.id, args: item.arguments }, at);
    if (ev.type === "item.completed" && item.type === "agent_message") tr.add({ type: "assistant_text", text: item.text ?? "" }, at);
    if (ev.type === "item.completed" && item.type === "reasoning") tr.add({ type: "thinking", text: item.text ?? "" }, at);
    if (ev.type === "item.completed" && item.type === "agent_message" && item.text?.trim()) answer = item.text;
    if (ev.type === "turn.completed") {
      usage.turns++;
      const u = ev.usage ?? {};
      usage.input += (u.input_tokens ?? 0) - (u.cached_input_tokens ?? 0); usage.cacheRead += u.cached_input_tokens ?? 0; usage.output += u.output_tokens ?? 0;
    }
  }
  if (!answer && !log.length) throw new Error(`codex exec produced nothing: ${out.stderr.slice(-400)}`);
  await Deno.remove(home, { recursive: true }).catch(() => {});
  await Deno.remove(dir, { recursive: true }).catch(() => {});
  return { usage: { ...usage, usd: 0 }, log, answer };
}

/**
 * OpenRouter's chat completions with tools, for Claude and GPT alike. Anthropic models get cache
 * breakpoints on the system prompt and the newest message; images from preview_app go in a user
 * message after the tool results (tool messages are text there). Cost is OpenRouter's own figure.
 */
async function openrouterSession(system: string, tools: { name: string; description: string; inputSchema: unknown }[], prompt: string, call: (n: string, a: Record<string, unknown>) => Promise<Called>, tr: Trace) {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) throw new Error("OPENROUTER_API_KEY isn't set");
  const usage: Usage & { usd?: number } = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, usd: 0 };
  const log: Logged[] = [];
  let answer = "";
  const anthropic = model.id.startsWith("anthropic/");
  const cached = (text: string) => anthropic ? [{ type: "text", text, cache_control: { type: "ephemeral" } }] : text;
  const defs = tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  // deno-lint-ignore no-explicit-any
  const messages: any[] = [{ role: "system", content: cached(system) }, { role: "user", content: prompt }];
  for (let turn = 0; turn < 30; turn++) {
    // The newest message carries the moving cache breakpoint; earlier ones lose theirs.
    // deno-lint-ignore no-explicit-any
    const send = messages.map((m: any, i: number) => (anthropic && i === messages.length - 1 && i > 0 && typeof m.content === "string" && m.content ? { ...m, content: cached(m.content) } : m));
    const body = JSON.stringify({ model: model.id, messages: send, tools: defs, usage: { include: true }, reasoning: { effort: "medium" }, max_tokens: 48000 });
    let res!: Response;
    for (let attempt = 0; attempt < 4; attempt++) {
      res = await fetch("https://openrouter.ai/api/v1/chat/completions", { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "x-title": "Amber Notes page evals" }, body, signal: AbortSignal.timeout(300_000) })
        .catch((e) => new Response(String(e), { status: 599 }));
      if (res.status < 500 && res.status !== 429) break;
      await res.body?.cancel();
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok || j.error) throw new Error(`OpenRouter ${res.status}: ${short(j.error?.message ?? j, 300)}`);
    usage.turns++;
    const u = j.usage ?? {};
    usage.cacheRead += u.prompt_tokens_details?.cached_tokens ?? 0;
    usage.input += (u.prompt_tokens ?? 0) - (u.prompt_tokens_details?.cached_tokens ?? 0);
    usage.output += u.completion_tokens ?? 0;
    usage.usd! += Number(u.cost ?? 0);
    const msg = j.choices?.[0]?.message ?? {};
    if (typeof msg.content === "string" && msg.content.trim()) answer = msg.content;
    const calls = (msg.tool_calls ?? []) as { id: string; function: { name: string; arguments: string } }[];
    if (typeof msg.reasoning === "string" && msg.reasoning) tr.add({ type: "thinking", text: msg.reasoning });
    if (typeof msg.content === "string" && msg.content) tr.add({ type: "assistant_text", text: msg.content });
    for (const c of calls) { let a: unknown = c.function.arguments; try { a = JSON.parse(c.function.arguments || "{}"); } catch { /* kept as the string sent */ } tr.add({ type: "tool_call", name: c.function.name, id: c.id, args: a }); }
    messages.push({ role: "assistant", content: msg.content ?? "", ...(calls.length ? { tool_calls: calls } : {}), ...(msg.reasoning_details ? { reasoning_details: msg.reasoning_details } : {}) });
    if (!calls.length) break;
    const images: { data: string; mimeType: string }[] = [];
    for (const c of calls) {
      let a: Record<string, unknown> = {};
      try { a = JSON.parse(c.function.arguments || "{}"); } catch { /* sent as is */ }
      const r: Called = await call(c.function.name, a).catch((e) => ({ text: String(e), isError: true }));
      log.push({ name: c.function.name, args: a, error: r.isError, result: short(r.text, 600) });
      tr.add({ type: "tool_result", name: c.function.name, id: c.id, result: verbatim(r.raw ?? r.text), error: r.isError });
      messages.push({ role: "tool", tool_call_id: c.id, content: r.isError ? `Error: ${r.text}` : r.text });
      images.push(...(r.images ?? []));
    }
    if (images.length) messages.push({ role: "user", content: [{ type: "text", text: "The screenshots preview_app returned:" }, ...images.map((im) => ({ type: "image_url", image_url: { url: `data:${im.mimeType};base64,${im.data}` } }))] });
  }
  return { usage, log, answer };
}

const cost = (u: Usage) => (u.input * model.inPerM + u.output * model.outPerM + u.cacheRead * model.cacheReadPerM + u.cacheWrite * model.cacheWritePerM) / 1e6;

async function spent(): Promise<number> {
  const text = await Deno.readTextFile(SPEND).catch(() => "");
  return text.split("\n").filter(Boolean).reduce((s, l) => s + (JSON.parse(l).usd ?? 0), 0);
}

// MARK: Run

async function runTask(task: Task, rep = 1) {
  const stem = `${task.id}-${variantKey}${rep > 1 ? `-r${rep}` : ""}`;
  const t0 = performance.now();
  const s = await setup(task);
  const before = await s.state(s.id);
  const othersBefore = await Promise.all(s.others.map((o) => s.state(o)));
  const toolsList = await s.rpc("tools/list");
  const seeded = await s.snapshot();
  const listed = toolsList.tools.filter((t: { name: string }) => !hidden.has(t.name));
  const system = `${CLIENT_SYSTEM}\n\n<mcp_server name="amber-notes">\n${s.init.instructions}\n</mcp_server>${skill ? `\n\n<skill name="note-pages">\n${skill}\n</skill>` : ""}`;
  // The CLIs get the server's instructions from the server itself, as any client does.
  const cliSystem = `${CLIENT_SYSTEM}${skill ? `\n\n<skill name="note-pages">\n${skill}\n</skill>` : ""}`;
  const tr = tracer();
  tr.add({ type: "user", text: model.provider === "codex-cli" ? `${cliSystem}\n\n---\n\n${task.prompt}` : task.prompt });
  const session = model.provider === "claude-cli" ? await claudeCliSession(cliSystem, s.url, s.token, task.prompt, hidden, tr, s.wire)
    : model.provider === "codex-cli" ? await codexCliSession(cliSystem, s.url, s.token, task.prompt, hidden, tr, s.wire)
    : model.provider === "anthropic" ? await claudeSession(system, listed, task.prompt, s.call, tr)
    : model.provider === "openrouter" ? await openrouterSession(system, listed, task.prompt, s.call, tr)
    : await openaiSession(system, listed, task.prompt, s.call, tr);
  const sessionSeconds = (performance.now() - tr.start) / 1000;
  tr.add({ type: "answer", text: session.answer });
  // An open request ("build me a workout tracker app") may get a new note of its own: score that one
  // when the seeded note was left without an app.
  let after = await s.state(s.id);
  if (!after.page && task.seed.body.trim().split("\n").length <= 1) {
    const made = (await s.pg.query(`select n.id from public.notes n join public.note_pages p on p.note_id = n.id where p.page_ct is not null and n.id <> $1 order by n.created_at desc limit 1`, [s.id])).rows as { id: string }[];
    if (made[0]) after = await s.state(made[0].id);
  }
  const othersAfter = await Promise.all(s.others.map((o) => s.state(o)));
  const notesAfter = await s.snapshot();
  const f: Final = {
    before: before.body, after: after.body, pageBefore: before.page, page: after.page, dataBefore: before.data, data: after.data,
    calls: session.log.map((l) => ({ name: l.name, args: l.args, error: l.error })), answer: session.answer,
    others: othersBefore.map((o, i) => ({ before: o.body, after: othersAfter[i].body })), fileIds: s.fileIds, notes: notesAfter,
  };
  const shots = new URL(`shots/${stem}`, outDir).pathname;
  await Deno.mkdir(new URL("shots/", outDir), { recursive: true });
  let render: Render | undefined;
  if (after.page && !args["no-render"] && (task.page || after.page !== before.page)) {
    render = await renderPage(after.page, after.body, after.data ?? {}, { shots, today: "2026-10-05", interact: task.interact || task.plays }).catch((e) => { console.error(task.id, "render failed", e); return undefined; });
    f.render = render;
  }
  const checks: Check[] = scoreTask(task, f, render, serverProblems);
  // The experiment's hidden scoring: a person's walkthrough, probe by probe, each on a fresh copy of
  // the final app and its data, and the brief's features found in the project's source.
  const walk: { name: string; pass: boolean; detail?: string }[] = [];
  if (after.page && task.walkthrough && !args["no-render"]) {
    for (const probe of task.walkthrough) {
      const r = await renderPage(after.page, after.body, after.data ?? {}, { today: "2026-10-05", steps: probe.steps, views: [{ width: probe.desktop ? 1280 : 390, scheme: "light" }] }).catch((e) => ({ trial: [{ ok: false, error: String(e), errors: [] }] }) as unknown as Render);
      const bad = (r.trial ?? []).find((t) => !t.ok || t.errors.length);
      walk.push({ name: probe.name, pass: !!r.trial?.length && !bad, ...(bad ? { detail: `${JSON.stringify(bad.step)}: ${bad.error ?? bad.errors[0]}` } : {}) });
    }
    for (const w of walk) checks.push({ name: `walk_${w.name}`, pass: w.pass, ...(w.detail ? { detail: w.detail } : {}) });
  }
  if (task.features) {
    // The model's own source: not the compiled output, not the starter's shadcn components.
    let p = after.page ?? "";
    try { const proj = JSON.parse(p); if (proj?.files) p = Object.entries(proj.files as Record<string, string>).filter(([k]) => !k.startsWith("/src/components/ui/")).map(([, v]) => v).join("\n"); } catch { /* one-file page */ }
    for (const ft of task.features) checks.push({ name: `has_${ft.name}`, pass: ft.re.test(p), ...(ft.re.test(p) ? {} : { detail: String(ft.re) }) });
  }
  const breakage = render ? renderedFindings(render as unknown as Rendered).errors : [];
  const usd = (session.usage as { usd?: number }).usd ?? cost(session.usage);
  await Deno.writeTextFile(SPEND, JSON.stringify({ at: new Date().toISOString(), round, task: task.id, model: model.id, via: model.provider, usd: +usd.toFixed(4), usage: session.usage }) + "\n", { append: true });
  const result = {
    task: task.id, rep, model: model.id, round, skill: !!skill, ...(args.tools ? { tools: args.tools } : {}), ...(args.arm ? { arm: args.arm } : {}), ...(hidden.size ? { hidden: [...hidden] } : {}), seconds: Math.round((performance.now() - t0) / 1000),
    score: checks.filter((c) => c.pass).length / checks.length, passed: checks.filter((c) => c.pass).length, total: checks.length,
    checks, tool_calls: session.log.length, tool_errors: session.log.filter((l) => l.error).length, usage: session.usage, usd: +usd.toFixed(4),
    page_bytes: after.page ? new TextEncoder().encode(after.page).length : 0, data: after.data,
    answer: session.answer, calls: session.log.map((l) => ({ ...l, args: JSON.parse(short(l.args, 800).startsWith("{") ? JSON.stringify(Object.fromEntries(Object.entries(l.args).map(([k, v]) => [k, short(v, 300)]))) : "{}") })),
    render: render ? { ...render, markdownAfter: undefined } : null,
    breakage, walk,
    gate: await (async () => {
      const held = session.log.filter((l) => /"live":\s*"Held back/.test(String((l as { result?: string }).result ?? ""))).length;
      const live = session.log.filter((l) => /"live":\s*"Live/.test(String((l as { result?: string }).result ?? ""))).length;
      const [row] = (await s.pg.query(`select draft_ct is not null as draft from public.note_pages where note_id = (select note_id from public.note_pages order by updated_at desc limit 1)`).catch(() => ({ rows: [] }))).rows as { draft: boolean }[];
      // Tests in the final app (live, else the draft the AI left), beyond the starter's two.
      return { held_back_saves: held, live_saves: live, ended_with_draft: !!row?.draft };
    })(),
    tests_written: (() => { try { const f = JSON.parse(after.page ?? "{}").files ?? {}; return Object.entries(f as Record<string, string>).filter(([p]) => /^\/tests?\//.test(p)).reduce((n, [, t]) => n + (t.match(/\b(it|test)\s*\(/g) ?? []).length, 0); } catch { return 0; } })(),
    // The final app's tests: how many, how many assertions, and anything skipped (the starter has 2 tests, 6 assertions).
    test_shape: (() => { try {
      const t = Object.entries((JSON.parse(after.page ?? "{}").files ?? {}) as Record<string, string>).filter(([p]) => /^\/tests?\//.test(p)).map(([, x]) => x).join("\n");
      return { tests: (t.match(/\b(it|test)\s*\(/g) ?? []).length, expects: (t.match(/\bexpect\s*\(/g) ?? []).length, skipped: (t.match(/\b(it|test|describe)\.(skip|todo)\b|\bx(it|describe)\s*\(/g) ?? []).length };
    } catch { return null; } })(),
    used: { try_app: session.log.filter((l) => l.name.endsWith("try_app") || (l.name.endsWith("see_app") && Array.isArray((l.args as { steps?: unknown }).steps))).length, see_app: session.log.filter((l) => l.name.endsWith("see_app")).length, run_app_tests: session.log.filter((l) => l.name.endsWith("run_app_tests")).length,
      test_files: Object.keys(((): Record<string, string> => { try { return JSON.parse(after.page ?? "{}").files ?? {}; } catch { return {}; } })()).filter((p) => /^\/tests?\//.test(p)).length },
  };
  await Deno.writeTextFile(new URL(`${stem}.json`, outDir), JSON.stringify(result, null, 2));
  const cli = model.provider === "claude-cli" || model.provider === "codex-cli";
  const trace = {
    task: task.id, rep, model: model.id, round, started_at: tr.started_at, seconds: +sessionSeconds.toFixed(1),
    score: result.score, passed: result.passed, total: result.total,
    context: {
      date: tr.started_at.slice(0, 10),
      model: model.id,
      settings: {
        via: model.provider, prompt: task.prompt,
        // The system text we pass (the CLIs add their own around it; the API paths send exactly this).
        system: model.provider === "codex-cli" ? `${cliSystem}\n\n---\n\n${task.prompt}` : cli ? cliSystem : system,
        tools: args.tools ?? "pages", skill: !!skill, hidden: [...hidden], arm: args.arm ?? null,
        ...(cli ? { cli_model: args["cli-model"] ?? (model.provider === "claude-cli" ? "sonnet" : "default"), max_turns: Number(args["max-turns"] ?? 40), minutes: Number(args.minutes ?? 30) } : {}),
      },
      backend: { mcp_url: s.url, server: "supabase/functions/mcp/server.ts, in process", database: "PGlite in memory, every migration, one test account", render: Deno.env.get("RENDER_URL"), production: false },
      server_instructions: s.init.instructions ?? null,
      tools_list: toolsList,
      seeded: {
        notes: seeded.map((n) => ({ path: `${n.folder ? n.folder + "/" : ""}${n.title}.md`, pinned: n.pinned, content: n.body })),
        ...([task.seed, ...(task.others ?? [])].some((x) => x.page || x.data) ? { apps: [task.seed, ...(task.others ?? [])].filter((x) => x.page || x.data).map((x) => ({ note: x.body.split("\n")[0], page: x.page ?? null, data: x.data ?? null })) } : {}),
        ...(task.files?.length ? { files: task.files } : {}),
        ...(task.apiKeys?.length ? { api_keys: task.apiKeys } : {}),
      },
    },
    events: tr.events, answer: session.answer,
  };
  await Deno.writeTextFile(new URL(`${stem}.trace.json`, outDir), JSON.stringify(trace, null, 2));
  if (cli && tr.raw !== undefined) await Deno.writeTextFile(new URL(`${stem}.stream.jsonl`, outDir), tr.raw);
  await Deno.writeTextFile(new URL(`${stem}.page.html`, outDir), after.page ?? "");
  await Deno.writeTextFile(new URL(`${stem}.note.md`, outDir), after.body);
  await s.http.shutdown();
  await s.pg.close();
  const failed = checks.filter((c) => !c.pass).map((c) => `${c.name}${c.detail ? ` (${c.detail.slice(0, 80)})` : ""}`);
  console.log(`${task.id.padEnd(26)} ${(result.score * 100).toFixed(0).padStart(3)}%  ${String(result.tool_calls).padStart(2)} calls  $${usd.toFixed(3)}  ${failed.length ? "FAIL: " + failed.join("; ") : ""}`);
  return result;
}

const wanted = args.tasks ? args.tasks.split(",").map((s) => s.trim()) : TASKS.map((t) => t.id);
const reps = Math.max(1, Number(args.repeat ?? 1));
const queue = wanted.flatMap((id) => { const t = TASKS.find((x) => x.id === id); if (!t) throw new Error(`No task ${id}`); return Array.from({ length: reps }, (_, k) => ({ t, rep: k + 1 })); });
const results: Awaited<ReturnType<typeof runTask>>[] = [];
// The Mac is shared: the CLIs run at most two at a time.
const workers = Math.min(Number(args.concurrency ?? 2), ["claude-cli", "codex-cli"].includes(model.provider) ? 2 : 4);
await Promise.all(Array.from({ length: workers }, async () => {
  while (queue.length) {
    // The CLIs bill nothing per token, so the paid-API budget doesn't stop them.
    if (paid && await spent() > BUDGET) { console.log(`Budget of $${BUDGET} reached; stopping.`); return; }
    const { t, rep } = queue.shift()!;
    try { results.push(await runTask(t, rep)); } catch (e) { console.error(`${t.id}: ${(e as Error).stack ?? e}`); }
  }
}));
await closeBrowser();
await renderServer.shutdown();
const mean = results.reduce((s, r) => s + r.score, 0) / (results.length || 1);
const usd = results.reduce((s, r) => s + r.usd, 0);
console.log(`\n${round} ${model.id}${skill ? " +skill" : ""}: ${results.length} tasks, mean ${(mean * 100).toFixed(1)}%, ${results.reduce((s, r) => s + r.tool_calls, 0)} tool calls, $${usd.toFixed(2)} (all rounds so far $${(await spent()).toFixed(2)})`);
