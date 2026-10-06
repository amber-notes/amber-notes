// amber: your Amber Notes from the terminal. The same verbs the connector gives AIs (search, list,
// read, create, edit, write, move, delete, history, restore, pin), as a thin MCP client over the
// Amber Notes MCP server. See README.md.
import { accessToken, login, logout, revoke } from "./src/auth.ts";
import { connect, Refused, redact, ToolFailed, VERSION } from "./src/client.ts";
import { parse } from "./src/args.ts";
import { format, readText } from "./src/format.ts";
import { DEFAULT_SERVER, loadConfig, loadCredentials, saveConfig, saveCredentials, where } from "./src/store.ts";

const HELP = `amber: your Amber Notes from the terminal

Notes are paths like "Work/Acme.md"; folders end in "/". A note's id works too.

  amber search <words>               find notes ("quoted phrase", OR, -word)
  amber list [<folder>/]             overview, or a folder's notes
  amber read <note> [--lines 40-90]  print a note's markdown
  amber create <folder> [<text>]     new note; the first line is its title (text or stdin)
  amber edit <note> <old> <new>      replace exact text, once (--all for every match)
  amber write <note>                 replace the whole note with stdin
  amber move <note> <to>             to a folder ("Archive/") or a new name ("Work/New.md")
  amber delete <note>                to Recently Deleted
  amber history <note>               earlier versions
  amber restore <note> [<version>]   undelete, or bring back a version
  amber pin <note> [--off]

  amber login                        connect: approve in Amber Notes on your iPhone or Mac
  amber logout                       disconnect this terminal
  amber status                       who and where

Add --json for the server's full answer (for scripts and agents).
amber help <command> for more.`;

const MORE: Record<string, string> = {
  search: `amber search <words> [--limit 10]\n\nFinds notes by their words. "exact phrase", a OR b, -word. Locked notes are left out.\nPrints each note's path and a snippet.`,
  list: `amber list               the overview: folders, pinned and recently edited notes\namber list Work/          a folder's notes and sub-folders\namber list "Recently Deleted/"\namber list --all         every note and folder with its version (for scripts)`,
  read: `amber read <note> [--lines 40-120]\n\nPrints the note's markdown exactly, nothing else, so it pipes.\nLong notes come in parts; amber read says on stderr how to get the next one.`,
  create: `amber create Work "Standup\\n\\n- shipped the CLI"\namber create Work < note.md\namber create Work/Standup.md < body.md     (adds "Standup" as the first line if missing)\namber create Work/Clients/                 (a folder)\n\n  --inside <note>   make it a sub-note of that note\n  --pin             pin it`,
  edit: `amber edit <note> <old text> <new text> [--all] [--expect-version N]\n\nExact search and replace. old text must occur exactly once (unless --all), or nothing changes.\nnew text "" deletes. --expect-version fails if the note changed since that version.\nPrints what the change broke, if anything (a damaged table, a checklist line that won't tick).`,
  write: `amber write <note> [--expect-version N] < new.md\n\nReplaces the whole note with stdin. The old text stays in history. Prefer edit for small changes.`,
  move: `amber move <note> Archive/           to a folder (made if needed)\namber move <note> "Work/New name.md"  rename (rewrites the first line)\namber move Work/ Archive/Work/        a folder`,
  delete: `amber delete <note>     to Recently Deleted, with its sub-notes; amber restore brings it back for 30 days\namber delete Work/      a folder: its notes go to Recently Deleted`,
  history: `amber history <note> [--limit 10]\n\nEarlier versions, newest first, with who made each (a device, or an AI).`,
  restore: `amber restore <note>              out of Recently Deleted\namber restore <note> <version>    bring back a version from amber history (the current text is kept too)`,
  pin: `amber pin <note>\namber pin <note> --off`,
  login: `amber login                 opens your browser; approve in Amber Notes on your iPhone or Mac\namber login --no-browser    for a server or SSH session: prints the address to open anywhere,\n                            then takes the address the browser ends on\namber login --read-only     ask for read access only\namber login --token         paste an access token from Settings › Connect an AI (for CI)\n\nOr set AMBER_TOKEN. The connection shows in Settings › Connect an AI, where you can disconnect it.\nTokens are kept in ${where()}.`,
};

const out = (s: string) => console.log(s);
const fail = (s: string, code = 1): never => { console.error(`amber: ${redact(s)}`); Deno.exit(code); };

async function stdinText(): Promise<string> {
  return await new Response(Deno.stdin.readable).text();
}

