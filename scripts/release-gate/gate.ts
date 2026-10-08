// The release gate (docs/Technical/release-gate.md): scripts/release-gate.sh runs this.
//
//   deno run -A scripts/release-gate/gate.ts <candidate ref> [--baseline <ref>] [--sizes 1,2000,20000]
//       [--runs 3] [--only perf,security,storage,network] [--rebuild] [--host fleet-air] [--reuse-perf] [--rescore <report.json>]
//
// Builds the candidate (scripts/release-gate/build.sh), measures it on a real Mac over ssh with the
// staging bench accounts, checks security, storage and network, and writes
// docs/Evidence/release-gate/<date>-<ref>.md with a .json of every number beside it. Each line is
// pass, fail (over its budget in budgets.json) or regression (over 15% worse than the baseline's
// report, past the metric's noise floor). The baseline is the newest report for that ref's commit;
// without one, the baseline ref is run first.
import { parseArgs } from "jsr:@std/cli@1/parse-args";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const args = parseArgs(Deno.args, { string: ["baseline", "sizes", "runs", "only", "host", "rescore", "label"], boolean: ["rebuild", "no-baseline", "reuse-perf"], default: { sizes: "1,2000,20000", runs: "3", host: "fleet-air" } });
// `--rescore <report.json>`: the same numbers against the current budgets and baseline, nothing measured again.
const RESCORE = args.rescore ? JSON.parse(await Deno.readTextFile(args.rescore)) : null;
const candidate = String(args._[0] ?? RESCORE?.ref ?? "");
if (!candidate) throw new Error("usage: scripts/release-gate.sh <candidate ref> [--baseline <ref>]");
const sizes: number[] = RESCORE?.sizes ?? args.sizes.split(",").map(Number);
const runs: number = RESCORE?.runs ?? Number(args.runs);
const only = new Set(RESCORE ? [] : (args.only ?? "perf,security,storage,network").split(","));
const HOST = args.host;
const BUNDLE = "dev.emilwagman.pane.beta";
const EVIDENCE = `${ROOT}/docs/Evidence/release-gate`;

// MARK: Helpers

