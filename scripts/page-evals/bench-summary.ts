// The tool-set benchmark, old (classic tools) against new (the file-like set), per CLI and task:
// how many runs passed every check, the mean share of checks passed, calls and wrong-tool errors.
//   deno run -A scripts/page-evals/bench-summary.ts <round> [<round>…]
type R = { task: string; model: string; score: number; passed: number; total: number; tool_calls: number; tool_errors: number; seconds: number; calls: { name: string; error: boolean }[] };
const runs: { r: R; set: string }[] = [];
for (const round of Deno.args) {
  const dir = new URL(`results/${round}/`, import.meta.url);
  for (const e of Deno.readDirSync(dir)) if (e.name.endsWith(".json")) runs.push({ r: JSON.parse(Deno.readTextFileSync(new URL(e.name, dir))), set: e.name.includes("-files") ? "new" : "old" });
}
const cli = (r: R) => r.model.split(":")[0];
const tasks = [...new Set(runs.map((x) => x.r.task))].sort();
const groups = [...new Set(runs.map((x) => `${cli(x.r)} ${x.set}`))].sort();
const cell = (xs: R[]) => xs.length ? `${xs.filter((r) => r.score === 1).length}/${xs.length} ${(100 * xs.reduce((s, r) => s + r.score, 0) / xs.length).toFixed(0)}% ${(xs.reduce((s, r) => s + r.tool_calls, 0) / xs.length).toFixed(1)}c ${xs.reduce((s, r) => s + r.tool_errors, 0)}e` : "-";
console.log("task".padEnd(20), groups.map((g) => g.padEnd(24)).join(""));
for (const t of tasks) console.log(t.padEnd(20), groups.map((g) => cell(runs.filter((x) => x.r.task === t && `${cli(x.r)} ${x.set}` === g).map((x) => x.r)).padEnd(24)).join(""));
console.log("ALL".padEnd(20), groups.map((g) => cell(runs.filter((x) => `${cli(x.r)} ${x.set}` === g).map((x) => x.r)).padEnd(24)).join(""));
console.log("\ncells: runs that passed every check / runs, mean share of checks, mean calls, tool errors in all runs");
for (const g of groups) {
  const used = new Map<string, number>();
  for (const x of runs.filter((y) => `${cli(y.r)} ${y.set}` === g)) for (const c of x.r.calls) used.set(c.name, (used.get(c.name) ?? 0) + 1);
  console.log(`${g}: ${[...used].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ")}`);
}
