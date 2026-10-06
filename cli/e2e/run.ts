// The end-to-end run: the compiled amber binary against the real MCP server (local_server.ts),
// every step checked from the other side. Prints a transcript; exits non-zero if a check fails.
//
//   deno task compile && deno run -A e2e/run.ts [--bin dist/amber-macos-arm64] > e2e/transcript.txt
//
// "Amber (the iPhone app)" writes to the account as the app does (sealed rows, POST /__app);
// "Amber (Claude on the phone)" is a second MCP client using the files tools.
import { parseArgs } from "@std/cli/parse-args";
import { connect, type Mcp } from "../src/client.ts";

const args = parseArgs(Deno.args, { string: ["bin"] });
const cli = new URL("..", import.meta.url).pathname;
const bin = args.bin ? `${Deno.cwd()}/${args.bin}`.replace(/^.*\/\//, "/") : `${cli}dist/amber-macos-arm64`;
const work = await Deno.makeTempDir({ prefix: "amber-e2e-" });
const env = { XDG_CONFIG_HOME: `${work}/config`, NO_COLOR: "1" };
let failed = 0;
let token = "";

const say = (s = "") => console.log(s);
const step = (s: string) => say(`\n## ${s}\n`);
const check = (ok: boolean, what: string) => { say(`  ${ok ? "PASS" : "FAIL"} ${what}`); if (!ok) failed++; };
const hide = (s: string) => token ? s.replaceAll(token, "<token>") : s;

async function amber(line: string, stdin?: string): Promise<string> {
  say(`$ amber ${line}${stdin ? " < token.txt" : ""}`);
  const p = new Deno.Command(bin, { args: line.match(/"[^"]*"|\S+/g)!.map((a) => a.replace(/^"|"$/g, "")), cwd: work, env, stdin: stdin ? "piped" : "null", stdout: "piped", stderr: "piped" }).spawn();
  if (stdin) { const w = p.stdin.getWriter(); await w.write(new TextEncoder().encode(stdin)); await w.close(); }
  const o = await p.output();
  const text = hide(new TextDecoder().decode(o.stdout) + new TextDecoder().decode(o.stderr)).replaceAll(work + "/", "").trimEnd();
  if (text) say(text.replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /gm, ""));
  return text;
}
async function sh(line: string, run: () => Promise<unknown>) {
  say(`$ ${line}`);
  await run();
}
const file = (rel: string) => Deno.readTextFile(`${work}/notes/${rel}`).catch(() => undefined);
async function tree(dir = "notes") {
  const out: string[] = [];
  const walk = async (rel: string) => {
    for await (const e of Deno.readDir(`${work}/${dir}${rel ? "/" + rel : ""}`)) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.name === ".amber") continue;
      if (e.isDirectory) await walk(p); else out.push(p);
    }
  };
  await walk("");
  return out.sort();
}
async function waitFor(what: string, cond: () => Promise<boolean>, seconds = 20) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 500)); }
  check(false, `${what} (waited ${seconds}s)`);
  return false;
}

const freePort = () => { const l = Deno.listen({ port: 0, hostname: "127.0.0.1" }); const p = (l.addr as Deno.NetAddr).port; l.close(); return p; };

async function startServer(port: number, classic: boolean) {
  const tokenFile = `${work}/token-${port}.txt`;
  const p = new Deno.Command(Deno.execPath(), { args: ["run", "-A", `${cli}e2e/local_server.ts`, "--port", String(port), "--token-file", tokenFile, ...(classic ? ["--classic"] : [])], stdout: "piped", stderr: "piped" }).spawn();
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/__ready`)).ok) break; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  return { proc: p, url: `http://127.0.0.1:${port}/mcp`, token: await Deno.readTextFile(tokenFile), app: (op: Record<string, unknown>) => fetch(`http://127.0.0.1:${port}/__app`, { method: "POST", body: JSON.stringify(op) }).then((r) => r.json()) };
}
const stop = async (p: Deno.ChildProcess) => { p.kill("SIGTERM"); await p.status; await p.stdout.cancel().catch(() => {}); await p.stderr.cancel().catch(() => {}); };

// MARK: files tools

