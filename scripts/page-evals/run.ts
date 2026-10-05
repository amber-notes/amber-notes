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
import { TASKS, type Check, type Final, type Task } from "./tasks.ts";
import { scoreTask } from "./score.ts";

const args = parseArgs(Deno.args, { string: ["round", "model", "tasks", "server", "concurrency", "budget", "repeat", "label", "hide"], boolean: ["skill", "no-render"] });
/** Tools taken out of tools/list for this run (an A/B on check_app and preview_app, say). */
const hidden = new Set((args.hide ?? "").split(",").map((x) => x.trim()).filter(Boolean));
const round = args.round ?? "dev";
const modelKey = args.model ?? "sonnet";
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
const { account, app, file, note, opened } = await import(mcp("mcp/sealed.ts"));
const { tokenKey, wrap } = await import(mcp("_shared/e2ee.ts"));
const { pageProblems } = await import(mcp("mcp/page.ts"));

const MODELS: Record<string, { id: string; provider: "anthropic" | "openai" | "openrouter"; inPerM: number; outPerM: number; cacheReadPerM: number; cacheWritePerM: number }> = {
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

// What a chat client tells the model around an MCP server, kept short and neutral.
const CLIENT_SYSTEM = `You are an AI assistant. The person has connected their Amber Notes app to you with an MCP server, and its tools are available. The person is busy and won't answer questions before you finish: make sensible choices, do the whole task with the tools, then reply briefly with what you did. Today is 2026-10-05.`;
const variantKey = modelKey + (args.skill ? "-skill" : "") + (hidden.size ? `-no-${[...hidden].join("-")}` : "");
const skill = args.skill ? await Deno.readTextFile(new URL("plugins/amber-notes/skills/note-pages/SKILL.md", root)).catch(() => "") : "";

// MARK: An account and a connection

async function setup(task: Task) {
  const pg = await schemaDB();
  const sql = sqlFor(pg);
  const a = await account(pg);
  const id = await note(pg, a, task.seed.body);
  const others: string[] = [];
  for (const o of task.others ?? []) others.push(await note(pg, a, o.body));
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
    return { text: blocks.map((c) => (c.type === "text" ? c.text : `[${c.type}]`)).join("\n"), isError: r.isError === true, images: blocks.filter((c) => c.type === "image").map((c) => ({ data: c.data!, mimeType: c.mimeType! })) };
  };
  for (const [nid, s] of [[id, task.seed], ...(task.others ?? []).map((o, i) => [others[i], o] as const)] as const) {
    if (s.page) { const r = await call("set_note_page", { id: nid, html: s.page }); if (r.isError) throw new Error(`seed page: ${r.text}`); }
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
  return { pg, id, others, rpc, call, init, state, fileIds };
}

// MARK: A model session

type Called = { text: string; isError: boolean; images?: { data: string; mimeType: string }[] };

type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; turns: number };
type Logged = { name: string; args: Record<string, unknown>; error: boolean; result: string };

const short = (v: unknown, n = 400) => { const s = typeof v === "string" ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n) + `… (${s.length} chars)` : s; };

async function claudeSession(system: string, tools: { name: string; description: string; inputSchema: unknown }[], prompt: string, call: (n: string, a: Record<string, unknown>) => Promise<Called>) {
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
    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
    const text = res.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("\n");
    if (text) answer = text;
    if (res.stop_reason !== "tool_use" || !uses.length) break;
    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const u of uses) {
      const r: Called = await call(u.name, u.input as Record<string, unknown>).catch((e) => ({ text: String(e), isError: true }));
      log.push({ name: u.name, args: u.input as Record<string, unknown>, error: r.isError, result: short(r.text, 600) });
      const content: Anthropic.ToolResultBlockParam["content"] = r.images?.length
        ? [{ type: "text", text: r.text }, ...r.images.map((im) => ({ type: "image" as const, source: { type: "base64" as const, media_type: im.mimeType as "image/png", data: im.data } }))]
        : r.text;
      results.push({ type: "tool_result", tool_use_id: u.id, content, ...(r.isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
  }
  return { usage, log, answer };
}

async function openaiSession(system: string, tools: { name: string; description: string; inputSchema: unknown }[], prompt: string, call: (n: string, a: Record<string, unknown>) => Promise<Called>) {
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
      input.push({ type: "function_call_output", call_id: c.call_id, output: r.isError ? `Error: ${r.text}` : r.images?.length
        ? [{ type: "input_text", text: r.text }, ...r.images.map((im) => ({ type: "input_image", image_url: `data:${im.mimeType};base64,${im.data}` }))]
        : r.text });
    }
  }
  return { usage, log, answer };
}

/**
 * OpenRouter's chat completions with tools, for Claude and GPT alike. Anthropic models get cache
 * breakpoints on the system prompt and the newest message; images from preview_app go in a user
 * message after the tool results (tool messages are text there). Cost is OpenRouter's own figure.
 */
