// The unconstrained baseline: the same request given to Claude Code or Codex in a plain empty
// folder, any framework, free to install packages, run a dev server and look at its work. Then the
// result is built (if it has a build) and shot in WebKit at 390 and 1440 px, for a contact sheet
// next to what the same CLI makes through Amber's MCP tools (run.ts).
//   deno run -A scripts/page-evals/baseline.ts --cli claude|codex [--task workout-tracker-data | --prompt "..."] [--label workout-1] [--out <dir>]
//   deno run -A scripts/page-evals/baseline.ts --shoot <project dir>     # only build and shoot
// Subscription CLIs only: API keys are removed from the environment, and a claude session that
// reports one is stopped.
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import { webkit } from "npm:playwright-core@1.63.0";

import { TASKS } from "./tasks.ts";

const args = parseArgs(Deno.args, { string: ["cli", "prompt", "task", "label", "out", "shoot", "cli-model"] });
// --task uses a task's request word for word, so both sides get the same one.
const PROMPT = args.task ? TASKS.find((t) => t.id === args.task)!.prompt : args.prompt ?? "build me a workout tracker app";
const OUT = args.out ?? `${Deno.env.get("HOME")}/content-tools/projects/amber-proto/note-pages/baseline`;
const ENV = (() => { const e = Deno.env.toObject(); for (const k of ["ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "RENDER_SECRET"]) delete e[k]; return e; })();

async function run(cmd: string, cmdArgs: string[], cwd: string, env = ENV, timeoutMs = 45 * 60_000) {
  const p = new Deno.Command("nice", { args: ["-n", "10", cmd, ...cmdArgs], cwd, env, clearEnv: true, stdout: "piped", stderr: "piped" }).spawn();
  const timer = setTimeout(() => { try { p.kill("SIGTERM"); } catch { /* gone */ } }, timeoutMs);
  const out = await p.output();
  clearTimeout(timer);
  return { code: out.code, stdout: new TextDecoder().decode(out.stdout), stderr: new TextDecoder().decode(out.stderr) };
}

async function build(dir: string): Promise<{ cli: string; label: string; minutes: number; turns: number; answer: string }> {
  const t0 = performance.now();
  const project = `${dir}/project`;
  await Deno.mkdir(project, { recursive: true });
  let r, turns = 0, answer = "";
  if (args.cli === "claude") {
    await Deno.writeTextFile(`${dir}/mcp.json`, JSON.stringify({ mcpServers: {} }));
    // Claude Code as it ships (its own system prompt and tools), without the user's settings, hooks,
    // CLAUDE.md or MCP servers, allowed to do anything inside the folder.
    r = await run("claude", ["-p", PROMPT, "--model", args["cli-model"] ?? "sonnet", "--setting-sources", "local", "--strict-mcp-config", "--mcp-config", `${dir}/mcp.json`,
      "--permission-mode", "bypassPermissions", "--output-format", "stream-json", "--verbose", "--no-session-persistence", "--max-turns", "120"], project);
    for (const line of r.stdout.split("\n")) {
      // deno-lint-ignore no-explicit-any
      let ev: any; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === "system" && ev.subtype === "init" && ev.apiKeySource && ev.apiKeySource !== "none") throw new Error(`claude used ${ev.apiKeySource}: stopping.`);
      if (ev.type === "assistant") turns++;
      if (ev.type === "result" && typeof ev.result === "string") answer = ev.result;
    }
  } else if (args.cli === "codex") {
    const home = await Deno.makeTempDir({ prefix: "amber-baseline-codex-" });
    await Deno.symlink(`${Deno.env.get("HOME")}/.codex/auth.json`, `${home}/auth.json`);
    await Deno.writeTextFile(`${home}/config.toml`, [...(args["cli-model"] ? [`model = "${args["cli-model"]}"`] : []), `model_reasoning_effort = "medium"`,
      `[sandbox_workspace_write]`, `network_access = true`].join("\n") + "\n");
    // Codex's own sandbox: writes only inside the folder, with network for package installs.
    r = await run("codex", ["exec", "--json", "--skip-git-repo-check", "--ephemeral", "-s", "workspace-write", PROMPT], project, { ...ENV, CODEX_HOME: home });
    for (const line of r.stdout.split("\n")) {
      // deno-lint-ignore no-explicit-any
      let ev: any; try { ev = JSON.parse(line); } catch { continue; }
      if (ev.type === "item.completed" && ev.item?.type === "agent_message") answer = ev.item.text ?? answer;
      if (ev.type === "item.completed") turns++;
    }
    await Deno.remove(home, { recursive: true }).catch(() => {});
  } else throw new Error("--cli claude|codex");
  await Deno.writeTextFile(`${dir}/session.jsonl`, r.stdout);
  if (r.stderr.trim()) await Deno.writeTextFile(`${dir}/stderr.txt`, r.stderr);
  return { cli: args.cli, label: dir.split("/").pop()!, minutes: Math.round((performance.now() - t0) / 6000) / 10, turns, answer };
}

/** Builds the project if it has a build script, and finds the folder to serve. */
async function servable(project: string): Promise<{ root: string; note: string }> {
  const exists = (p: string) => Deno.stat(p).then(() => true, () => false);
  // A project may sit one folder down (create-vite makes one).
  let dir = project;
  if (!(await exists(`${dir}/package.json`)) && !(await exists(`${dir}/index.html`))) {
    for await (const e of Deno.readDir(project)) if (e.isDirectory && (await exists(`${project}/${e.name}/package.json`) || await exists(`${project}/${e.name}/index.html`))) { dir = `${project}/${e.name}`; break; }
  }
  if (await exists(`${dir}/package.json`)) {
    const pkg = JSON.parse(await Deno.readTextFile(`${dir}/package.json`));
    if (pkg.scripts?.build) {
      if (!(await exists(`${dir}/node_modules`))) await run("npm", ["install", "--no-audit", "--no-fund"], dir, ENV, 10 * 60_000);
      const b = await run("npm", ["run", "build", "--", "--base", "./"], dir, ENV, 10 * 60_000);
      const b2 = b.code === 0 ? b : await run("npm", ["run", "build"], dir, ENV, 10 * 60_000);
      for (const out of ["dist", "build", "out"]) if (await exists(`${dir}/${out}/index.html`)) return { root: `${dir}/${out}`, note: `npm run build (${out}/)` };
      return { root: dir, note: `build failed: ${(b2.stderr || b2.stdout).slice(-300)}` };
    }
  }
  for (const f of ["index.html", "public/index.html", "src/index.html"]) if (await exists(`${dir}/${f}`)) return { root: `${dir}/${f.replace(/\/?index\.html$/, "") || "."}`.replace(/\/\.$/, ""), note: "static files" };
  return { root: dir, note: "no index.html found" };
}

const TYPES: Record<string, string> = { html: "text/html", js: "text/javascript", mjs: "text/javascript", css: "text/css", json: "application/json", svg: "image/svg+xml", png: "image/png", ico: "image/x-icon", webmanifest: "application/manifest+json" };

async function shoot(project: string, prefix: string) {
  const { root, note } = await servable(project);
  const ac = new AbortController();
  const server = Deno.serve({ port: 0, hostname: "127.0.0.1", signal: ac.signal, onListen: () => {} }, async (req) => {
    let path = decodeURIComponent(new URL(req.url).pathname);
    if (path.endsWith("/")) path += "index.html";
    try { const body = await Deno.readFile(`${root}${path}`); return new Response(body, { headers: { "content-type": TYPES[path.split(".").pop()!] ?? "application/octet-stream" } }); }
    catch { return new Response(await Deno.readFile(`${root}/index.html`).catch(() => new Uint8Array()), { headers: { "content-type": "text/html" } }); }
  });
  const url = `http://127.0.0.1:${server.addr.port}/`;
  const browser = await webkit.launch();
  const errors: string[] = [];
  for (const [w, h, scheme] of [[390, 844, "light"], [390, 844, "dark"], [1440, 900, "light"]] as const) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme: scheme, deviceScaleFactor: 2 });
    page.on("pageerror", (e) => errors.push(`${w}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${w}: ${m.text().slice(0, 200)}`); });
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 }).catch((e) => errors.push(String(e).slice(0, 200)));
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${prefix}-${w}-${scheme}.png`, fullPage: w < 600 });
    await page.close();
  }
  await browser.close();
  ac.abort();
  await server.finished.catch(() => {});
  return { served: root, how: note, errors: [...new Set(errors)].slice(0, 10) };
}

if (args.shoot) {
  console.log(JSON.stringify(await shoot(`${args.shoot}/project`, `${args.shoot}/shot`), null, 2));
} else {
  const dir = `${OUT}/${args.cli}-${args.label ?? new Date().toISOString().slice(0, 16).replace(/[:T]/g, "")}`;
  await Deno.mkdir(dir, { recursive: true });
  const session = await build(dir);
  const shots = await shoot(`${dir}/project`, `${dir}/shot`);
  const summary = { prompt: PROMPT, ...session, ...shots };
  await Deno.writeTextFile(`${dir}/summary.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ...summary, answer: summary.answer.slice(0, 400) }, null, 2));
}
