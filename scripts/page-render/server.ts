// The render service behind check_app and preview_app. Supabase edge functions can't run a
// browser, so the MCP server sends a note's app (its HTML, a sample note and sample data, or the
// real ones when the person allowed that) here, and gets back measurements and screenshots.
//
//   RENDER_SECRET=… deno run -A scripts/page-render/server.ts [--port 8790]
//   POST /render  Authorization: Bearer <RENDER_SECRET>
//     { html, markdown, data?, today?, views?: [{ width, scheme }], capture?: boolean, interact?: boolean, probes?: boolean, widget?: boolean, steps?: [...] }
//   -> { views: [...], interaction, probes, blocked, ms }
//   POST /build   (same header) the app's build step, which the hosted edge runtime can't run:
//     { compile: [{ path, source }], jsx: "react" | "preact" } -> { compiled: { [path]: { code } | { error } } }
//     { tailwind: css, sources } -> { css } | { error }
//
// Nothing is stored or logged but timings and sizes. Each request gets fresh browser contexts with
// no network: the page's own requests are refused, as in the app.
import { renderPage, type RenderOptions, type Step, testRunnerProject } from "./render.ts";
import { compileHere, tailwindHere } from "../../supabase/functions/mcp/app_build.ts";

const MAX_BODY = 2 * 1024 * 1024;
/** A whole project's sources can reach 3 MB (MAX_PROJECT_BYTES in app_project.ts). */
const MAX_BUILD_BODY = 4 * 1024 * 1024;
const secret = Deno.env.get("RENDER_SECRET");
if (!secret) throw new Error("Set RENDER_SECRET.");

/** One render at a time per instance: WebKit is the bottleneck, and a queue keeps memory flat. */
let chain: Promise<unknown> = Promise.resolve();
const serial = <T>(fn: () => Promise<T>): Promise<T> => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

/** The container's memory in use (cgroup v2, on Linux), WebKit included; null elsewhere. */
function memory(): number | null {
  try { return Number(Deno.readTextFileSync("/sys/fs/cgroup/memory.current").trim()); } catch { return null; }
}

export async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  if (req.method === "GET" && url.pathname === "/health") return new Response("ok");
  if (req.method !== "POST" || (url.pathname !== "/render" && url.pathname !== "/build")) return new Response("Not found", { status: 404 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  if (url.pathname === "/build") return await buildRequest(await req.text());
  const text = await req.text();
  if (text.length > MAX_BODY) return new Response("Too big", { status: 413 });
  let body: { html?: unknown; markdown?: unknown; data?: unknown; today?: unknown; views?: unknown; capture?: unknown; interact?: unknown; probes?: unknown; widget?: unknown; steps?: unknown; tests?: unknown; smoke?: unknown };
  try { body = JSON.parse(text); } catch { return new Response("Bad JSON", { status: 400 }); }
  if (typeof body.html !== "string" || typeof body.markdown !== "string") return new Response("html and markdown are required", { status: 400 });
  const views = Array.isArray(body.views) ? (body.views as { width: number; scheme: string }[])
    .filter((v) => Number.isInteger(v.width) && v.width >= 320 && v.width <= 1800 && (v.scheme === "light" || v.scheme === "dark")).slice(0, 4) as RenderOptions["views"] : undefined;
  const t0 = performance.now();
  // run_app_tests: the project's tests instead of the app.
  if (body.tests === true) {
    const runner = testRunnerProject(body.html as string);
    if (!runner) return Response.json({ views: [], tests: [], testErrors: ["The project has no tests/*.test.tsx files."], ms: 0 });
    body.html = runner;
  }
  const r = await serial(() => renderPage(body.html as string, body.markdown as string, body.data ?? {}, {
    today: typeof body.today === "string" ? body.today : new Date().toISOString().slice(0, 10),
    views, capture: body.capture === true, interact: body.interact === true, probes: body.probes !== false, widget: body.widget === true,
    ...(Array.isArray(body.steps) ? { steps: (body.steps as Step[]).slice(0, 30) } : {}), ...(body.tests === true ? { tests: true } : {}), ...(body.smoke === true ? { smoke: true } : {}),
  }));
  const ms = Math.round(performance.now() - t0);
  console.log(JSON.stringify({ at: new Date().toISOString(), ms, views: r.views.length, bytes: text.length, memoryBytes: memory() }));
  return Response.json({ views: r.views.map(({ screenshot: _, ...v }) => v), interaction: r.interaction, probes: r.probes, blocked: r.blocked, ms, memoryBytes: memory(), ...(r.trial ? { trial: r.trial, dataAfter: r.dataAfter } : {}), ...(r.tests ? { tests: r.tests, testErrors: r.testErrors } : {}), ...(r.smoke ? { smoke: r.smoke } : {}) });
}

async function buildRequest(text: string): Promise<Response> {
  if (text.length > MAX_BUILD_BODY) return new Response("Too big", { status: 413 });
  let body: { compile?: unknown; jsx?: unknown; tailwind?: unknown; sources?: unknown };
  try { body = JSON.parse(text); } catch { return new Response("Bad JSON", { status: 400 }); }
  const t0 = performance.now();
  if (Array.isArray(body.compile)) {
    const items = (body.compile as { path?: unknown; source?: unknown }[]).filter((x) => typeof x?.path === "string" && typeof x?.source === "string").slice(0, 200) as { path: string; source: string }[];
    const compiled = await compileHere(items, body.jsx === "react" ? "react" : "preact");
    console.log(JSON.stringify({ at: new Date().toISOString(), build: "compile", files: items.length, ms: Math.round(performance.now() - t0), bytes: text.length }));
    return Response.json({ compiled });
  }
  if (typeof body.tailwind === "string" && typeof body.sources === "string") {
    let out: { css: string } | { error: string };
    try { out = { css: await tailwindHere(body.tailwind, body.sources) }; } catch (e) { out = { error: (e as Error).message }; }
    console.log(JSON.stringify({ at: new Date().toISOString(), build: "tailwind", ms: Math.round(performance.now() - t0), bytes: text.length }));
    return Response.json(out);
  }
  return new Response("compile or tailwind is required", { status: 400 });
}

if (import.meta.main) {
  // Hosted (Railway): $PORT on every interface. On a Mac: 127.0.0.1 only.
  const hosted = Deno.env.get("PORT");
  const port = Number(hosted) || Number(Deno.args[Deno.args.indexOf("--port") + 1]) || 8790;
  Deno.serve({ port, hostname: hosted ? "0.0.0.0" : "127.0.0.1" }, handle);
}
