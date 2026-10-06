// The always-working measurement: per CLI, whether the AI wrote or extended tests (beyond the
// starter's two), the walkthrough on the version the person gets, and what the gate did: saves held
// back, and whether the run ended on a passing version.
//   deno run -A scripts/page-evals/gate-summary.ts <round>
type R = { task: string; model: string; seconds: number; tool_calls: number; checks: { name: string; pass: boolean }[]; tests_written?: number; gate?: { held_back_saves: number; live_saves: number; ended_with_draft: boolean }; calls: { name: string; result?: string }[] };
const dir = new URL(`results/${Deno.args[0]}/`, import.meta.url);
const runs: R[] = [...Deno.readDirSync(dir)].filter((e) => e.name.endsWith(".json")).map((e) => JSON.parse(Deno.readTextFileSync(new URL(e.name, dir))));
// Counted from each save's answer (the "live" field), compact or spaced JSON.
for (const r of runs) {
  const held = r.calls.filter((c) => /"live":\s*"Held back/.test(c.result ?? "")).length;
  const live = r.calls.filter((c) => /"live":\s*"Live/.test(c.result ?? "")).length;
  r.gate = { held_back_saves: held, live_saves: live, ended_with_draft: r.gate?.ended_with_draft ?? false };
}
const by = new Map<string, R[]>();
for (const r of runs) by.set(r.model.split(":")[0], [...(by.get(r.model.split(":")[0]) ?? []), r]);
const walk = (r: R) => { const c = r.checks.filter((x) => x.name.startsWith("walk_")); return c.length ? c.filter((x) => x.pass).length / c.length : NaN; };
const mean = (xs: number[]) => xs.filter((x) => !Number.isNaN(x)).reduce((a, b) => a + b, 0) / Math.max(1, xs.filter((x) => !Number.isNaN(x)).length);
console.log("cli".padEnd(14), "runs  extended-tests  tests(mean)  walkthrough  held-back saves  runs with a hold  ended held back  minutes  calls");
for (const [k, rs] of by) {
  const held = rs.filter((r) => (r.gate?.held_back_saves ?? 0) > 0);
  console.log(k.padEnd(14), String(rs.length).padStart(4), `${rs.filter((r) => (r.tests_written ?? 0) > 2).length}/${rs.length}`.padStart(15), mean(rs.map((r) => r.tests_written ?? 0)).toFixed(1).padStart(12),
    `${Math.round(100 * mean(rs.map(walk)))}%`.padStart(12), String(rs.reduce((n, r) => n + (r.gate?.held_back_saves ?? 0), 0)).padStart(16), `${held.length}/${rs.length}`.padStart(17),
    `${rs.filter((r) => r.gate?.ended_with_draft).length}/${rs.length}`.padStart(16), mean(rs.map((r) => r.seconds / 60)).toFixed(1).padStart(8), mean(rs.map((r) => r.tool_calls)).toFixed(0).padStart(6));
}
console.log("\nper run:");
for (const r of runs.sort((a, b) => a.task.localeCompare(b.task))) console.log(`${r.model.split(":")[0].padEnd(12)} ${r.task.padEnd(10)} tests ${r.tests_written ?? 0}  walk ${Math.round(100 * walk(r))}%  held ${r.gate?.held_back_saves ?? 0}/${(r.gate?.held_back_saves ?? 0) + (r.gate?.live_saves ?? 0)} saves  ${r.gate?.ended_with_draft ? "ENDED HELD BACK" : "ended live"}`);