async function run(cmd: string, argv: string[], opts: { cwd?: string; stdin?: string; env?: Record<string, string>; allowFail?: boolean } = {}) {
  const p = new Deno.Command(cmd, { args: argv, cwd: opts.cwd ?? ROOT, stdin: opts.stdin === undefined ? "null" : "piped", stdout: "piped", stderr: "piped", env: opts.env }).spawn();
  if (opts.stdin !== undefined) {
    const w = p.stdin.getWriter();
    await w.write(new TextEncoder().encode(opts.stdin));
    await w.close();
  }
  const out = await p.output();
  const stdout = new TextDecoder().decode(out.stdout), stderr = new TextDecoder().decode(out.stderr);
  if (!out.success && !opts.allowFail) throw new Error(`${cmd} ${argv.slice(0, 3).join(" ")} failed: ${stderr.slice(-800)}`);
  return { ok: out.success, stdout, stderr };
}
const git = async (...a: string[]) => (await run("git", a)).stdout.trim();
const ssh = (command: string, opts: { stdin?: string; allowFail?: boolean } = {}) => run("ssh", [HOST, command], opts);
const staging = async (...a: string[]) => JSON.parse((await run("deno", ["run", "-A", `${ROOT}/scripts/release-gate/staging.ts`, ...a])).stdout.trim().split("\n").pop()!);
const log = (s: string) => console.error(s);
const median = (xs: number[]) => { const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor((s.length - 1) / 2)] : NaN; };
const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`;

type Metric = { key: string; section: string; label: string; value: number | string | null; unit: string; budget?: number; baseline?: number | string | null; status: "pass" | "fail" | "regression" | "info"; note?: string };
const metrics: Metric[] = [];
function add(section: string, key: string, label: string, value: number | string | null, unit: string, note?: string) {
  metrics.push({ key, section, label, value, unit, status: "info", ...(note ? { note } : {}) });
}
/** A check that is pass or fail by itself (not a number with a budget). */
function check(section: string, key: string, label: string, ok: boolean, value: string, note?: string) {
  metrics.push({ key, section, label, value, unit: "", status: ok ? "pass" : "fail", ...(note ? { note } : {}) });
}

// MARK: The candidate

const sha: string = RESCORE?.sha ?? await git("rev-parse", "--verify", `${candidate}^{commit}`);
const short = sha.slice(0, 10);
const date = new Date().toISOString().slice(0, 10);
// The name people know the ref by (`--label dev` when the candidate is given as a commit).
const label: string = args.label ?? RESCORE?.label ?? candidate.replace(/^origin\//, "");
const refName = label === short ? short : `${label.replaceAll("/", "-")}-${short}`;
log(`Release gate: ${candidate} (${short})`);

// The baseline: its newest report, or a run of it now.
let baseline: { ref: string; sha: string; metrics: Metric[] } | null = null;
const baselineRef: string | undefined = args.baseline ?? RESCORE?.baseline?.sha;
if (baselineRef && !args["no-baseline"]) {
  const bsha = await git("rev-parse", "--verify", `${baselineRef}^{commit}`);
  const find = async () => {
    const found: { path: string; at: string }[] = [];
    const entries: Deno.DirEntry[] = [];
    try { for await (const e of Deno.readDir(EVIDENCE)) entries.push(e); } catch { /* no reports yet */ }
    for (const e of entries) {
      if (!e.name.endsWith(".json")) continue;
      const j = JSON.parse(await Deno.readTextFile(`${EVIDENCE}/${e.name}`));
      if (j.sha === bsha) found.push({ path: `${EVIDENCE}/${e.name}`, at: j.finishedAt });
    }
    return found.sort((a, b) => b.at.localeCompare(a.at))[0]?.path;
  };
  let path = await find();
  if (!path) {
    log(`No report for ${baselineRef} (${bsha.slice(0, 10)}): running the gate on it first`);
    const p = new Deno.Command("deno", { args: ["run", "-A", import.meta.filename!, baselineRef, "--no-baseline", "--sizes", args.sizes, "--runs", args.runs, "--host", HOST, ...(args.only ? ["--only", args.only] : [])], stdout: "inherit", stderr: "inherit" }).spawn();
    await p.status;
    path = await find();
  }
  if (path) {
    const j = JSON.parse(await Deno.readTextFile(path));
    baseline = { ref: j.ref, sha: j.sha, metrics: j.metrics };
  }
}

const OUT = `${ROOT}/build/release-gate/out/${short}`;
const built = RESCORE || await Deno.stat(`${OUT}/sizes.json`).then(() => true, () => false);
if (args.rebuild || !built) {
  log("→ Build");
  const b = new Deno.Command(`${ROOT}/scripts/release-gate/build.sh`, { args: [sha, OUT], stdout: "inherit", stderr: "inherit" }).spawn();
  if (!(await b.status).success) throw new Error("build failed");
}
const sizesJSON = RESCORE?.raw.sizes ?? JSON.parse(await Deno.readTextFile(`${OUT}/sizes.json`));

// MARK: Performance, on the Mac over ssh

type ProbeResult = Record<string, unknown> & { steps?: Record<string, number | string>[]; hangs?: { ms: number; step: string }[] };
const perf: Record<number, { setup?: ProbeResult; runs: ProbeResult[] }> = RESCORE?.raw.perf ?? {};
let machine = RESCORE?.machine ?? "";

async function probe(mode: "setup" | "measure", size: number): Promise<ProbeResult> {
  const remote = `release-gate/${short}`;
  const out = `/tmp/release-gate-${short}-${mode}-${size}-${Date.now()}.out`;
  // Wake the display: the window has to be drawn for its frames to count.
  await ssh("caffeinate -u -t 2 >/dev/null 2>&1 &", { allowFail: true });
  let stdin = "";
  {
    // The account goes to the app on stdin (a file only its owner reads, removed when the app has started).
    const c = await staging("creds", String(size));
    stdin = `${out}.in`;
    await ssh(`umask 077; cat > ${stdin}`, { stdin: JSON.stringify(c) });
  }
  const app = `${remote}/Amber Notes Beta.app`;
  const launchArgs = mode === "setup" ? ["-gateProbe", "setup", "-signout"] : ["-gateProbe", "measure"];
  const script = await Deno.readTextFile(`${ROOT}/scripts/release-gate/launch.zsh`);
  const home = (await ssh("echo $HOME")).stdout.trim();
  // One ssh session for the whole run, so nothing polls the Mac while it's measured: the launcher
  // passes the probe's lines on as they come.
  const proc = new Deno.Command("ssh", { args: [HOST, `zsh -s -- ${[out, `${home}/${app}`, stdin || "-", ...launchArgs].map(q).join(" ")}`], stdin: "piped", stdout: "piped", stderr: "null" }).spawn();
  { const w = proc.stdin.getWriter(); await w.write(new TextEncoder().encode(script)); await w.close(); }
  let pid = "", arrived = false;
  const limit = setTimeout(() => { if (pid) ssh(`kill ${pid}`, { allowFail: true }); }, (mode === "setup" ? 20 : 6) * 60_000);
  let buffer = "";
  for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
    buffer += chunk;
    const lines = buffer.split("\n");
    buffer = lines.pop()!;
    for (const l of lines) {
      pid ||= l.match(/^GATE started \S+ pid (\d+)/)?.[1] ?? "";
      if (!arrived && l.startsWith("GATE arrive-ready")) {
        arrived = true;
        await new Promise((r) => setTimeout(r, 1500));
        await staging("arrive", String(size));
      }
    }
  }
  await proc.status;
  clearTimeout(limit);
  const text = (await ssh(`cat ${out}`, { allowFail: true })).stdout;
  // The samples taken during hangs, with the app's frames named from the archive's dSYM.
  const samples: string[] = [];
  for (const f of (await ssh(`ls ${out}.hang* 2>/dev/null`, { allowFail: true })).stdout.split("\n").filter(Boolean)) {
    const t = await symbolicate((await ssh(`cat ${q(f)}`, { allowFail: true })).stdout);
    if (t.trim()) samples.push(t);
  }
  await ssh(`rm -f ${out} ${out}.err ${out}.hang*`, { allowFail: true });
  const line = text.split("\n").find((l) => l.startsWith("GATE RESULT "));
  if (!line) return { error: `no result (${text.trim().split("\n").slice(-3).join(" / ") || "no output"})` };
  const result = JSON.parse(line.slice("GATE RESULT ".length)) as ProbeResult;
  if (samples.length) result.hangSamples = samples;
  return result;
}

/** Where the main thread was busy in a `sample` report: from the top, the child with the most samples
 *  that weren't waiting for events, down to the deepest frame. App frames are named with atos and
 *  the archive's dSYM. Empty when the hang had ended before the sample began. */
async function symbolicate(report: string): Promise<string> {
  const main = report.split(/\n(?=    \d+ Thread_)/).find((t) => t.includes("com.apple.main-thread")) ?? "";
  type Node = { depth: number; count: number; frame: string; children: Node[]; idle: number };
  const root: Node = { depth: -1, count: 0, frame: "", children: [], idle: 0 };
  const stack = [root];
  for (const l of main.split("\n").slice(1)) {
    const m = l.match(/^([ +!:|]*)(\d+) (.*)$/);
    if (!m) continue;
    const node: Node = { depth: m[1].length, count: Number(m[2]), frame: m[3], children: [], idle: 0 };
    while (stack.length > 1 && stack[stack.length - 1].depth >= node.depth) stack.pop();
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }
  // Samples spent waiting for the next event (the run loop asleep in mach_msg) don't count.
  const idle = (n: Node): number => n.idle = /__CFRunLoopServiceMachPort|mach_msg2_trap|__psynch_cvwait|__semwait_signal/.test(n.frame) ? n.count : n.children.reduce((a, c) => a + idle(c), 0);
  idle(root);
  root.count = root.children.reduce((a, c) => a + c.count, 0);
  const path: Node[] = [];
  let n = root;
  while (n.children.length) {
    const next = n.children.reduce((a, c) => (c.count - c.idle > a.count - a.idle ? c : a));
    if (next.count - next.idle <= 0) break;
    path.push(next);
    n = next;
  }
  if (!path.length) return "";
  const dsym = `${ROOT}/build/release-gate/dd-${short}/AmberNotes.xcarchive/dSYMs/Amber Notes Beta.app.dSYM/Contents/Resources/DWARF/Amber Notes Beta`;
  const lines: string[] = [];
  for (const p of path.slice(-16)) {
    let frame = p.frame;
    const app = frame.match(/^\?\?\?  \(in Amber Notes Beta\)  load address (0x[0-9a-f]+) \+ 0x[0-9a-f]+  \[(0x[0-9a-f]+)\]/);
    if (app) frame = (await run("atos", ["-o", dsym, "-arch", "arm64", "-l", app[1], app[2]], { allowFail: true })).stdout.trim() || frame;
    lines.push(`${p.count - p.idle} ${frame.replace(/\s+\[0x[0-9a-f]+\]$/, "")}`);
  }
  return `${path[0].count - path[0].idle} of ${root.count} samples busy\n${lines.join("\n")}`;
}

// What the Mac measured is kept beside the build, so a later failure doesn't cost the runs:
// `--reuse-perf` takes it from there instead of measuring again.
const PERF_FILE = `${OUT}/perf-${sizes.join("-")}x${runs}.json`;
const reused = args["reuse-perf"] ? await Deno.readTextFile(PERF_FILE).then((t) => JSON.parse(t), () => null) : null;
if (reused) {
  Object.assign(perf, reused.perf);
  machine = reused.machine;
  metrics.push(...reused.checks);
  log(`→ Reusing the measured runs in ${PERF_FILE}`);
} else if (only.has("perf") || only.has("storage") || only.has("network")) {
  log(`→ Copy the app to ${HOST}`);
  machine = (await ssh("sysctl -n hw.model; sw_vers -productVersion; sysctl -n machdep.cpu.brand_string")).stdout.trim().split("\n").join(", ");
  await run("ditto", ["-c", "-k", "--keepParent", `${OUT}/Amber Notes Beta.app`, `${OUT}/app.zip`]);
  await ssh(`mkdir -p release-gate/${short} && rm -rf "release-gate/${short}/Amber Notes Beta.app"; rm -f /tmp/release-gate-*(N)`);
  await run("scp", ["-q", `${OUT}/app.zip`, `${HOST}:release-gate/${short}/app.zip`]);
  await ssh(`cd release-gate/${short} && ditto -x -k app.zip . && rm app.zip && codesign --verify --strict "Amber Notes Beta.app"`);
  const reportsBefore = (await ssh("ls ~/Library/Logs/DiagnosticReports 2>/dev/null", { allowFail: true })).stdout.split("\n");
  for (const size of sizes) {
    log(`→ ${size} notes: account`);
    await staging("ensure", String(size));
    perf[size] = { runs: [] };
    log(`  sign in and first sync`);
    perf[size].setup = await probe("setup", size);
    if (perf[size].setup!.error) log(`  setup: ${perf[size].setup!.error} ${perf[size].setup!.state ?? ""}`);
    for (let r = 0; r < runs; r++) {
      log(`  measure ${r + 1}/${runs}`);
      const res = await probe("measure", size);
      if (res.error) log(`  measure: ${res.error} ${res.state ?? ""}`);
      perf[size].runs.push(res);
    }
  }
  const reportsAfter = (await ssh("ls ~/Library/Logs/DiagnosticReports 2>/dev/null", { allowFail: true })).stdout.split("\n");
  const fresh = reportsAfter.filter((r) => r && !reportsBefore.includes(r) && /Amber Notes Beta/i.test(r));
  check("perf", "perf.crashReports", "Crash, hang or spin reports from the app", fresh.length === 0, fresh.length ? fresh.join(", ") : "none");
  await ssh(`rm -rf release-gate/${short}`, { allowFail: true });
  await Deno.writeTextFile(PERF_FILE, JSON.stringify({ perf, machine, checks: metrics.filter((m) => m.key === "perf.crashReports") }));
}

const num = (x: unknown) => typeof x === "number" ? x : NaN;
if (only.has("perf")) {
  for (const size of sizes) {
    const rs = perf[size]?.runs.filter((r) => !r.error) ?? [];
    const failed = (perf[size]?.runs ?? []).filter((r) => r.error);
    if (failed.length) check("perf", `perf.${size}.runs`, `${size} notes: runs that finished`, false, `${rs.length} of ${perf[size].runs.length}`, String(failed[0].error));
    if (!rs.length) continue;
    const m = (f: (r: ProbeResult) => number) => median(rs.map(f));
    add("perf", `perf.${size}.launchToWindowMs`, `${size} notes: cold launch to first usable window`, m((r) => num(r.launchToWindowMs)), "ms");
    if (rs.some((r) => r.keyAskedAgainAtLaunch)) add("perf", `perf.${size}.keyAskedAgain`, `${size} notes: key asked for again at launch`, "yes", "",
      "This build can't keep the account's key between launches, so every launch needs the recovery key; the probe types it, and the launch times include that. Seen on the sandboxed Developer ID beta (no data protection keychain); the App Store and the unsandboxed download builds keep it.");
    add("perf", `perf.${size}.launchToSyncedMs`, `${size} notes: launch to synced`, m((r) => num(r.launchToSyncedMs)), "ms");
    add("perf", `perf.${size}.idle.cpuPercent`, `${size} notes: idle CPU`, m((r) => num((r.idle as Record<string, number>)?.cpuPercent)), "%");
    add("perf", `perf.${size}.idle.layouts`, `${size} notes: views laid out while idle (20 s)`, m((r) => num((r.idle as Record<string, number>)?.layouts)), "",
      rs.map((r) => ((r.idle as Record<string, string[]>)?.layoutsByView ?? []).join(", ")).find((x) => x) || undefined);
    add("perf", `perf.${size}.idle.wakeupsPerSecond`, `${size} notes: main thread wake-ups while idle`, m((r) => num((r.idle as Record<string, number>)?.wakeupsPerSecond)), "/s");
    add("perf", `perf.${size}.memoryEndMB`, `${size} notes: memory after the flows`, m((r) => num(r.memoryEndMB)), "MB");
    const groups = [...new Set(rs.flatMap((r) => (r.steps ?? []).map((s) => String(s.step))))];
    for (const g of groups) {
      const per = (f: (s: Record<string, number | string>) => number, agg: (xs: number[]) => number) =>
        median(rs.map((r) => agg((r.steps ?? []).filter((s) => s.step === g).map(f))));
      add("perf", `perf.${size}.${g}.longestFrameMs`, `${size} notes: ${g}, longest frame`, per((s) => num(s.longestFrameMs), (xs) => Math.max(...xs)), "ms");
      add("perf", `perf.${size}.${g}.frames`, `${size} notes: ${g}, frames drawn`, per((s) => num(s.frames), (xs) => median(xs)), "");
      add("perf", `perf.${size}.${g}.layouts`, `${size} notes: ${g}, views laid out`, per((s) => num(s.layouts), (xs) => median(xs)), "",
        rs.map((r) => ((r.steps ?? []).find((s) => s.step === g) as unknown as { layoutsByView?: string[] })?.layoutsByView?.join(", ")).find((x) => x) || undefined);
      add("perf", `perf.${size}.${g}.hitches`, `${size} notes: ${g}, hitches`, per((s) => num(s.hitches), (xs) => xs.reduce((a, b) => a + b, 0) / xs.length), "");
      if (g === "typing and saving") {
        add("perf", `perf.${size}.${g}.keyMaxMs`, `${size} notes: slowest key`, per((s) => num(s.keyMaxMs), (xs) => Math.max(...xs)), "ms");
      }
    }
    const untyped = rs.filter((r) => typeof r.typing === "string").length;
    if (untyped) check("perf", `perf.${size}.typing`, `${size} notes: the typing step ran`, false, `skipped in ${untyped} of ${rs.length} runs`, String(rs.find((r) => r.typing)?.typing));
    const failing = [perf[size]?.setup?.firstSyncNet, ...rs.map((r) => r.launchNet)].flatMap((n) => ((n as Record<string, string[]> | undefined)?.failures ?? []));
    if (failing.length) add("perf", `perf.${size}.failingRequests`, `${size} notes: requests the server refused (first sync, then launches)`, failing.length ? "yes" : "none", "", [...new Set(failing)].slice(0, 6).join("; "));
    const late = rs.filter((r) => r.typingPushTimedOut || r.savePushTimedOut).length;
    check("perf", `perf.${size}.savePushed`, `${size} notes: an edit reaches the server within 30 s`, late === 0, late ? `late in ${late} of ${rs.length} runs` : "yes");
    // Hangs: how many per run and the longest, outside launch and in it.
    for (const [part, inPart] of [["launch", (h: { step: string }) => h.step === "launch"], ["flows", (h: { step: string }) => h.step !== "launch"]] as const) {
      const per = rs.map((r) => (r.hangs ?? []).filter(inPart));
      const all = per.flat();
      add("perf", `perf.${size}.hangs.${part}.count`, `${size} notes: main-thread hangs over 250 ms ${part === "launch" ? "during launch" : "in the flows and idle"}, per run`, median(per.map((h) => h.length)), "",
        all.length ? Object.entries(all.reduce((a, h) => ({ ...a, [h.step]: (a[h.step] ?? 0) + 1 }), {} as Record<string, number>)).map(([k, v]) => `${k} ${v}`).join(", ") + ` (all runs). Stacks under Hangs, sampled.` : undefined);
      add("perf", `perf.${size}.hangs.${part}.longestMs`, `${size} notes: longest hang ${part === "launch" ? "during launch" : "in the flows and idle"}`, median(per.map((h) => h.reduce((a, x) => Math.max(a, x.ms), 0))), "ms");
    }
    if (perf[size]?.setup && !perf[size].setup!.error) add("perf", `perf.${size}.firstSyncMs`, `${size} notes: first sync after sign-in`, num(perf[size].setup!.firstSyncMs), "ms");
  }
  add("perf", "perf.iphone", "iPhone flows", "not measured", "", "No signed iPhone build runs here: a simulator on the hub Mac would share its screen and its load, and its timings aren't a phone's. Size is measured (storage).");
}

// MARK: Security

try {
  if (only.has("security")) {
    log("→ Security");
    const src = `${ROOT}/build/release-gate/src-${short}`;
    // Secrets: gitleaks over the commits since the baseline (all history without one), with the repo's config.
    const range = baseline ? `${baseline.sha}..${sha}` : sha;
    const leakReport = await Deno.makeTempFile({ suffix: ".json" });
    await run("gitleaks", ["git", "--no-banner", "--redact", "-c", `${ROOT}/.gitleaks.toml`, "--log-opts", range, "--report-format", "json", "--report-path", leakReport, src], { allowFail: true });
    const found = await Deno.readTextFile(leakReport).then((t) => (JSON.parse(t) as unknown[]).length, () => -1);
    await Deno.remove(leakReport).catch(() => {});
    check("security", "security.secrets", "Secret scan (gitleaks, repo config)", found === 0, found < 0 ? "didn't run" : `${found} findings`, `commits ${baseline ? range.replace(/([0-9a-f]{10})[0-9a-f]+/g, "$1") : "all"}`);

    const adv = await staging("advisors");
    for (const kind of ["security", "performance"]) {
      check("security", `security.advisors.${kind}.errors`, `Supabase ${kind} advisor errors (staging)`, adv[kind].errors === 0, String(adv[kind].errors), adv[kind].errorDetails.join("; ") || undefined);
      add("security", `security.advisors.${kind}.warnings`, `Supabase ${kind} advisor warnings (staging)`, adv[kind].warnings, "",
        Object.entries(adv[kind].counts as Record<string, number>).filter(([k]) => !k.startsWith("INFO")).map(([k, v]) => `${k.replace(/^WARN /, "")} ${v}`).join(", ") || undefined);
    }
    const small = sizes[0], big = sizes.find((s) => s !== small) ?? 2000;
    const rls = await staging("rls", String(small), String(big));
    check("security", "security.rls", "Row-level security: one account can't read or change another's rows", rls.problems.length === 0,
      rls.problems.length ? `${rls.problems.length} problems` : `${rls.tables} tables, ${rls.withUserId} with user_id`, rls.problems.join("; ") || undefined);
    if (only.has("perf")) {
      const pt = await staging("plaintext");
      check("security", "security.plaintext", "E2EE: no note text in the clear in any server table", pt.found.length === 0,
        pt.found.length ? pt.found.join("; ") : `${pt.needles} phrases the app typed, none found`);
    }
    // Dependencies.
    for (const dir of ["web", "app-stack"]) {
      if (!(await Deno.stat(`${src}/${dir}/package.json`).then(() => true, () => false))) continue;
      const a = await run("pnpm", ["audit", "--prod", "--json"], { cwd: `${src}/${dir}`, allowFail: true });
      let v: Record<string, number> = {};
      let which = "";
      try {
        const j = JSON.parse(a.stdout);
        v = j.metadata.vulnerabilities;
        which = Object.values(j.advisories ?? {}).filter((x) => ["high", "critical"].includes((x as { severity: string }).severity))
          .map((x) => { const y = x as { module_name: string; severity: string; vulnerable_versions: string; patched_versions: string }; return `${y.module_name} ${y.vulnerable_versions} (${y.severity}, fixed in ${y.patched_versions})`; })
          .filter((x, i, all) => all.indexOf(x) === i).join("; ");
      } catch { /* no JSON */ }
      const serious = (v.high ?? 0) + (v.critical ?? 0);
      check("security", `security.npm.${dir}`, `npm audit, ${dir} (production dependencies)`, serious === 0, Object.keys(v).length ? `${v.critical ?? 0} critical, ${v.high ?? 0} high, ${v.moderate ?? 0} moderate` : "didn't run", which || undefined);
    }
    for (const dir of ["cli", "supabase/functions"]) {
      if (!(await Deno.stat(`${src}/${dir}`).then(() => true, () => false))) continue;
      const a = await run("deno", ["audit"], { cwd: `${src}/${dir}`, allowFail: true });
      const text = (a.stdout + a.stderr).replace(/\x1b\[[0-9;]*m/g, "");
      const sev = text.match(/Severity:\s*(\d+) low, (\d+) moderate, (\d+) high, (\d+) critical/);
      const serious = sev ? Number(sev[3]) + Number(sev[4]) : 0;
      // deno audit prints a box per advisory: the package and its severity.
      const which = [...text.matchAll(/│ Severity:\s*(\w+)\s*\n│ Package:\s*(\S+)\s*\n│ Vulnerable:\s*(.+)/g)].filter((m) => /high|critical/.test(m[1])).map((m) => `${m[2]} ${m[3].trim()} (${m[1]})`).filter((x, i, all) => all.indexOf(x) === i).join("; ");
      check("security", `security.deno.${dir}`, `deno audit, ${dir}`, serious === 0, sev ? `${sev[4]} critical, ${sev[3]} high, ${sev[2]} moderate` : /No known vulnerabilities/.test(text) ? "none" : "didn't run", which || undefined);
    }
    // Entitlements: what the release builds ask for, against the baseline.
    if (baseline) {
      const files = (await git("ls-tree", "-r", "--name-only", sha, "--", "Pane/Resources", "PaneShare")).split("\n").filter((f) => f.endsWith(".entitlements"));
      const changed = (await run("git", ["diff", "--stat", baseline.sha, sha, "--", ...files, "Pane/Resources/Pane-mac-direct.entitlements"], { allowFail: true })).stdout.trim();
      check("security", "security.entitlements", "Entitlements unchanged since the baseline", changed === "", changed ? changed.split("\n").slice(0, -1).map((l) => l.trim()).join("; ") : "unchanged",
        changed ? "A change isn't wrong by itself: review it, then pass it by hand in the release notes." : undefined);
    }
    // Hosts: every host the app, the site and the functions name, against the reviewed list.
    const hostsOf = async (rev: string) => new Set((await run("git", ["grep", "-hoE", "https?://[a-zA-Z0-9.-]+\\.[a-z]{2,}", rev, "--", "Pane/**.swift", "PaneShare/**.swift", "Pane/Resources/*.plist", "web/app/**.ts", "web/app/**.tsx", "web/lib/**.ts", "web/lib/**.tsx", "web/components/**", "web/next.config.ts", "web/middleware.ts", "supabase/functions/**.ts", ":!*test*"], { allowFail: true })).stdout.split("\n").filter(Boolean).map((u) => u.replace(/^https?:\/\//, "").toLowerCase()));
    const allowed = new Set((await Deno.readTextFile(`${ROOT}/scripts/release-gate/hosts.txt`)).split("\n").map((l) => l.replace(/#.*/, "").trim()).filter(Boolean));
    const hosts = await hostsOf(sha);
    const unknown = [...hosts].filter((h) => !allowed.has(h) && !/(^|\.)(example\.(com|org)|localhost)$/.test(h));
    check("security", "security.hosts", "No new third-party hosts in the app, site or functions", unknown.length === 0, unknown.length ? unknown.join(", ") : `${hosts.size} hosts, all reviewed`,
      unknown.length ? "Add each to scripts/release-gate/hosts.txt once reviewed (what it is, and whether the app or site calls it)." : undefined);
    // And what the app actually called while it ran.
    const called = new Set<string>();
    for (const size of sizes) for (const r of perf[size]?.runs ?? []) for (const k of ["launchNet", "saveNet", "openNet"]) for (const e of ((r[k] as Record<string, string[]>)?.endpoints ?? [])) called.add(e.split("/")[0]);
    if (called.size) {
      const stagingHost = new URL((await Deno.readTextFile(`${ROOT}/Config/Backend.staging.local.xcconfig`)).match(/PANE_SUPABASE_URL\s*=\s*(\S+)/)![1].replace("$()", "")).host;
      const odd = [...called].filter((h) => h !== stagingHost);
      check("security", "security.calledHosts", "Hosts the app called while measured", odd.length === 0, [...called].join(", "));
    }
  }
} catch (e) {
  check("security", "security.error", "Security checks ran to the end", false, "stopped", String(e).slice(0, 300));
}

// MARK: Storage

try {
  if (only.has("storage")) {
    add("storage", "storage.macDmgBytes", "Mac download (DMG)", sizesJSON.macDmgBytes, "bytes");
    add("storage", "storage.macAppBytes", "Mac app installed", sizesJSON.macAppBytes, "bytes");
    add("storage", "storage.iosCompressedBytes", "iPhone app compressed (download stand-in)", sizesJSON.iosCompressedBytes ?? null, "bytes", "Release build, unsigned, zipped; the App Store's thinned download is usually smaller.");
    add("storage", "storage.iosAppBytes", "iPhone app installed (universal, unthinned)", sizesJSON.iosAppBytes ?? null, "bytes");
    for (const size of sizes) {
      const st = (perf[size]?.setup?.storage ?? {}) as Record<string, number>;
      if (st.storeBytes !== undefined) add("storage", `storage.${size}.storeBytes`, `${size} notes: local database after sync`, st.storeBytes, "bytes");
      if (st.libraryBytes !== undefined) add("storage", `storage.${size}.libraryBytes`, `${size} notes: everything the app keeps on disk`, st.libraryBytes, "bytes", `caches ${Math.round((st.cachesBytes ?? 0) / 1024)} KB`);
    }
    const server = await staging("bytes", ...sizes.map(String));
    for (const size of sizes) {
      const s = server[size];
      add("storage", `storage.${size}.serverBytes`, `${size} notes: server bytes for the account, without version history`, s.rowBytes + s.fileBytes, "bytes",
        Object.entries(s.byTable as Record<string, number>).filter(([t]) => t !== "note_revisions").sort((a, b) => b[1] - a[1]).slice(0, 4).map(([t, b]) => `${t} ${Math.round(b / 1024)} KB`).join(", ") +
        `. Version history ${Math.round(s.historyBytes / 1024)} KB, most of it from gate runs.`);
    }
  }
} catch (e) {
  check("storage", "storage.error", "Storage checks ran to the end", false, "stopped", String(e).slice(0, 300));
}

// MARK: Network

try {
  if (only.has("network")) {
    log("→ Network");
    for (const size of sizes) {
      const rs = perf[size]?.runs.filter((r) => !r.error) ?? [];
      for (const [k, label] of [["launchNet", "launch"], ["openNet", "opening a note"], ["saveNet", "saving a note"]] as const) {
        const vals = rs.map((r) => r[k] as Record<string, number>).filter(Boolean);
        if (!vals.length) continue;
        add("network", `network.${size}.${k}.requests`, `${size} notes: requests for ${label}`, median(vals.map((v) => v.requests)), "");
        const refused = median(vals.map((v) => v.failed ?? 0));
        check("network", `network.${size}.${k}.failed`, `${size} notes: requests that failed during ${label}`, refused === 0, String(refused),
          refused ? [...new Set(rs.flatMap((r) => ((r[k] as Record<string, string[]>)?.failures ?? [])))].slice(0, 4).join("; ") || undefined : undefined);
        add("network", `network.${size}.${k}.bytes`, `${size} notes: bytes for ${label}`, median(vals.map((v) => v.bytesSent + v.bytesReceived)), "bytes",
          ((rs[0][k] as Record<string, string[]>)?.endpoints ?? []).slice(0, 4).join(", ").replace(/[a-z0-9]{20}\.supabase\.co/g, "") || undefined);
      }
      const setup = perf[size]?.setup?.firstSyncNet as Record<string, number> | undefined;
      if (setup) add("network", `network.${size}.firstSync.bytes`, `${size} notes: bytes for the first sync`, setup.bytesSent + setup.bytesReceived, "bytes", `${setup.requests} requests`);
    }
    for (const size of [sizes.find((s) => s >= 2000) ?? sizes[0], 20000].filter((v, i, a) => a.indexOf(v) === i && sizes.includes(v))) {
      const lat = await staging("latency", String(size));
      for (const [name, v] of Object.entries(lat.calls as Record<string, { p50: number; p95: number; errors: number }>)) {
        add("network", `network.${size}.${name}.p50`, `${size} notes: ${name}, p50`, v.p50, "ms");
        add("network", `network.${size}.${name}.p95`, `${size} notes: ${name}, p95`, v.p95, "ms", v.errors ? `${v.errors} errors` : undefined);
        if (v.errors) check("network", `network.${size}.${name}.errors`, `${size} notes: ${name} errors`, false, String(v.errors));
      }
      if (!lat.mcp) add("network", `network.${size}.mcp`, `${size} notes: MCP`, "not measured", "", "no MCP token for this account in .secrets");
    }
  }
} catch (e) {
  check("network", "network.error", "Network checks ran to the end", false, "stopped", String(e).slice(0, 300));
}

// MARK: Budgets and the baseline

if (RESCORE) metrics.push(...(RESCORE.metrics as Metric[]).map((m) => ({ ...m, status: m.unit === "" && (m.status === "pass" || m.status === "fail") && typeof m.value === "string" ? m.status : "info" as const, budget: undefined, baseline: undefined })));

type Budget = { max?: number; regression?: boolean; floor?: number };
const budgets = JSON.parse(await Deno.readTextFile(`${ROOT}/scripts/release-gate/budgets.json`)) as Record<string, Budget>;
const budgetFor = (key: string): Budget | undefined => {
  // Most specific first: exact key, then wildcards (a * matches one dot-separated part).
  const hits = Object.entries(budgets).filter(([k]) => !k.startsWith("_") && new RegExp(`^${k.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", "[^.]+")}$`).test(key));
  hits.sort((a, b) => a[0].split("*").length - b[0].split("*").length);
  return hits[0]?.[1];
};
for (const m of metrics) {
  if (typeof m.value !== "number" || !Number.isFinite(m.value)) continue;
  const b = budgetFor(m.key);
  const base = baseline?.metrics.find((x) => x.key === m.key)?.value;
  if (typeof base === "number") m.baseline = base;
  if (!b) continue;
  m.status = "pass";
  if (b.max !== undefined) {
    m.budget = b.max;
    if (m.value > b.max) m.status = "fail";
  }
  // Worse by more than 15% and by more than the metric's noise floor.
  if (m.status === "pass" && b.regression !== false && typeof base === "number" && m.value > base * 1.15 && m.value - base > (b.floor ?? 0)) m.status = "regression";
}

