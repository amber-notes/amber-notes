// Runs the tasks' hidden walkthroughs again over a round's saved apps (no model calls): for when the
// walkthrough itself changed. Prints each run's probes and the per-arm pass rate.
//   deno run -A scripts/page-evals/rewalk.ts <round> [only runs whose name has this]
import { closeBrowser, renderPage } from "../page-render/render.ts";
import { TASKS } from "./tasks.ts";
const dir = new URL(`results/${Deno.args[0]}/`, import.meta.url).pathname;
const arms = new Map<string, number[]>();
for (const e of [...Deno.readDirSync(dir)].filter((x) => (x.name.endsWith(".json") && !x.name.endsWith(".trace.json")) && (!Deno.args[1] || x.name.includes(Deno.args[1]))).sort((a, b) => a.name.localeCompare(b.name))) {
  const r = JSON.parse(Deno.readTextFileSync(dir + e.name));
  const task = TASKS.find((t) => t.id === r.task);
  const page = Deno.readTextFileSync(dir + e.name.replace(/\.json$/, ".page.html"));
  if (!task?.walkthrough || !page) continue;
  const res: string[] = [];
  let pass = 0;
  for (const probe of task.walkthrough) {
    const out = await renderPage(page, Deno.readTextFileSync(dir + e.name.replace(/\.json$/, ".note.md")), r.data ?? {}, { today: "2026-10-05", steps: probe.steps, views: [{ width: probe.desktop ? 1280 : 390, scheme: "light" }] }).catch(() => null);
    const bad = out?.trial?.find((t) => !t.ok || t.errors.length);
    if (out?.trial?.length && !bad) pass++; else res.push(`${probe.name}: ${bad ? `${JSON.stringify(bad.step)} ${bad.error ?? bad.errors[0]}` : "didn't run"}`);
  }
  const arm = `${r.model.split(":")[0]} ${r.arm === "screens" || r.hidden?.length ? "screens" : "steps+tests"}`;
  arms.set(arm, [...(arms.get(arm) ?? []), pass / task.walkthrough.length]);
  console.log(e.name.padEnd(50), `${pass}/${task.walkthrough.length}`, res.join(" | ").slice(0, 300));
}
await closeBrowser();
for (const [k, v] of arms) console.log(k.padEnd(24), `${Math.round(100 * v.reduce((a, b) => a + b, 0) / v.length)}%`, `(${v.length} runs)`);
