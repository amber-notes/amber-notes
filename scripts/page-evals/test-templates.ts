// The template library, tested the way the evals test a model's page: each template over a sample
// note in headless WebKit at 390 and 1280 px, light and dark, plus the robustness probes.
//   deno run -A scripts/page-evals/test-templates.ts [--shots <dir>]
import { pageProblems } from "../../supabase/functions/mcp/page.ts";
import { pageWarnings } from "../../supabase/functions/mcp/page_lint.ts";
import { PAGE_TEMPLATES } from "../../supabase/functions/mcp/page_templates.gen.ts";
import { closeBrowser, renderPage } from "../page-render/render.ts";
import { scoreTask } from "./score.ts";
import type { Task } from "./tasks.ts";

const SAMPLES: Record<string, { body: string; data?: Record<string, unknown> }> = {
  "habit-tracker": { body: "Habits\n\n| Date | Walk | Read | Stretch |\n| --- | --- | --- | --- |\n| 2026-10-01 | ✓ | ✓ |  |\n| 2026-10-02 | ✓ |  | ✓ |\n| 2026-10-03 |  | ✓ | ✓ |\n| 2026-10-04 | ✓ | ✓ | ✓ |\n", data: { values: { goals: { Walk: 5 } }, collections: {} } },
  budget: { body: "October\n\n| Date | Item | Category | Amount |\n| --- | --- | --- | --- |\n| 2026-10-01 | Rent | Housing | 9 500 |\n| 2026-10-02 | Groceries | Food | 845 |\n| 2026-10-03 | Coffee & cake | Food | 92,50 |\n| 2026-10-04 | Cinema | Fun | 260 |\n", data: { values: { limit: 15000 }, collections: {} } },
  "reading-log": { body: "Reading\n\n| Title | Author | Finished | Rating |\n| --- | --- | --- | --- |\n| Piranesi | Susanna Clarke | 2026-07-02 | 4 |\n| The Dispossessed | Ursula K. Le Guin | 2026-09-12 | 5 |\n| Klara and the Sun | Kazuo Ishiguro | 2026-08-21 | 3 |\n\n## Want to read\n- [ ] Middlemarch\n- [ ] The Remains of the Day\n" },
  "workout-log": { body: "Workouts\n\n<!-- pane-table: Date=date; Type=choice Run|Bike|Swim|Gym; Km=number; Minutes=number -->\n| Date | Type | Km | Minutes |\n| --- | --- | --- | --- |\n| 2026-09-28 | Run | 5.1 | 29 |\n| 2026-09-30 | Gym |  | 50 |\n| 2026-10-02 | Bike | 22 | 61 |\n| 2026-10-04 | Run | 7.4 | 41 |\n", data: { values: { weeklyKm: 25 }, collections: {} } },
  crm: { body: "Clients\n\n| Company | Contact | Email | Stage | Value |\n| --- | --- | --- | --- | --- |\n| Acme AB | Sarah Lee | sarah@acme.se | Proposal | 8000 |\n| Nordljus | Erik Holm | erik@nordljus.se | Lead | 3000 |\n| Bergström & Co | Anna Berg | anna@bergstrom.se | Won | 15000 |\n" },
  "trip-log": { body: "Porto weekend\n\nHotel: Casa do Conto, Rua da Boavista 703\nFlights: TP 781 out, TP 784 back\n\n| Date | Time | What | Where |\n| --- | --- | --- | --- |\n| 2026-10-16 | 07:10 | Fly to Porto | ARN |\n| 2026-10-17 | 10:00 | Livraria Lello | Rua das Carmelitas |\n| 2026-10-18 | 19:40 | Fly home | OPO |\n\n## To do\n- [ ] Book Lello tickets\n- [x] Buy travel insurance\n\n## Ideas\n- [ ] Port tasting at Graham's\n" },
  flashcards: { body: "Spanish verbs\n\n| Spanish | English |\n| --- | --- |\n| hablar | to speak |\n| comer | to eat |\n| vivir | to live |\n| tener | to have |\n", data: { values: { known: { comer: "2026-10-01" } }, collections: {} } },
};

const shots = Deno.args.includes("--shots") ? Deno.args[Deno.args.indexOf("--shots") + 1] : undefined;
if (shots) await Deno.mkdir(shots, { recursive: true });
let failed = 0;
for (const t of PAGE_TEMPLATES) {
  const sample = SAMPLES[t.name];
  if (!sample) { console.log(`${t.name}: no sample note`); failed++; continue; }
  const task: Task = { id: t.name, prompt: "", seed: { body: sample.body }, page: true, interact: true, checks: () => [] };
  const render = await renderPage(t.html, sample.body, sample.data ?? {}, { today: "2026-10-05", interact: true, shots: shots ? `${shots}/${t.name}` : undefined });
  const checks = scoreTask(task, { before: sample.body, after: sample.body, pageBefore: null, page: t.html, dataBefore: null, data: sample.data ?? null, calls: [], answer: "The note's app.", others: [], render }, render, pageProblems);
  const bad = checks.filter((c) => !c.pass);
  const warnings = pageWarnings(t.html, sample.body);
  if (bad.length || warnings.length) failed++;
  console.log(`${t.name.padEnd(14)} ${checks.length - bad.length}/${checks.length}  ${(new TextEncoder().encode(t.html).length / 1024).toFixed(1)} KB  ${bad.map((c) => `${c.name} (${c.detail ?? ""})`).join("; ")}${warnings.length ? `  warnings: ${warnings.join(" | ")}` : ""}`);
}
await closeBrowser();
if (failed) Deno.exit(1);