const srv = await startServer(freePort(), false);
token = srv.token;
const phone: Mcp = await connect(srv.url, srv.token);
const remotePath = async (id: string) => (await phone.call("list", { all: true })).notes.find((n: { id: string }) => n.id === id)?.path;
const remoteText = async (path: string) => (await phone.call("fetch", { id: path })).text as string;
const idOf = async (path: string) => (await phone.call("list", { all: true })).notes.find((n: { path: string }) => n.path === path)?.id as string;

say(`# amber end-to-end run, ${new Date().toISOString().slice(0, 16)}Z`);
say(`binary: ${bin.replace(cli, "cli/")} (${Deno.build.os} ${Deno.build.arch}); server: ${srv.url}, the real MCP request handler with the files tools`);
say("on a fresh database with every migration, and a seeded end-to-end encrypted test account. Paths are relative to a temporary folder.");

step("Sign in");
await amber("--version");
const login = await amber(`login --server ${srv.url}`, srv.token);
const mode = (await Deno.stat(`${work}/config/amber/config.json`)).mode! & 0o777;
say(`$ stat -f %Lp config/amber/config.json\n${mode.toString(8)}`);
check(mode === 0o600, "the token file is mode 600");
check(!login.includes("pane_"), "the token is never printed");
await amber("status");

step("Pull the account into a folder");
await amber("pull notes");
say(`$ find notes -name '*.md'\n${(await tree()).map((p) => `notes/${p}`).join("\n")}`);
say(`$ cat notes/Groceries.md\n${await file("Groceries.md")}`);
check((await file("Groceries.md"))?.includes("[[Recipes]]") === true, "[[wikilinks]] stay as written");
check((await file("Travel/Trip/Packing.md")) !== undefined, "a sub-note sits in its parent's folder");
check(!(await tree()).some((p) => p.includes("Diary")), "the locked note is skipped");
check(!(await tree()).some((p) => p.includes(".app")), "the note's app is skipped; its text syncs (Work/Habits.md)");

step("Edit here, see it in Amber");
await sh(`sed -i '' 's/- \\[ \\] Milk/- [x] Milk/' notes/Groceries.md`, async () => {
  await Deno.writeTextFile(`${work}/notes/Groceries.md`, (await file("Groceries.md"))!.replace("- [ ] Milk", "- [x] Milk"));
});
await amber("sync notes");
const g = await remoteText("Groceries.md");
say(`[Amber] fetch Groceries.md\n${g}`);
check(g.includes("- [x] Milk"), "the tick is in Amber");
const hist = await phone.call("history", { id: "Groceries.md" });
check(JSON.stringify(hist).includes("amber cli (e2e)"), "Amber's history names the token that made the change");

step("Change a note in Amber, see the file change");
const acme = await idOf("Work/Clients/Acme.md");
say(`[Amber, the iPhone app] edits Work/Clients/Acme.md: "Kickoff Monday 10:00." becomes "Kickoff Tuesday 09:00."`);
await srv.app({ op: "edit", id: acme, text: "# Acme\n\nKickoff Tuesday 09:00.\n\n## Open questions\n- Budget?\n" });
await amber("sync notes");
say(`$ cat notes/Work/Clients/Acme.md\n${await file("Work/Clients/Acme.md")}`);
check((await file("Work/Clients/Acme.md"))?.includes("Tuesday 09:00") === true, "the file has the app's edit");

step("Create, both ways");
await sh(`mkdir notes/Ideas && printf -- '- tomatoes\\n- basil\\n' > notes/Ideas/Garden.md`, async () => {
  await Deno.mkdir(`${work}/notes/Ideas`);
  await Deno.writeTextFile(`${work}/notes/Ideas/Garden.md`, "- tomatoes\n- basil\n");
});
say(`[Amber, the iPhone app] creates "Standup" in Work`);
await srv.app({ op: "create", folder: "Work", text: "Standup\n\n- Yesterday: CLI\n- Today: tests\n" });
await amber("sync notes");
const garden = await idOf("Ideas/Garden.md");
check(Boolean(garden), "Ideas/Garden.md is a note in Amber");
say(`[Amber] fetch Ideas/Garden.md\n${garden ? await remoteText("Ideas/Garden.md") : "(missing)"}`);
check((await file("Ideas/Garden.md"))?.startsWith("Garden\n") === true, "a file without a title line gets its name as the first line");
check((await file("Work/Standup.md"))?.includes("Today: tests") === true, "the app's new note is a file");