// MARK: Report

const fails = metrics.filter((m) => m.status === "fail"), regressions = metrics.filter((m) => m.status === "regression");
const verdict = fails.length || regressions.length ? "FAIL" : "PASS";
const fmt = (v: number | string | null | undefined, unit: string) => {
  if (v === null || v === undefined) return "–";
  if (typeof v === "string") return v;
  if (!Number.isFinite(v)) return "–";
  if (unit === "bytes") return v >= 1e6 ? `${(v / 1e6).toFixed(1)} MB` : v >= 1e3 ? `${(v / 1e3).toFixed(0)} KB` : `${v} B`;
  const r = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
  return `${r}${unit && unit !== "" ? (unit === "%" || unit === "/s" ? unit : ` ${unit}`) : ""}`;
};
const delta = (m: Metric) => typeof m.value === "number" && typeof m.baseline === "number" && m.baseline !== 0 ? `${m.value >= m.baseline ? "+" : ""}${Math.round((m.value / m.baseline - 1) * 100)}%` : "";
const icon = { pass: "pass", fail: "**FAIL**", regression: "**REGRESSION**", info: "" };
const funcs = await (async () => {
  try {
    const list = JSON.parse((await run("supabase", ["functions", "list", "--project-ref", (await Deno.readTextFile(`${(await git("rev-parse", "--path-format=absolute", "--git-common-dir")).replace(/\/\.git$/, "")}/.secrets/staging.env`)).match(/STAGING_REF=(\S+)/)![1], "-o", "json"], { allowFail: true })).stdout);
    return (list as { slug: string; version: number }[]).map((f) => `${f.slug} v${f.version}`).join(", ");
  } catch { return "unknown"; }
})();
const sectionNames: Record<string, string> = { perf: "Performance", security: "Security", storage: "Storage", network: "Network" };
let md = `# Release gate: ${label} (${short})\n\n**${verdict}**: ${fails.length} over budget or failed, ${regressions.length} regressions${baseline ? ` against ${baseline.ref} (${baseline.sha.slice(0, 10)})` : ", no baseline"}.\n\n`;
md += `- Date: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC\n- Build: Release, PaneDirect, Developer ID (team-signed, not notarized), Amber Notes Beta identity on staging, with the gate's probe added (scripts/release-gate/GateProbe.swift)\n`;
if (machine) md += `- Mac: ${HOST} (${machine}), ${runs} measured runs per account, medians\n`;
md += `- Accounts: staging bench accounts of ${sizes.join(", ")} notes, plus the gate's 3 notes each\n- Server: staging runs what was deployed there, not this ref: ${funcs}\n- Budgets: scripts/release-gate/budgets.json; regression = over 15% worse than the baseline and past the metric's noise floor\n\n`;
if (fails.length || regressions.length) {
  md += `## What failed\n\n`;
  for (const m of [...fails, ...regressions]) md += `- ${m.label}: ${fmt(m.value, m.unit)}${m.budget !== undefined ? ` (budget ${fmt(m.budget, m.unit)})` : ""}${typeof m.baseline === "number" ? ` (baseline ${fmt(m.baseline, m.unit)}, ${delta(m)})` : ""}${m.note ? `. ${m.note}` : ""}\n`;
  md += "\n";
}
for (const s of ["perf", "security", "storage", "network"]) {
  const rows = metrics.filter((m) => m.section === s);
  if (!rows.length) continue;
  md += `## ${sectionNames[s]}\n\n| Check | Value | Budget | Baseline | Change | Result | Notes |\n|---|---|---|---|---|---|---|\n`;
  for (const m of rows) md += `| ${m.label} | ${fmt(m.value, m.unit)} | ${m.budget !== undefined ? fmt(m.budget, m.unit) : ""} | ${m.baseline !== undefined ? fmt(m.baseline, m.unit) : ""} | ${delta(m)} | ${icon[m.status]} | ${(m.note ?? "").replaceAll("|", "/")} |\n`;
  md += "\n";
}
const hangSamples = sizes.flatMap((size) => (perf[size]?.runs ?? []).flatMap((r) => ((r.hangSamples as string[] | undefined) ?? []).map((t) => ({ size, t }))));
if (hangSamples.length) {
  md += `## Hangs, sampled\n\nThe main thread during each hang (the heaviest path's deepest frames, from \`sample\` on the Mac):\n\n`;
  for (const h of hangSamples.slice(0, 6)) md += `${h.size} notes:\n\n\`\`\`\n${h.t}\n\`\`\`\n\n`;
}
await Deno.mkdir(EVIDENCE, { recursive: true });
const base = `${EVIDENCE}/${date}-${refName}`;
// The repository is public: no staging project ref, account addresses or home folders in reports.
const stagingRef = (await Deno.readTextFile(`${(await git("rev-parse", "--path-format=absolute", "--git-common-dir")).replace(/\/\.git$/, "")}/.secrets/staging.env`)).match(/STAGING_REF=(\S+)/)?.[1] ?? "";
const clean = (t: string) => t.replaceAll(stagingRef || "\u0000", "<staging>").replace(/[\w.+-]+@ambernotes\.app/g, "<bench account>").replace(/\/Users\/[^/"\s]+/g, "~");
await Deno.writeTextFile(`${base}.md`, clean(md));
await Deno.writeTextFile(`${base}.json`, clean(JSON.stringify({ ref: candidate, label, sha, verdict, finishedAt: new Date().toISOString(), host: HOST, machine, sizes, runs, baseline: baseline ? { ref: baseline.ref, sha: baseline.sha } : null, metrics, raw: { perf, sizes: sizesJSON } }, null, 1)));
console.log(`${verdict}: ${base}.md`);
if (verdict !== "PASS") Deno.exit(1);
