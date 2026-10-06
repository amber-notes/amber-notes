// The end-to-end run: the compiled amber binary against the real MCP server and its real OAuth
// (local_server.ts), every step checked from the other side. Prints a transcript; exits non-zero
// if a check fails.
//
//   deno task compile && deno run -A e2e/run.ts > e2e/transcript.txt
//
// The browser is e2e/approve.sh: it follows /authorize to the consent page and presses Allow, which
// does what the Amber Notes app does on Allow. "Settings" is the app's Connect an AI list and its
// Disconnect, through local_server.ts. Keychain items go under amber-cli-e2e and are removed after.
import { parseArgs } from "@std/cli/parse-args";

const args = parseArgs(Deno.args, { string: ["bin"] });
const cli = new URL("..", import.meta.url).pathname;
const arch = Deno.build.arch === "aarch64" ? "arm64" : "x64";
const bin = args.bin ?? `${cli}dist/amber-${Deno.build.os === "darwin" ? "macos" : "linux"}-${arch}`;
const work = await Deno.makeTempDir({ prefix: "amber-e2e-" });
const SERVICE = "amber-cli-e2e";
const baseEnv = { XDG_CONFIG_HOME: `${work}/config`, AMBER_KEYCHAIN_SERVICE: SERVICE, AMBER_BROWSER: `${cli}e2e/approve.sh`, NO_COLOR: "1", HOME: Deno.env.get("HOME")!, PATH: Deno.env.get("PATH")! };
let failed = 0;
const secrets: string[] = [];