step("Move and rename, both ways");
await sh(`mkdir notes/Archive && mv "notes/Work/Weekly review.md" notes/Archive/`, async () => {
  await Deno.mkdir(`${work}/notes/Archive`);
  await Deno.rename(`${work}/notes/Work/Weekly review.md`, `${work}/notes/Archive/Weekly review.md`);
});
const weekly = await idOf("Work/Weekly review.md");
await sh(`mv notes/Recipes.md notes/Cooking.md`, () => Deno.rename(`${work}/notes/Recipes.md`, `${work}/notes/Cooking.md`));
const recipes = await idOf("Recipes.md");
say(`[Amber, Claude on the phone] move Travel/Trip.md → Work/`);
await phone.call("move", { id: "Travel/Trip.md", to: "Work/" });
await amber("sync notes");
check(await remotePath(weekly) === "Archive/Weekly review.md", "the move here is a move in Amber");
check(await remotePath(recipes) === "Cooking.md", "the rename here renames the note in Amber");
say(`$ head -1 notes/Cooking.md\n${(await file("Cooking.md"))?.split("\n")[0]}`);
check((await file("Cooking.md"))?.startsWith("Cooking\n") === true, "and its first line (the title) follows");
check((await file("Work/Trip.md")) !== undefined && (await file("Work/Trip/Packing.md")) !== undefined && (await file("Travel/Trip.md")) === undefined, "Amber's move moves the file, its sub-note with it");

step("Delete, both ways");
const standup = await idOf("Work/Standup.md");
await sh(`rm notes/Work/Standup.md`, () => Deno.remove(`${work}/notes/Work/Standup.md`));
say(`[Amber, Claude on the phone] delete Cooking.md`);
await phone.call("delete", { id: "Cooking.md" });
await amber("sync notes");
const deleted = await phone.call("list", { path: "Recently Deleted/" });
check(deleted.notes.some((n: { id: string }) => n.id === standup), "the file deleted here is in Amber's Recently Deleted");
check((await file("Cooking.md")) === undefined, "the note deleted in Amber is gone from the folder");
const trashDir = (await Array.fromAsync(Deno.readDir(`${work}/notes/.amber/trash`)))[0]?.name;
say(`$ ls notes/.amber/trash/${trashDir}\n${(await Array.fromAsync(Deno.readDir(`${work}/notes/.amber/trash/${trashDir}`))).map((e) => e.name).join("\n")}`);
check(Boolean(trashDir), "and kept in .amber/trash");

step("A conflict: the same note changed on both sides");
await sh(`printf '\\n- Bring the slides.\\n' >> notes/Work/Clients/Acme.md`, async () => {
  await Deno.writeTextFile(`${work}/notes/Work/Clients/Acme.md`, "\n- Bring the slides.\n", { append: true });
});
say(`[Amber, the iPhone app] edits Work/Clients/Acme.md: kickoff moves to Wednesday`);
await srv.app({ op: "edit", id: acme, text: "# Acme\n\nKickoff Wednesday 14:00.\n\n## Open questions\n- Budget?\n" });
await amber("sync notes");
const copies = (await tree()).filter((p) => p.startsWith("Work/Clients/"));
say(`$ ls notes/Work/Clients\n${copies.map((p) => p.split("/").pop()).join("\n")}`);
const copyPath = copies.find((p) => p.includes("(conflict "));
say(`$ cat notes/Work/Clients/Acme.md\n${await file("Work/Clients/Acme.md")}`);
say(`$ cat "notes/${copyPath}"\n${copyPath ? await file(copyPath) : "(none)"}`);
check((await file("Work/Clients/Acme.md"))?.includes("Wednesday") === true, "the note's file has Amber's text");
check(Boolean(copyPath && (await file(copyPath))?.includes("Bring the slides")), "this folder's text is kept as a conflict copy");
check(Boolean(copyPath && await idOf(copyPath)), "the conflict copy is a note in Amber too, so the phone sees both");

