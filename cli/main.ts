// amber: keeps a folder of markdown files in sync with an Amber Notes account, through the
// account's MCP server. See README.md.
import { parseArgs } from "@std/cli/parse-args";
import { connect, redact, VERSION } from "./src/client.ts";
import { remoteFor } from "./src/remote.ts";
import { loadState } from "./src/state.ts";
import { type Mode, pendingHere, type Report, syncOnce } from "./src/sync.ts";
import { configPath, loadConfig, saveConfig, DEFAULT_SERVER } from "./src/config.ts";

const HELP = `amber ${VERSION}: a folder of markdown files, in sync with Amber Notes.

  amber login                  Save a token (Amber Notes › Settings › Connect an AI)
  amber logout                 Forget the saved token
  amber pull <dir>             Bring every note down as <dir>/<Folder>/<Title>.md
  amber sync <dir> [--watch]   Both ways; --watch keeps going (--interval 30 seconds)
  amber status [<dir>]         The connection, and what a sync of <dir> would do

Options: --server <url> (default ${DEFAULT_SERVER}), --force (go ahead when most notes look
deleted on one side), --quiet.
Environment: AMBER_TOKEN (instead of a saved token), AMBER_SERVER.
`;

const out = (s: string) => console.log(s);
const fail = (s: string): never => { console.error(`amber: ${redact(s)}`); Deno.exit(1); };

async function readSecret(prompt: string): Promise<string> {
  if (!Deno.stdin.isTerminal()) return (await new Response(Deno.stdin.readable).text()).trim();
  await Deno.stdout.write(new TextEncoder().encode(prompt));
  Deno.stdin.setRaw(true);
  const buf = new Uint8Array(1);
  let s = "";
  try {
    while (true) {
      const n = await Deno.stdin.read(buf);
      if (n === null || buf[0] === 13 || buf[0] === 10) break;
      if (buf[0] === 3) Deno.exit(130);
      if (buf[0] === 127) s = s.slice(0, -1);
      else s += String.fromCharCode(buf[0]);
    }
  } finally {
    Deno.stdin.setRaw(false);
    await Deno.stdout.write(new TextEncoder().encode("\n"));
  }
  return s.trim();
}

async function session(server: string) {
  const cfg = await loadConfig();
  const token = Deno.env.get("AMBER_TOKEN") ?? cfg.token;
  if (!token) fail("Not signed in. Run `amber login`, or set AMBER_TOKEN.");
  const mcp = await connect(server, token!);
  return { mcp, remote: remoteFor(mcp), from: Deno.env.get("AMBER_TOKEN") ? "AMBER_TOKEN" : configPath() };
}

function summary(r: Report): string {
  const parts = [
    r.down.length && `${r.down.length} down`, r.up.length && `${r.up.length} up`, r.created.length && `${r.created.length} created`,
    r.moved.length && `${r.moved.length} moved`, r.deleted.length && `${r.deleted.length} deleted`, r.conflicts.length && `${r.conflicts.length} conflict${r.conflicts.length > 1 ? "s" : ""}`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : "up to date";
}

async function run(dir: string, mode: Mode, server: string, flags: { watch: boolean; interval: number; force: boolean; quiet: boolean }) {
  const { mcp, remote } = await session(server);
  const log = flags.quiet ? undefined : (l: string) => out(l);
  let first = true;
  const once = async () => {
    const r = await syncOnce({ dir, server, remote, mode, force: flags.force, log });
    // Locked notes and the like don't change between passes: said once.
    if (first) for (const s of r.skipped) log?.(`skipped ${s}`);
    first = false;
    for (const s of r.pending) log?.(`pending ${s}`);
    out(`${new Date().toISOString()} ${mode} ${dir}: ${summary(r)} (${remote.kind} tools)`);
    return r;
  };
  if (!flags.watch) {
    try { await once(); } finally { await mcp.close(); }
    return;
  }
  // Watch: a pass when files change here (after a quiet second) and every interval for the account.
  let wake: (() => void) | undefined;
  let quietUntil = 0;
  (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    for await (const ev of Deno.watchFs(dir, { recursive: true })) {
      if (Date.now() < quietUntil || ev.paths.every((p) => p.includes("/.amber/") || !/\.md$/i.test(p))) continue;
      clearTimeout(timer);
      timer = setTimeout(() => wake?.(), 1000);
    }
  })();
  let backoff = flags.interval;
  while (true) {
    try {
      await once();
      backoff = flags.interval;
    } catch (e) {
      console.error(`amber: ${redact(String((e as Error).message ?? e))} (trying again in ${backoff}s)`);
      backoff = Math.min(backoff * 2, 600);
    }
    quietUntil = Date.now() + 1500;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, backoff * 1000);
      wake = () => { clearTimeout(t); resolve(); };
    });
  }
}

