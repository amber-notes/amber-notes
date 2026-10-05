// Page evals: scoring. The checks every page task gets (it renders cleanly, fits a phone, has dark
// mode and labels, survives changed notes), then the task's own (tasks.ts).
import type { Render } from "../page-render/render.ts";
import type { Check, Final, Task } from "./tasks.ts";
import { titleReport, type Rendered } from "../../supabase/functions/mcp/app_check.ts";
import { noteForPage } from "../../supabase/functions/mcp/page_input.ts";

export function scoreTask(task: Task, f: Final, r: Render | undefined, pageProblems: (html: string) => string[]): Check[] {
  let specific: Check[];
  try { specific = task.checks(f); } catch (e) { specific = [{ name: "task_checks", pass: false, detail: `check threw: ${(e as Error).message}` }]; }
  return [...generic(task, f, r, pageProblems), ...specific];
}

function generic(task: Task, f: Final, r: Render | undefined, pageProblems: (html: string) => string[]): Check[] {
  const out: Check[] = [];
  const c = (name: string, pass: boolean, detail?: string) => out.push({ name, pass, ...(detail && !pass ? { detail } : {}) });
  if (!task.page) {
    if (f.page && f.page !== f.pageBefore) c("server_checks", pageProblems(f.page).length === 0, pageProblems(f.page).join(" "));
    return out;
  }
  c("has_page", !!f.page, "no page at the end");
  if (!f.page || !r) return out;
  // A page the model rightly left alone is the seed's; its quality isn't the model's to score.
  if (f.page === f.pageBefore) {
    c("still_renders", r.views.every((v) => v.errors.length === 0), r.views.flatMap((v) => v.errors)[0]);
    return out;
  }
  c("server_checks", pageProblems(f.page).length === 0, pageProblems(f.page).join(" "));
  const errs = r.views.flatMap((v) => v.errors.map((e) => `${v.name}: ${e}`));
  c("no_console_errors", errs.length === 0, errs.slice(0, 2).join(" | "));
  c("no_network", r.blocked.length === 0, r.blocked.slice(0, 2).join(", "));
  const phone = r.views.filter((v) => v.width < 600);
  c("fits_phone", phone.every((v) => v.overflowPx <= 1), `overflows by ${Math.max(...phone.map((v) => v.overflowPx))} px`);
  c("fits_desktop", r.views.filter((v) => v.width >= 600).every((v) => v.overflowPx <= 1), "overflows at 768 or 1280");
  const wide = r.views.find((v) => v.width === 1280 && v.scheme === "light");
  if (wide?.usedWidth !== undefined) c("uses_wide_window", wide.usedWidth >= 0.45, `uses ${Math.round((wide.usedWidth ?? 0) * 100)}% of 1280 px`);
  const phoneLight = r.views.find((v) => v.width < 600 && v.scheme === "light");
  if (phoneLight?.under44Count !== undefined) c("phone_targets", phoneLight.under44Count === 0, `${phoneLight.under44Count} controls under 44 pt: ${(phoneLight.under44 ?? []).slice(0, 3).join(", ")}`);
  c("no_junk_text", r.views.every((v) => !(v.junk ?? []).length), r.views.flatMap((v) => v.junk ?? []).join(", "));
  c("no_clipped_text", r.views.every((v) => (v.clippedCount ?? 0) === 0), r.views.flatMap((v) => v.clipped ?? []).slice(0, 3).join(", "));
  const light = r.views.find((v) => v.width < 600 && v.scheme === "light")!, dark = r.views.find((v) => v.width < 600 && v.scheme === "dark")!;
  if (!task.plays) c("shows_data", light.textLength > 20 && (light.sampled === 0 || light.shown >= 1), `${light.shown}/${light.sampled} recent values visible, ${light.textLength} chars of text`);
  c("dark_mode", dark.bgLuminance < 0.2 && dark.contrast >= 4.5, `dark bg ${dark.bg}, text ${dark.fg}, contrast ${dark.contrast.toFixed(1)}`);
  c("light_contrast", light.contrast >= 4.5, `contrast ${light.contrast.toFixed(1)}`);
  // Only pages the model wrote whole; a small edit to an older page keeps its colors.
  // Colors that follow dark mode: the app's --amber-* tokens, or its own with a dark variant.
  if (!f.pageBefore || f.calls.some((k) => k.name === "set_note_page" && !k.error)) c("themed", /var\(--amber-(bg|surface|fill|text|accent|separator)/.test(f.page) || /prefers-color-scheme\s*:\s*dark/.test(f.page), "neither the --amber-* tokens nor its own dark-mode colors");
  // A look of its own: an accent that isn't amber, or a background that isn't beige (for apps
  // where the look is part of the job).
  if (task.varied) {
    const lk = r.views.find((v) => v.width >= 1000 && v.scheme === "light")?.look ?? r.views[0]?.look;
    if (lk) c("distinct_look", lk.nonAmberVivid >= 0.03 || lk.tintedBg, `accent hue ${lk.accentHue ?? "none"}, ${Math.round(lk.nonAmberVivid * 100)}% non-amber color`);
  }
  c("labelled_controls", light.unnamedControls.length === 0, `${light.unnamedControls.length} unnamed: ${light.unnamedControls.slice(0, 2).join(" ")}`);
  if (task.interact) c("edits_from_page", r.interaction.ok === true, `${r.interaction.tried}: ${r.interaction.error ?? "no form or control"}`);
  // The app owns the note's title: its first heading, shown once.
  const title = titleReport(r as unknown as Rendered, noteForPage(f.after, "2026-10-05").title);
  c("title_once", title.length === 0, title.join(" "));
  // Emil: people see a note's "App" side; the word page(s) is never theirs.
  c("says_app", /\bapps?\b/i.test(f.answer) && !/\bpages?\b/i.test(f.answer), "the reply calls it a page, or doesn't call it the app");
  if (task.plays) c("plays", (r.interaction.framesPerSecond ?? 0) >= 20 && r.views.every((v) => v.errors.length === 0), `${r.interaction.framesPerSecond ?? 0} frames in the second after the first tap`);
  if (task.varied) {
    const v = r.views.reduce((m, x) => ({ canvases: Math.max(m.canvases, x.canvases ?? 0), svg: Math.max(m.svg, x.svgShapes ?? 0), grid: Math.max(m.grid, x.gridCols ?? 0) }), { canvases: 0, svg: 0, grid: 0 });
    c("not_a_list", v.canvases > 0 || v.svg >= 8 || v.grid >= 3, `no canvas, ${v.svg} drawn shapes, at most ${v.grid} grid columns`);
  }
  // A new row only has to show on pages that list rows (most of the recent values visible).
  const lists = light.sampled > 0 && light.shown / light.sampled >= 0.5;
  for (const [k, v] of Object.entries(r.probes)) if (k !== "follows" || lists) c(`probe_${k}`, v!.pass, v!.detail);
  if (r.interaction.error?.includes("just by opening")) c("no_edits_on_open", false, r.interaction.error);
  return out;
}