async function readSecret(prompt: string): Promise<string> {
  if (!Deno.stdin.isTerminal()) return (await stdinText()).trim();
  await Deno.stderr.write(new TextEncoder().encode(prompt));
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
    await Deno.stderr.write(new TextEncoder().encode("\n"));
  }
  return s.trim();
}

/** Opens the browser: $AMBER_BROWSER, else open (macOS) or xdg-open (Linux with a display). */
async function openBrowser(url: string): Promise<boolean> {
  const custom = Deno.env.get("AMBER_BROWSER");
  const cmd = custom ? custom : Deno.build.os === "darwin" ? "open" : (Deno.env.get("DISPLAY") || Deno.env.get("WAYLAND_DISPLAY")) ? "xdg-open" : null;
  if (!cmd || Deno.env.get("SSH_CONNECTION") && !custom && Deno.build.os !== "darwin") return false;
  try {
    const p = new Deno.Command(cmd, { args: [url], stdout: "null", stderr: "null", stdin: "null" }).spawn();
    if (!custom) return (await p.status).success;
    p.unref();
    return true;
  } catch {
    return false;
  }
}

async function askLine(prompt: string): Promise<string | null> {
  await Deno.stderr.write(new TextEncoder().encode(prompt));
  const reader = Deno.stdin.readable.pipeThrough(new TextDecoderStream()).getReader();
  let line = "";
  while (!line.includes("\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    line += value;
  }
  reader.releaseLock();
  return line.trim() || null;
}

/** "Work/Acme.md" with text: the folder, and the text with "Acme" as its first line. */
function noteFor(path: string, text: string): { folder: string; content: string } {
  const parts = path.split("/");
  const stem = parts.pop()!.replace(/\.md$/i, "");
  const first = text.split("\n").find((l) => l.trim())?.replace(/^\s*#{1,6}\s+/, "").trim();
  return { folder: parts.join("/"), content: first === stem ? text : `${stem}\n\n${text}` };
}

async function main() {
  const args = parse(Deno.args);
  const [cmd, ...rest] = args._;
  if (args.version) return out(VERSION);
  if (!cmd || cmd === "help" || args.help) return out(MORE[cmd === "help" ? rest[0] : cmd] ?? HELP);
  const cfg = await loadConfig();
  const server = (args.server ?? Deno.env.get("AMBER_SERVER") ?? cfg.server ?? DEFAULT_SERVER).replace(/\/+$/, "");

  if (cmd === "login") {
    // The sign-in this one replaces is disconnected once the new one works, so none is left behind.
    const old = await loadCredentials(server);
    if (args.token) {
      const token = await readSecret("Access token from Amber Notes › Settings › Connect an AI: ");
      if (!/^pane_[0-9a-f]{64}$/i.test(token)) fail("That isn't an Amber Notes access token (pane_ and 64 letters and digits).");
      const mcp = await connect(server, () => Promise.resolve(token)).catch((e) => fail(e instanceof Refused ? "The server refused that token." : e.message));
      await mcp.close();
      await saveCredentials(server, { access_token: token });
    } else {
      const c = await login(server, { open: openBrowser, say: (l) => console.error(l), ask: askLine }, { noBrowser: args["no-browser"], readOnly: args["read-only"] });
      if (!c) return;
    }
    if (old) await revoke(server, old);
    await saveConfig({ ...cfg, server: server === DEFAULT_SERVER ? undefined : server });
    const c = (await loadCredentials(server))!;
    const access = args.token ? "the token's access" : c.scope?.includes("notes:write") ? "read & edit" : "read only";
    return out(`Connected to Amber Notes (${access}). Tokens are kept in ${where()}.\nDisconnect any time: amber logout, or Settings › Connect an AI in the app.`);
  }
  if (cmd === "logout") {
    const what = await logout(server);
    return out(what === "revoked" ? "Disconnected this terminal from Amber Notes." : what === "forgotten"
      ? "Forgot the access token here. It keeps working until you delete it in Amber Notes › Settings › Connect an AI." : "This terminal wasn't connected.");
  }

  const mcp = await connect(server, (force) => accessToken(server, force)).catch((e) =>
    fail(e instanceof Refused ? (Deno.env.get("AMBER_TOKEN") ? "The server refused AMBER_TOKEN." : "Amber Notes turned this terminal away. Run `amber login` to connect again.") : e.message));
  try {
    if (cmd === "status") {
      const c = Deno.env.get("AMBER_TOKEN") ? null : await loadCredentials(server);
      const write = mcp.tools.includes("write") || mcp.tools.includes("replace_note_body");
      out(`server  ${server}\naccess  ${write ? "read & edit" : "read only"}${Deno.env.get("AMBER_TOKEN") ? " (AMBER_TOKEN)" : c?.refresh_token ? ` (signed in; tokens in ${where()})` : " (access token)"}\ntools   ${mcp.tools.includes("fetch") && mcp.tools.includes("list") ? "files" : "classic"}`);
      return;
    }
    if (!mcp.tools.includes("fetch") || !mcp.tools.includes("list")) {
      fail(`This server offers the classic tools (${mcp.tools.slice(0, 4).join(", ")}, …), not the file tools amber uses.`);
    }
    const need = (n: number, usage: string) => { if (rest.length < n) fail(`Usage: ${usage}\nMore: amber help ${cmd}`); };
    const ver = args["expect-version"] !== undefined ? { expected_version: Number(args["expect-version"]) } : {};
    let tool: string, call: Record<string, unknown>;
    switch (cmd) {
      case "search": need(1, "amber search <words>"); tool = "search"; call = { query: rest.join(" "), ...(args.limit ? { limit: Number(args.limit) } : {}) }; break;
      case "list": case "ls": tool = "list"; call = args.all ? { all: true } : rest[0] ? { path: rest[0] } : {}; break;
      case "read": case "cat": need(1, "amber read <note>"); tool = "fetch"; call = { id: rest[0], ...(args.lines ? { lines: args.lines } : {}) }; break;
      case "create": {
        need(1, "amber create <folder> [<text>]");
        const text = rest.length > 1 ? rest.slice(1).join(" ") : Deno.stdin.isTerminal() ? "" : await stdinText();
        tool = "create";
        if (!text.trim()) {
          if (!rest[0].endsWith("/")) fail("Give the note's text, as an argument or on stdin. (A folder ends in /.)");
          call = { type: "folder", path: rest[0] };
        } else if (/\.md$/i.test(rest[0])) {
          const n = noteFor(rest[0], text);
          call = { content: n.content, ...(n.folder ? { path: n.folder } : {}) };
        } else call = { content: text, path: rest[0] };
        if (args.inside) call = { content: call.content, inside: args.inside };
        if (args.pin) call.pinned = true;
        break;
      }
      case "edit": need(3, "amber edit <note> <old text> <new text>"); tool = "edit"; call = { id: rest[0], edits: [{ old_text: rest[1], new_text: rest[2], ...(args.all ? { replace_all: true } : {}) }], ...ver }; break;
      case "write": {
        need(1, "amber write <note> < new.md");
        if (Deno.stdin.isTerminal()) fail("amber write reads the new text from stdin: amber write <note> < new.md");
        tool = "write"; call = { id: rest[0], content: await stdinText(), ...ver }; break;
      }
      case "move": case "mv": need(2, "amber move <note> <to>"); tool = "move"; call = { id: rest[0], to: rest[1] }; break;
      case "delete": case "rm": need(1, "amber delete <note>"); tool = "delete"; call = { id: rest[0] }; break;
      case "history": need(1, "amber history <note>"); tool = "history"; call = { id: rest[0], ...(args.limit ? { limit: Number(args.limit) } : {}) }; break;
      case "restore": need(1, "amber restore <note> [<version>]"); tool = "restore"; call = { id: rest[0], ...(rest[1] ? { version: Number(rest[1]) } : {}) }; break;
      case "pin": need(1, "amber pin <note> [--off]"); tool = "pin"; call = { id: rest[0], pinned: !args.off }; break;
      default: return fail(`Unknown command "${cmd}".\n\n${HELP}`);
    }
    if (!mcp.tools.includes(tool)) fail(`This connection can only read notes. Run amber login (without --read-only) to edit.`);
    const r = await mcp.call(tool, call);
    if (args.json) return out(JSON.stringify(r, null, 2));
    if (tool === "fetch") {
      const text = readText(r);
      await Deno.stdout.write(new TextEncoder().encode(text.endsWith("\n") ? text : text + "\n"));
      const next = String(r?.metadata?.next ?? "").match(/(\d+)-/);
      if (next) console.error(`(more: amber read ${JSON.stringify(rest[0])} --lines ${next[1]}-)`);
      return;
    }
    out(format(tool, r));
  } catch (e) {
    if (e instanceof ToolFailed) fail(e.message);
    if (e instanceof Refused) fail("Amber Notes turned this terminal away. Run `amber login` to connect again.");
    throw e;
  } finally {
    await mcp.close().catch(() => {});
  }
}

try {
  await main();
} catch (e) {
  fail(String((e as Error)?.message ?? e));
}
