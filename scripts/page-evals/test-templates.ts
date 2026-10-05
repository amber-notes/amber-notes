// The template library, tested the way the evals test a model's page: each template over a sample
// note in headless WebKit at 390 and 1280 px, light and dark, plus the robustness probes.
//   deno run -A scripts/page-evals/test-templates.ts [--shots <dir>]
import { pageProblems } from "../../supabase/functions/mcp/page.ts";
import { pageWarnings } from "../../supabase/functions/mcp/page_lint.ts";
import { titleReport, type Rendered } from "../../supabase/functions/mcp/app_check.ts";
import { noteForPage } from "../../supabase/functions/mcp/page_input.ts";
import { PAGE_TEMPLATES } from "../../supabase/functions/mcp/page_templates.gen.ts";
import { closeBrowser, renderPage } from "../page-render/render.ts";
import { scoreTask } from "./score.ts";
import type { Task } from "./tasks.ts";

// Each template's sample note (templates/<name>.sample.md, ready to ship as a sample app note), and
// some saved settings (values.settings, set in each app) and data, so the settings path is exercised too.
const dir = new URL("../../plugins/amber-notes/skills/note-pages/templates/", import.meta.url);
const DATA: Record<string, Record<string, unknown>> = {
  "habit-tracker": { values: { settings: { goal: 4 } }, collections: {} },
  budget: { values: { settings: { budget: 15000, currency: "EUR", categories: ["Food", "Housing"] } }, collections: {} },
  "workout-log": { values: { settings: { weeklyKm: 25 } }, collections: {} },
  crm: { values: { settings: { stages: ["Lead", "Meeting", "Proposal", "Won", "Lost"] } }, collections: {} },
  flashcards: { values: { known: { comer: "2026-10-01" } }, collections: {} },
};
const SAMPLES: Record<string, { body: string; data?: Record<string, unknown> }> = Object.fromEntries(
  PAGE_TEMPLATES.map((t) => [t.name, { body: Deno.readTextFileSync(new URL(`${t.name}.sample.md`, dir)), data: DATA[t.name] }]),
);

const shots = Deno.args.includes("--shots") ? Deno.args[Deno.args.indexOf("--shots") + 1] : undefined;
if (shots) await Deno.mkdir(shots, { recursive: true });
let failed = 0;
for (const t of PAGE_TEMPLATES) {
  const sample = SAMPLES[t.name];
  if (!sample) { console.log(`${t.name}: no sample note`); failed++; continue; }
  const task: Task = { id: t.name, prompt: "", seed: { body: sample.body }, page: true, interact: true, checks: () => [] };
  const render = await renderPage(t.html, sample.body, sample.data ?? {}, { today: "2026-10-05", interact: true, shots: shots ? `${shots}/${t.name}` : undefined });
  const checks = scoreTask(task, { before: sample.body, after: sample.body, pageBefore: null, page: t.html, dataBefore: null, data: sample.data ?? null, calls: [], answer: "The note's app.", others: [], render }, render, pageProblems);
  for (const t of titleReport(render as unknown as Rendered, noteForPage(sample.body, "2026-10-05").title)) checks.push({ name: "title", pass: false, detail: t });
  const bad = checks.filter((c) => !c.pass);
  const warnings = pageWarnings(t.html, sample.body);
  if (bad.length || warnings.length) failed++;
  console.log(`${t.name.padEnd(14)} ${checks.length - bad.length}/${checks.length}  ${(new TextEncoder().encode(t.html).length / 1024).toFixed(1)} KB  ${bad.map((c) => `${c.name} (${c.detail ?? ""})`).join("; ")}${warnings.length ? `  warnings: ${warnings.join(" | ")}` : ""}`);
}
await closeBrowser();
if (failed) Deno.exit(1);
