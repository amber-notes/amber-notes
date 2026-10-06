// How the file tools scale with the account: seeds accounts of N notes (nested folders, sub-notes,
// a few apps and files) and times list, fetch, search and edit, with where the time went
// (the Server-Timing parts: rows read, titles opened, texts opened). No model calls.
//   deno run -A scripts/page-evals/scale-bench.ts [50,500,5000] [--repeat 3]
// Against a hosted server instead (MCP_URL and MCP_TOKEN set): scripts/page-evals/scale-bench.ts --remote
import { parseArgs } from "jsr:@std/cli@1/parse-args";
import "../../supabase/functions/mcp/tools.ts";
import { schemaDB } from "../../supabase/functions/mcp/pglite.ts";
import { account, app, file, folder, note, toolContext } from "../../supabase/functions/mcp/sealed.ts";
import { runFileTool } from "../../supabase/functions/mcp/files_tools.ts";
import { Paths } from "../../supabase/functions/mcp/paths.ts";
import { scaffold } from "../../supabase/functions/mcp/app_scaffold.ts";
import { withFiles } from "../../supabase/functions/mcp/app_files.ts";
import { linkProject, serialize } from "../../supabase/functions/mcp/app_project.ts";

const args = parseArgs(Deno.args, { string: ["repeat"], boolean: ["remote"] });
const sizes = String(args._[0] ?? "50,500,5000").split(",").map(Number);
const repeat = Number(args.repeat ?? 3);

const WORDS = "meeting budget invoice lisbon deposit apartment client roadmap sprint review recipe running coffee design hiring travel plan notes ideas draft".split(" ");
const pick = (i: number, k: number) => WORDS[(i * 7 + k * 13) % WORDS.length];
const body = (i: number) => `Note ${i} ${pick(i, 0)}\n\n## ${pick(i, 1)}\n\n` + Array.from({ length: 12 + (i % 30) }, (_, k) => `- ${pick(i, k)} ${pick(i, k + 3)} ${i * k % 997} ${k % 5 === 0 ? "- [ ] todo" : ""}`).join("\n");

/** One account: ~N/25 folders three deep, a sub-note for every 20th note, 3 apps, 10 files. */
async function seed(n: number) {
  const pg = await schemaDB();
  const a = await account(pg);
  const folders: string[] = [];
  const nf = Math.max(4, Math.round(n / 25));
  for (let i = 0; i < nf; i++) folders.push(await folder(pg, a, `Folder ${i}`, i < 8 ? null : folders[(i * 3) % Math.min(i, 40)]));
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const parent = i % 20 === 19 ? ids[i - 1] : null;
    ids.push(await note(pg, a, body(i), { folder: folders[i % nf], parent }));
  }
  // The Lisbon deposit, somewhere deep.
  await note(pg, a, "Apartment hunt\n\nLisbon apartment: the deposit is 2 months' rent.\n", { folder: folders[nf - 1] });
  for (let k = 0; k < 10; k++) {
    const f = await file(pg, a, `scan-${k}.pdf`, "com.adobe.pdf", new Uint8Array(100));
    await app(pg, a.id, `update public.notes set body_ct = $2 where id = $1`, [ids[k], await a.vault.sealBody(ids[k], body(k) + `\n![scan-${k}.pdf](pane-file:${f.id})\n`)]);
  }
  const project = serialize((await linkProject(await withFiles({ amberApp: 1, files: {}, compiled: {} }, scaffold("Habits")))).project);
  for (let k = 0; k < 3; k++) await app(pg, a.id, `insert into public.note_pages (note_id, page_ct) values ($1, $2)`, [ids[100 % n + k], await a.vault.sealPage(ids[100 % n + k], project)]);
  return { pg, a, folders };
}

type Row = { op: string; ms: number; parts: Record<string, number> };
async function time(ctxOf: () => Promise<Parameters<typeof runFileTool>[2]>, op: string, name: string, a: Record<string, unknown>): Promise<Row> {
  const ctx = await ctxOf();
  const t = performance.now();
  try { await runFileTool(name, a, ctx); } catch (e) { return { op: `${op} (error: ${(e as Error).message.slice(0, 60)})`, ms: performance.now() - t, parts: ctx.timing ?? {} }; }
  return { op, ms: performance.now() - t, parts: ctx.timing ?? {} };
}

for (const n of sizes) {
  const t0 = performance.now();
  const { pg, a } = await seed(n);
  console.log(`\n${n} notes (seeded in ${Math.round((performance.now() - t0) / 1000)} s)`);
  const ctxOf = async () => ({ ...(await toolContext(pg, a)), session: "bench", timing: {} });
  const deep = (await runFileTool("list", { pattern: "**/Note 3 *.md" }, await ctxOf()) as { matches: { path: string }[] }).matches[0]?.path ?? "Note 3.md";
  const appPath = (await runFileTool("list", { pattern: "**/*.app" }, await ctxOf()) as { matches: { path: string }[] }).matches[0]?.path ?? "";
  const ops: [string, string, Record<string, unknown>][] = [
    ["list root", "list", {}],
    ["list deep folder", "list", { path: deep.split("/").slice(0, -1).join("/") + "/" }],
    ["list glob **/*.md", "list", { pattern: "**/*.md", limit: 100 }],
    ["fetch note", "fetch", { id: deep }],
    ["fetch app file", "fetch", { id: `${appPath}src/App.tsx` }],
    ["search ranked", "search", { query: "lisbon deposit" }],
    ["search grep", "search", { pattern: "deposit", output: "content" }],
    ["search grep scoped", "search", { pattern: "todo", path: deep.split("/")[0] + "/" }],
    ["edit note", "edit", { path: deep, old_string: `## ${pick(3, 1)}`, new_string: `## ${pick(3, 1)}!` }],
  ];
  const results = new Map<string, Row[]>();
  for (let r = 0; r < repeat; r++) {
    // The first round starts cold (no titles cached), like a new isolate.
    if (r === 0) Paths.forget(a.vault);
    for (const [label, name, x] of ops) {
      // The edit goes back and forth, so each round has something to change.
      const row = await time(ctxOf, label, name, label === "edit note" && r % 2 ? { ...x, old_string: x.new_string, new_string: x.old_string } : x);
      (results.get(label) ?? results.set(label, []).get(label)!).push(row);
    }
  }
  console.log("op".padEnd(22), "cold ms".padStart(8), "warm ms".padStart(8), "  where (cold)");
  for (const [label, rows] of results) {
    const warm = rows.slice(1).map((r) => r.ms);
    const p = rows[0].parts;
    console.log(label.padEnd(22), String(Math.round(rows[0].ms)).padStart(8), String(Math.round(warm.length ? Math.min(...warm) : NaN)).padStart(8),
      `  rows ${p.notes ?? "-"}, titles opened ${p.paths_opened ?? 0} (${Math.round(p.paths_open ?? 0)} ms), db ${Math.round(p.paths_db ?? 0)} ms, build ${Math.round(p.paths_build ?? 0)} ms${p.search_notes ? `, texts opened ${p.search_notes} (${Math.round(p.search_open ?? 0)} ms)` : ""}${rows[0].op !== label ? `  ${rows[0].op}` : ""}`);
  }
  await pg.close();
}