async function main() {
  const args = parseArgs(Deno.args, { boolean: ["watch", "force", "quiet", "help", "version"], string: ["server", "interval"], alias: { h: "help", w: "watch", q: "quiet" } });
  const [cmd, dirArg] = args._.map(String);
  if (args.version) return out(VERSION);
  if (args.help || !cmd) return out(HELP);
  const cfg = await loadConfig();
  const server = (args.server ?? Deno.env.get("AMBER_SERVER") ?? cfg.server ?? DEFAULT_SERVER).replace(/\/+$/, "");
  const dir = dirArg ? dirArg.replace(/\/+$/, "") : undefined;

  switch (cmd) {
    case "login": {
      const token = await readSecret("Token from Amber Notes › Settings › Connect an AI (pane_…): ");
      if (!/^pane_[0-9a-f]{64}$/i.test(token)) fail("That isn't an Amber Notes token: it starts with pane_ and has 64 letters and digits after it.");
      const mcp = await connect(server, token);
      const kind = remoteFor(mcp).kind;
      await mcp.close();
      await saveConfig({ ...cfg, token, ...(server !== DEFAULT_SERVER ? { server } : {}) });
      return out(`Signed in to ${server} (${kind} tools). Token saved in ${configPath()}, readable only by you.`);
    }
    case "logout": {
      const { token: _, ...rest } = cfg;
      await saveConfig(rest);
      return out(`Token removed from ${configPath()}.`);
    }
    case "pull":
    case "sync": {
      if (!dir) fail(`Usage: amber ${cmd} <dir>`);
      const interval = Number(args.interval ?? 30);
      if (!(interval >= 5)) fail("--interval is seconds, 5 or more.");
      return await run(dir!, cmd, server, { watch: cmd === "sync" && args.watch, interval, force: args.force, quiet: args.quiet });
    }
    case "status": {
      out(`server   ${server}`);
      let remote;
      try {
        const s = await session(server);
        remote = s.remote;
        const notes = await remote.list();
        out(`token    from ${s.from}`);
        out(`account  ${notes.length} notes (${notes.filter((n) => n.locked).length} locked, not synced), ${remote.kind} tools`);
        await s.mcp.close();
      } catch (e) {
        out(`account  not reachable: ${redact((e as Error).message)}`);
      }
      if (!dir) return;
      const state = await loadState(dir, server);
      const p = await pendingHere(dir, state);
      out(`folder   ${dir}: ${Object.keys(state.notes).length} notes tracked, last sync ${state.synced ?? "never"}`);
      out(`here     ${p.changed.length} changed, ${p.added.length} new, ${p.removed.length} deleted since the last sync`);
      for (const x of p.changed) out(`  changed ${x}`);
      for (const x of p.added) out(`  new     ${x}`);
      for (const x of p.removed) out(`  deleted ${x}`);
      if (p.conflicts.length) out(`conflicts ${p.conflicts.length} conflict cop${p.conflicts.length > 1 ? "ies" : "y"} to look at:\n${p.conflicts.map((c) => `  ${c}`).join("\n")}`);
      return;
    }
    default:
      fail(`Unknown command ${cmd}.\n\n${HELP}`);
  }
}

try {
  await main();
} catch (e) {
  fail(String((e as Error)?.message ?? e));
}