async function openrouterSession(system: string, tools: { name: string; description: string; inputSchema: unknown }[], prompt: string, call: (n: string, a: Record<string, unknown>) => Promise<Called>) {
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
    messages.push({ role: "assistant", content: msg.content ?? "", ...(calls.length ? { tool_calls: calls } : {}), ...(msg.reasoning_details ? { reasoning_details: msg.reasoning_details } : {}) });
    if (!calls.length) break;
    const images: { data: string; mimeType: string }[] = [];
    for (const c of calls) {
      let a: Record<string, unknown> = {};
      try { a = JSON.parse(c.function.arguments || "{}"); } catch { /* sent as is */ }
      const r: Called = await call(c.function.name, a).catch((e) => ({ text: String(e), isError: true }));
      log.push({ name: c.function.name, args: a, error: r.isError, result: short(r.text, 600) });
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
  const listed = (await s.rpc("tools/list")).tools.filter((t: { name: string }) => !hidden.has(t.name));
  const system = `${CLIENT_SYSTEM}\n\n<mcp_server name="amber-notes">\n${s.init.instructions}\n</mcp_server>${skill ? `\n\n<skill name="note-pages">\n${skill}\n</skill>` : ""}`;
  const session = model.provider === "anthropic" ? await claudeSession(system, listed, task.prompt, s.call)
    : model.provider === "openrouter" ? await openrouterSession(system, listed, task.prompt, s.call)
    : await openaiSession(system, listed, task.prompt, s.call);
  const after = await s.state(s.id);
  const othersAfter = await Promise.all(s.others.map((o) => s.state(o)));
  const f: Final = {
    before: before.body, after: after.body, pageBefore: before.page, page: after.page, dataBefore: before.data, data: after.data,
    calls: session.log.map((l) => ({ name: l.name, args: l.args, error: l.error })), answer: session.answer,
    others: othersBefore.map((o, i) => ({ before: o.body, after: othersAfter[i].body })), fileIds: s.fileIds,
  };
  const shots = new URL(`shots/${stem}`, outDir).pathname;
  await Deno.mkdir(new URL("shots/", outDir), { recursive: true });
  let render: Render | undefined;
  if (after.page && !args["no-render"] && (task.page || after.page !== before.page)) {
    render = await renderPage(after.page, after.body, after.data ?? {}, { shots, today: "2026-10-05", interact: task.interact || task.plays }).catch((e) => { console.error(task.id, "render failed", e); return undefined; });
    f.render = render;
  }
  const checks: Check[] = scoreTask(task, f, render, pageProblems);
  const usd = (session.usage as { usd?: number }).usd ?? cost(session.usage);
  await Deno.writeTextFile(SPEND, JSON.stringify({ at: new Date().toISOString(), round, task: task.id, model: model.id, via: model.provider, usd: +usd.toFixed(4), usage: session.usage }) + "\n", { append: true });
  const result = {
    task: task.id, rep, model: model.id, round, skill: !!skill, ...(hidden.size ? { hidden: [...hidden] } : {}), seconds: Math.round((performance.now() - t0) / 1000),
    score: checks.filter((c) => c.pass).length / checks.length, passed: checks.filter((c) => c.pass).length, total: checks.length,
    checks, tool_calls: session.log.length, tool_errors: session.log.filter((l) => l.error).length, usage: session.usage, usd: +usd.toFixed(4),
    page_bytes: after.page ? new TextEncoder().encode(after.page).length : 0, data: after.data,
    answer: session.answer, calls: session.log.map((l) => ({ ...l, args: JSON.parse(short(l.args, 800).startsWith("{") ? JSON.stringify(Object.fromEntries(Object.entries(l.args).map(([k, v]) => [k, short(v, 300)]))) : "{}") })),
    render: render ? { ...render, markdownAfter: undefined } : null,
  };
  await Deno.writeTextFile(new URL(`${stem}.json`, outDir), JSON.stringify(result, null, 2));
  await Deno.writeTextFile(new URL(`${stem}.page.html`, outDir), after.page ?? "");
  await Deno.writeTextFile(new URL(`${stem}.note.md`, outDir), after.body);
  await s.pg.close();
  const failed = checks.filter((c) => !c.pass).map((c) => `${c.name}${c.detail ? ` (${c.detail.slice(0, 80)})` : ""}`);
  console.log(`${task.id.padEnd(26)} ${(result.score * 100).toFixed(0).padStart(3)}%  ${String(result.tool_calls).padStart(2)} calls  $${usd.toFixed(3)}  ${failed.length ? "FAIL: " + failed.join("; ") : ""}`);
  return result;
}

const wanted = args.tasks ? args.tasks.split(",").map((s) => s.trim()) : TASKS.map((t) => t.id);
const reps = Math.max(1, Number(args.repeat ?? 1));
const queue = wanted.flatMap((id) => { const t = TASKS.find((x) => x.id === id); if (!t) throw new Error(`No task ${id}`); return Array.from({ length: reps }, (_, k) => ({ t, rep: k + 1 })); });
const results: Awaited<ReturnType<typeof runTask>>[] = [];
const workers = Number(args.concurrency ?? 3);
await Promise.all(Array.from({ length: workers }, async () => {
  while (queue.length) {
    if (await spent() > BUDGET) { console.log(`Budget of $${BUDGET} reached; stopping.`); return; }
    const { t, rep } = queue.shift()!;
    try { results.push(await runTask(t, rep)); } catch (e) { console.error(`${t.id}: ${(e as Error).stack ?? e}`); }
  }
}));
await closeBrowser();
await renderServer.shutdown();
const mean = results.reduce((s, r) => s + r.score, 0) / (results.length || 1);
const usd = results.reduce((s, r) => s + r.usd, 0);
console.log(`\n${round} ${model.id}${skill ? " +skill" : ""}: ${results.length} tasks, mean ${(mean * 100).toFixed(1)}%, ${results.reduce((s, r) => s + r.tool_calls, 0)} tool calls, $${usd.toFixed(2)} (all rounds so far $${(await spent()).toFixed(2)})`);