step("Watch: changes go both ways without running sync by hand");
say(`$ amber sync notes --watch --interval 5 &`);
const watch = new Deno.Command(bin, { args: ["sync", "notes", "--watch", "--interval", "5"], cwd: work, env, stdout: "piped", stderr: "piped" }).spawn();
const watchOut: string[] = [];
const collect = async (s: ReadableStream<Uint8Array>) => { for await (const c of s.pipeThrough(new TextDecoderStream())) watchOut.push(c); };
const collecting = Promise.all([collect(watch.stdout), collect(watch.stderr)]);
await new Promise((r) => setTimeout(r, 2500));
await sh(`printf '\\n- Pears\\n' >> notes/Groceries.md`, () => Deno.writeTextFile(`${work}/notes/Groceries.md`, "\n- Pears\n", { append: true }));
const t0 = Date.now();
if (await waitFor("the local edit reaches Amber", async () => (await remoteText("Groceries.md")).includes("Pears"))) check(true, `the local edit reached Amber in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
say(`[Amber, the iPhone app] ticks "Plan next week" in Archive/Weekly review.md`);
await srv.app({ op: "edit", id: weekly, text: "Weekly review\n\n- [ ] Inbox zero\n- [x] Plan next week\n" });
const t1 = Date.now();
if (await waitFor("Amber's edit reaches the file", async () => (await file("Archive/Weekly review.md"))?.includes("- [x] Plan next week") === true)) check(true, `Amber's edit reached the file in ${((Date.now() - t1) / 1000).toFixed(1)}s (polling every 5s)`);
watch.kill("SIGTERM");
await watch.status;
await collecting;
say(`$ kill %1   # the watch printed:\n${hide(watchOut.join("")).replace(/^\d{4}-\d\d-\d\dT[\d:.]+Z /gm, "").replaceAll(work + "/", "").trimEnd()}`);

step("Status");
await amber("status notes");

await phone.close();
await stop(srv.proc);

// MARK: classic tools

step("The same against the classic tools (what production runs today)");
const old = await startServer(freePort(), true);
token = old.token;
await amber(`login --server ${old.url}`, old.token);
await amber("pull classic");
const before = await Deno.readTextFile(`${work}/classic/Groceries.md`);
await sh(`sed -i '' 's/- \\[ \\] Butter/- [x] Butter/' classic/Groceries.md`, () => Deno.writeTextFile(`${work}/classic/Groceries.md`, before.replace("- [ ] Butter", "- [x] Butter")));
await sh(`printf 'Made with classic tools\\n' > classic/Work/New.md`, () => Deno.writeTextFile(`${work}/classic/Work/New.md`, "Made with classic tools\n"));
await amber("sync classic");
const oldMcp = await connect(old.url, old.token);
const listed = await oldMcp.call("list_notes", { include_sub_notes: true, limit: 200 });
const gid = listed.notes.find((n: { title: string }) => n.title === "Groceries").id;
check((await oldMcp.call("read_note", { id: gid })).markdown.includes("- [x] Butter"), "the edit is in Amber through edit_note");
check(listed.notes.some((n: { title: string; folder: string }) => n.title === "New" && n.folder === "Work"), "the new file is a note through create_note, titled by its file name");
check((await Array.fromAsync(Deno.readDir(`${work}/classic/Travel/Trip`))).some((e) => e.name === "Packing.md"), "sub-notes get the same paths as with the files tools");
await oldMcp.close();
await stop(old.proc);

step("Token hygiene");
const leaks: string[] = [];
for (const t of [srv.token, old.token]) {
  for await (const f of walkAll(work)) {
    if (f.endsWith("config.json") || f.includes("/token-")) continue;
    if ((await Deno.readTextFile(f).catch(() => "")).includes(t)) leaks.push(f.replace(work + "/", ""));
  }
}
check(leaks.length === 0, `no token in any synced file, state file or trash${leaks.length ? `: ${leaks.join(", ")}` : ""}`);

say(`\n${failed ? `${failed} check(s) FAILED` : "All checks passed."}`);
await Deno.remove(work, { recursive: true });
Deno.exit(failed ? 1 : 0);

async function* walkAll(dir: string): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) yield* walkAll(p); else if (e.isFile) yield p;
  }
}
