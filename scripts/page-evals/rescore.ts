// Page evals: score a round's saved sessions again (after a change to render.ts, score.ts or a
// task's checks) without running the models: the saved page, note, data and calls are re-read.
//   deno run -A scripts/page-evals/rescore.ts <round>
import { pageProblems } from "../../supabase/functions/mcp/page.ts";
import { closeBrowser, renderPage } from "../page-render/render.ts";
import { scoreTask } from "./score.ts";
import { TASKS, type Final } from "./tasks.ts";

const round = Deno.args[0];
const dir = new URL(`results/${round}/`, import.meta.url);
for await (const e of Deno.readDir(dir)) {
  if (!e.name.endsWith(".json")) continue;
  const path = new URL(e.name, dir);
  const r = JSON.parse(await Deno.readTextFile(path));
  const task = TASKS.find((t) => t.id === r.task);
  if (!task) continue;
  const stem = e.name.replace(/\.json$/, "");
  const page = await Deno.readTextFile(new URL(`${stem}.page.html`, dir)).catch(() => "") || null;
  const after = await Deno.readTextFile(new URL(`${stem}.note.md`, dir));
  const f: Final = {
    before: task.seed.body, after, pageBefore: task.seed.page ?? null, page, dataBefore: task.seed.data ?? null, data: r.data ?? null,
    calls: r.calls.map((c: { name: string; args: Record<string, unknown>; error: boolean }) => ({ name: c.name, args: c.args, error: c.error })), answer: r.answer, others: [],
  };
  if (page && (task.page || page !== f.pageBefore)) {
    await Deno.mkdir(new URL("shots/", dir), { recursive: true });
    f.render = await renderPage(page, after, r.data ?? {}, { shots: new URL(`shots/${stem}`, dir).pathname, today: "2026-10-05", interact: task.interact });
  }
  const checks = scoreTask(task, f, f.render, pageProblems);
  Object.assign(r, { checks, passed: checks.filter((c) => c.pass).length, total: checks.length, score: checks.filter((c) => c.pass).length / checks.length, render: f.render ? { ...f.render, markdownAfter: undefined } : null });
  await Deno.writeTextFile(path, JSON.stringify(r, null, 2));
  const failed = checks.filter((c) => !c.pass).map((c) => `${c.name}${c.detail ? ` (${String(c.detail).slice(0, 70)})` : ""}`);
  console.log(`${r.task.padEnd(26)} ${(r.score * 100).toFixed(0).padStart(3)}%  ${failed.length ? "FAIL: " + failed.join("; ") : ""}`);
}
await closeBrowser();
