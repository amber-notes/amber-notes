// The try_app experiment's numbers, per arm (with / without try_app and run_app_tests) and per task:
// the hidden walkthrough, breakage, the brief's features, how often the tools were used, time and calls.
//   deno run -A scripts/page-evals/experiment-summary.ts <round> [<round>…]
type R = { task: string; hidden?: string[]; seconds: number; tool_calls: number; checks: { name: string; pass: boolean }[]; breakage?: string[]; used?: { try_app: number; run_app_tests: number; test_files: number }; page_bytes: number; model: string };
const runs: R[] = [];
for (const round of Deno.args) {
  const dir = new URL(`results/${round}/`, import.meta.url);
  for (const e of Deno.readDirSync(dir)) if (e.name.endsWith(".json")) runs.push(JSON.parse(Deno.readTextFileSync(new URL(e.name, dir))));
}
const arm = (r: R & { arm?: string }) => `${r.model.split(":")[0]} ${r.hidden?.includes("try_app") || r.arm === "screens" ? "without" : "with"}`;
const frac = (r: R, prefix: string) => { const c = r.checks.filter((x) => x.name.startsWith(prefix)); return c.length ? c.filter((x) => x.pass).length / c.length : NaN; };
const mean = (xs: number[]) => { const v = xs.filter((x) => !Number.isNaN(x)); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
const pct = (x: number) => Number.isNaN(x) ? "-" : `${Math.round(x * 100)}%`;
const rows = new Map<string, R[]>();
for (const r of runs) rows.set(arm(r), [...(rows.get(arm(r)) ?? []), r]);
console.log("arm".padEnd(22), "runs  apps  walkthrough  breakage  features  try_app  tests  test files  minutes  calls");
for (const [k, rs] of [...rows].sort()) {
  console.log(k.padEnd(22), String(rs.length).padStart(4), String(rs.filter((r) => r.page_bytes > 0).length).padStart(5),
    pct(mean(rs.map((r) => frac(r, "walk_")))).padStart(12), mean(rs.map((r) => r.breakage?.length ?? 0)).toFixed(1).padStart(9), pct(mean(rs.map((r) => frac(r, "has_")))).padStart(9),
    mean(rs.map((r) => r.used?.try_app ?? 0)).toFixed(1).padStart(8), mean(rs.map((r) => r.used?.run_app_tests ?? 0)).toFixed(1).padStart(6), mean(rs.map((r) => r.used?.test_files ?? 0)).toFixed(1).padStart(11),
    mean(rs.map((r) => r.seconds / 60)).toFixed(1).padStart(8), mean(rs.map((r) => r.tool_calls)).toFixed(0).padStart(6));
}
console.log("\nper task (walkthrough / features):");
const tasks = [...new Set(runs.map((r) => r.task))].sort();
for (const t of tasks) console.log(t.padEnd(12), [...rows.keys()].sort().map((k) => { const rs = rows.get(k)!.filter((r) => r.task === t); return `${k}: ${rs.map((r) => `${pct(frac(r, "walk_"))}/${pct(frac(r, "has_"))}`).join(", ") || "-"}`; }).join("   "));