const say = (s = "") => console.log(s);
const step = (s: string) => say(`\n## ${s}\n`);
const check = (ok: boolean, what: string) => { say(`  ${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) failed++; };
const clean = (s: string) => secrets.reduce((t, x) => t.replaceAll(x, "<token>"), s).replaceAll(work + "/", "").replaceAll(work, ".");

type Run = { code: number; out: string; err: string };
async function amber(line: string, o: { stdin?: string; env?: Record<string, string>; show?: string; quiet?: boolean } = {}): Promise<Run> {
  const argv = line.match(/'[^']*'|"[^"]*"|\S+/g)!.map((a) => a.replace(/^['"]|['"]$/g, "").replace(/\\n/g, "\n"));
  if (!o.quiet) say(`$ ${o.show ?? `amber ${line}`}`);
  const p = new Deno.Command(bin, { args: [...argv, "--server", server], cwd: work, env: { ...baseEnv, ...o.env }, clearEnv: true, stdin: o.stdin !== undefined ? "piped" : "null", stdout: "piped", stderr: "piped" }).spawn();
  if (o.stdin !== undefined) { const w = p.stdin.getWriter(); await w.write(new TextEncoder().encode(o.stdin)); await w.close(); }
  const r = await p.output();
  const res = { code: r.code, out: new TextDecoder().decode(r.stdout), err: new TextDecoder().decode(r.stderr) };
  const shown = clean((res.out + res.err).trimEnd());
  if (!o.quiet && shown) say(shown);
  if (!o.quiet && res.code) say(`(exit ${res.code})`);
  return res;
}
const sh = (line: string, text: string) => { say(`$ ${line}`); if (text) say(clean(text.trimEnd())); };

// MARK: the server

const freePort = () => { const l = Deno.listen({ port: 0, hostname: "127.0.0.1" }); const p = (l.addr as Deno.NetAddr).port; l.close(); return p; };
const port = freePort();
const origin = `http://127.0.0.1:${port}`;
const server = `${origin}/mcp`;
const srv = new Deno.Command(Deno.execPath(), { args: ["run", "-A", `${cli}e2e/local_server.ts`, "--port", String(port), "--token-file", `${work}/token.txt`], stdout: "null", stderr: "piped" }).spawn();
for (let i = 0; i < 240; i++) {
  try { if ((await fetch(`${origin}/__ready`)).ok) break; } catch { /* starting */ }
  await new Promise((r) => setTimeout(r, 250));
}
const paneToken = await Deno.readTextFile(`${work}/token.txt`);
secrets.push(paneToken);
const settings = async () => (await (await fetch(`${origin}/__app/connections`)).json()) as { id: string; title: string; access: string; revoked: boolean }[];
const showSettings = async () => {
  const list = (await settings()).filter((c) => !c.revoked);
  say(`[Amber Notes › Settings › Connect an AI]\n${list.map((c) => `  ${c.title}  (${c.access})`).join("\n") || "  Nothing is connected yet."}`);
  return list;
};
const keychain = async () => (await new Deno.Command("/usr/bin/security", { args: ["find-generic-password", "-s", SERVICE, "-a", server], stdout: "piped", stderr: "null" }).output());

say(`# amber end-to-end run, ${new Date().toISOString().slice(0, 16)}Z`);
say(`binary ${bin.replace(cli, "cli/")} (${Deno.build.os} ${Deno.build.arch}) against ${server}: the real MCP request handler and OAuth`);
say("(supabase/functions/mcp, unchanged), files tools, a fresh database with every migration and a seeded end-to-end encrypted test account.");

step("Help");
await amber("--version");
const help = await amber("help");
check(help.out.split("\n").length <= 25, `amber help fits on one screen (${help.out.split("\n").length} lines)`);

step("Sign in: browser, approve in Amber Notes");
const before = (await settings()).length;
const login = await amber("login", { show: "amber login        # the browser opens the consent page; Allow" });
check(login.code === 0 && /Connected to Amber Notes \(read & edit\)/.test(login.out), "connected with read & edit");
const conns = await showSettings();
const terminal = (await settings()).slice(before).find((c) => !c.revoked);
check(terminal?.title === "An app on this computer", "Settings lists it as \"An app on this computer\", like any app signing in from this computer");
if (Deno.build.os === "darwin") {
  const k = await keychain();
  const attrs = new TextDecoder().decode(k.stdout);
  sh(`security find-generic-password -s ${SERVICE} -a ${server}   # attributes only`, attrs.split("\n").filter((l) => /svce|acct|labl|class/.test(l)).join("\n"));
  check(k.success, "the tokens are in the macOS Keychain");
}
const files = await Array.fromAsync(Deno.readDir(`${work}/config/amber`)).catch(() => []);
sh("ls config/amber", files.map((f) => f.name).join("\n"));
check(!files.some((f) => f.name === "credentials.json"), "and not in a file");
await amber("status");

step("Read");
await amber("list");
await amber("list Work/");
const s = await amber("search butter");
check(s.out.startsWith("Groceries.md"), "search finds the note by a word in it");
const r = await amber("read Work/Clients/Acme.md");
check(r.out.startsWith("# Acme\n"), "read prints the markdown exactly");
const j = await amber("read Groceries.md --json", { quiet: true });
const parsed = JSON.parse(j.out);
sh("amber read Groceries.md --json | jq '{id, title, version: .metadata.version, links: .metadata.links}'", JSON.stringify({ id: parsed.id, title: parsed.title, version: parsed.metadata.version, links: parsed.metadata.links }, null, 2));
check(parsed.metadata.links?.[0] === "Recipes", "--json gives the server's full answer ([[links]] included)");
const locked = await amber("read Work/Diary.md");
check(locked.code === 1 && /locked/.test(locked.err), "a locked note stays closed, with a reason and exit code 1");

step("Change");
const c = await amber(`create Work 'Standup\\n\\n- Shipped the CLI\\n- Next: tests'`, { show: "amber create Work $'Standup\\n\\n- Shipped the CLI\\n- Next: tests'" });
check(/Created Work\/Standup.md/.test(c.out), "create");
const c2 = await amber("create Ideas/Garden.md", { stdin: "- tomatoes\n- basil\n", show: "printf -- '- tomatoes\\n- basil\\n' | amber create Ideas/Garden.md" });
check(/Created Ideas\/Garden.md/.test(c2.out), "create from stdin, titled by the file name");
const e = await amber(`edit Groceries.md '- [ ] Milk' '- [x] Milk'`);
check(/Edited Groceries.md/.test(e.out), "edit (exact search and replace)");
const bad = await amber(`edit Groceries.md 'Oat milk' 'Milk'`);
check(bad.code === 1 && /not found|doesn't|no match|isn't in/i.test(bad.err), "edit with text that isn't there changes nothing and says so");
const broken = await amber(`edit Groceries.md '- [ ] Butter' '-[ ] Butter'`);
check(/check:/.test(broken.out), "edit reports what the change broke");
await amber(`edit Groceries.md '-[ ] Butter' '- [ ] Butter'`, { quiet: true });
const w = await amber("write Work/Standup.md", { stdin: "Standup\n\n- Shipped the CLI\n- Next: the brew formula\n", show: "printf 'Standup\\n\\n- Shipped the CLI\\n- Next: the brew formula\\n' | amber write Work/Standup.md" });
check(/Wrote Work\/Standup.md/.test(w.out), "write from stdin");
const m = await amber("move Work/Standup.md Archive/");
check(/Moved to Archive\/Standup.md/.test(m.out), "move to a folder");
const rn = await amber(`move 'Archive/Standup.md' 'Archive/Standup 10-06.md'`);
check(/Archive\/Standup 10-06.md/.test(rn.out), "rename");
const h = await amber(`history 'Archive/Standup 10-06.md'`);
const firstVersion = [...h.out.matchAll(/^\s+(\d+)\s/gm)].map((x) => x[1]).pop();
check(Boolean(firstVersion), "history lists earlier versions");
const rs = await amber(`restore 'Archive/Standup 10-06.md' ${firstVersion}`);
check(/Restored/.test(rs.out), "restore a version");
const after = await amber("read Archive/Standup.md");
check(after.out.includes("Next: tests"), "the old text is back, with its old title (the first line), so its old name");
const d = await amber("delete Ideas/Garden.md");
const gardenId = d.out.match(/amber restore (\S+)/)?.[1];
check(Boolean(gardenId), "delete moves it to Recently Deleted, and says how to bring it back");
await amber(`list 'Recently Deleted/'`);
const ud = await amber(`restore ${gardenId}`);
check(/Restored "Garden"/.test(ud.out), "restore from Recently Deleted");
await amber("pin Work/Clients/Acme.md");
const unpin = await amber("pin Groceries.md --off");
check(/Unpinned Groceries.md/.test(unpin.out), "pin and unpin");

step("Signed in for longer than an hour: five amber commands at once renew the token once");
// Five processes find the access token expired together. Refresh tokens are single use and a reused
// one revokes the connection, so they must take turns (the refresh lock). Run with the file store
// so the test can wind the clock back.
const fileEnv = { AMBER_NO_KEYCHAIN: "1", XDG_CONFIG_HOME: `${work}/config-file` };
await amber("login", { env: fileEnv, quiet: true });
const credFile = `${work}/config-file/amber/credentials.json`;
const mode = (await Deno.stat(credFile)).mode! & 0o777;
sh("stat -f %Lp config-file/amber/credentials.json   # the Linux store, AMBER_NO_KEYCHAIN=1", mode.toString(8));
check(mode === 0o600, "the Linux credentials file is mode 600");
const creds = JSON.parse(await Deno.readTextFile(credFile));
for (const v of Object.values(creds) as { access_token: string; refresh_token: string }[]) secrets.push(v.access_token, v.refresh_token);
for (const k of Object.keys(creds)) creds[k].expires_at = Date.now() - 1000;
await Deno.writeTextFile(credFile, JSON.stringify(creds));
say("(the access token's expiry set an hour back)");
say("$ for i in 1 2 3 4 5; do amber list Work/ & done; wait");
const five = await Promise.all([1, 2, 3, 4, 5].map(() => amber("list Work/", { env: fileEnv, quiet: true })));
check(five.every((x) => x.code === 0), `all five succeed (exit codes ${five.map((x) => x.code).join(" ")})`);
const renewed = JSON.parse(await Deno.readTextFile(credFile));
const rv = Object.values(renewed)[0] as { access_token: string; refresh_token: string; expires_at: number };
secrets.push(rv.access_token, rv.refresh_token);
check(rv.expires_at > Date.now() + 50 * 60_000, "the token was renewed");
check((await settings()).filter((x) => !x.revoked).length === conns.length + 1, "and the connection is still there (no refresh token was used twice)");
await amber("logout", { env: fileEnv, quiet: true });

step("Disconnect it in the app: the terminal is turned away");
await showSettings();
say(`[Amber Notes › Settings › Connect an AI] Disconnect "An app on this computer"`);
await fetch(`${origin}/__app/revoke`, { method: "POST", body: JSON.stringify({ id: terminal!.id }) });
const gone = await amber("list");
check(gone.code === 1 && /amber login/.test(gone.err), "the next command fails and says to run amber login");
await showSettings();

step("Don't Allow");
const denied = await amber("login", { env: { APPROVE: "0" }, show: "amber login        # this time: Don't Allow" });
check(denied.code === 1 && /Declined in Amber Notes/.test(denied.err), "declining connects nothing");

step("A server without a browser: amber login --no-browser");
say("$ amber login --no-browser");
const nb = new Deno.Command(bin, { args: ["login", "--no-browser", "--server", server], cwd: work, env: baseEnv, clearEnv: true, stdin: "piped", stdout: "piped", stderr: "piped" }).spawn();
const errText: string[] = [];
const outText = new Response(nb.stdout).text();
const reader = nb.stderr.pipeThrough(new TextDecoderStream()).getReader();
let url = "";
while (!url) {
  const { value, done } = await reader.read();
  if (done) break;
  errText.push(value);
  url = errText.join("").match(/(http:\/\/127\.0\.0\.1:\d+\/mcp\/authorize\?\S+)/)?.[1] ?? "";
}
// The browser is on another machine: approving there ends on an address that machine can't load.
const elsewhere = await new Deno.Command(`${cli}e2e/approve.sh`, { args: [url], env: { ELSEWHERE: "1" }, stdout: "piped" }).output();
const landed = new TextDecoder().decode(elsewhere.stdout).trim();
const w2 = nb.stdin.getWriter();
await w2.write(new TextEncoder().encode(landed + "\n"));
await w2.close();
const rest = (async () => { for (;;) { const { value, done } = await reader.read(); if (done) break; errText.push(value); } })();
await nb.status;
const nbOut = await outText;
await rest;
say(clean(errText.join("") + landed.replace(/code=[^&]+/, "code=…") + "\n" + nbOut).trimEnd());
check(/Connected to Amber Notes/.test(nbOut), "pasting the address the browser landed on connects");
const ok = await amber("search 'Lisbon'");
check(/Travel\/Trip.md/.test(ok.out), "and amber works");

step("CI: AMBER_TOKEN, or amber login --token");
const env = await amber("status", { env: { AMBER_TOKEN: paneToken }, show: "AMBER_TOKEN=<access token from Settings› Connect an AI> amber status" });
check(/AMBER_TOKEN/.test(env.out), "AMBER_TOKEN works without signing in");
const ci = { XDG_CONFIG_HOME: `${work}/config-ci`, AMBER_KEYCHAIN_SERVICE: `${SERVICE}-ci` };
const tl = await amber("login --token", { stdin: paneToken, env: ci, show: "amber login --token < token.txt" });
check(tl.code === 0, "login --token saves a pasted token");
await amber("logout", { env: ci });

step("Signing in again replaces the old connection");
await amber("login", { quiet: true });
await showSettings();
const terminals = (await settings()).filter((x) => !x.revoked && x.title === "An app on this computer").length;
check(terminals === 1, `one "An app on this computer", not two (${terminals})`);

step("Sign out");
await amber("logout");
const after2 = await showSettings();
check(!after2.some((x) => x.title === "An app on this computer"), "amber logout disconnects it in the app too");
if (Deno.build.os === "darwin") check(!(await keychain()).success, "and removes it from the Keychain");

step("Tokens never show");
const leaks: string[] = [];
for await (const f of walk(work)) {
  if (f.endsWith("token.txt") || f.endsWith("credentials.json")) continue;
  const t = await Deno.readTextFile(f).catch(() => "");
  if (/(pane|amb_at|amb_rt|amb_code)_[0-9a-f]{20,}/.test(t)) leaks.push(f.replace(work + "/", ""));
}
check(leaks.length === 0, `no token in any config file${leaks.length ? `: ${leaks.join(", ")}` : ""}`);
say("(and the transcript above is checked for token patterns after it is written)");

say(`\n${failed ? `${failed} check(s) FAILED` : "All checks passed."}`);
srv.kill("SIGTERM");
await srv.status;
await srv.stderr.cancel().catch(() => {});
for (const s of [SERVICE, `${SERVICE}-ci`]) await new Deno.Command("/usr/bin/security", { args: ["delete-generic-password", "-s", s], stdout: "null", stderr: "null" }).output().catch(() => {});
await Deno.remove(work, { recursive: true });
Deno.exit(failed ? 1 : 0);

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) yield* walk(p); else if (e.isFile) yield p;
  }
}
