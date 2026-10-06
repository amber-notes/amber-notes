// For the end-to-end run only: the real MCP server (supabase/functions/mcp/server.ts, its request
// handler unchanged) over HTTP, on an in-process Postgres with every migration (pglite.ts), with a
// seeded, end-to-end encrypted test account and an Amber Notes token made the way the app makes one.
// No Docker, no Supabase, nothing remote.
//
//   deno run -A cli/e2e/local_server.ts --port 8787 --token-file <path> [--classic]
//
// The token goes to --token-file (mode 600) and is never printed. POST /__app plays the iPhone app
// writing to the account: { op: "edit", id, text } | { op: "create", folder, text }.
import { parseArgs } from "@std/cli/parse-args";

const args = parseArgs(Deno.args, { string: ["port", "token-file"], boolean: ["classic"] });
const port = Number(args.port ?? 8787);
Deno.env.set("MCP_PUBLIC_URL", `http://127.0.0.1:${port}/mcp`);
Deno.env.set("SUPABASE_URL", `http://127.0.0.1:${port}`);
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "local");
if (args.classic) Deno.env.delete("AMBER_MCP_TOOLS");
else Deno.env.set("AMBER_MCP_TOOLS", "files");

const mcp = "../../supabase/functions/mcp";
const { schemaDB, sqlFor } = await import(`${mcp}/pglite.ts`);
const { account, app, edit, folder, lockedNote, note, notesPassword, toolContext } = await import(`${mcp}/sealed.ts`);
const { hex, tokenKey, wrap } = await import("../../supabase/functions/_shared/e2ee.ts");
const { handleRequest } = await import(`${mcp}/server.ts`);
const { runFileTool } = await import(`${mcp}/files_tools.ts`);

const pg = await schemaDB();
const a = await account(pg);

// A token as Settings › Connect an AI makes it: the device wraps the data key under it.
const token = `pane_${hex(crypto.getRandomValues(new Uint8Array(32)))}`;
const hash = hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))));
await app(pg, a.id, `select public.create_mcp_token('amber cli (e2e)', true, $1, $2)`, [hash, await wrap(a.dk.slice(), await tokenKey(token, "pane"), "pane", a.id)]);
const tokenFile = args["token-file"];
if (!tokenFile) throw new Error("--token-file is required");
await Deno.writeTextFile(tokenFile, token, { mode: 0o600 });

// The seeded account: notes at the top level, in folders, a sub-note, wiki links, a locked note and an app.
const work = await folder(pg, a, "Work");
const clients = await folder(pg, a, "Clients", work);
const travel = await folder(pg, a, "Travel");
await note(pg, a, "Groceries\n\n## Dairy\n- [ ] Milk\n- [ ] Butter\n\nSee [[Recipes]] for ideas.\n");
await note(pg, a, "Recipes\n\n- Shakshuka\n- Pasta e ceci\n");
await note(pg, a, "# Acme\n\nKickoff Monday 10:00.\n\n## Open questions\n- Budget?\n", { folder: clients });
await note(pg, a, "Weekly review\n\n- [ ] Inbox zero\n- [ ] Plan next week\n", { folder: work });
const trip = await note(pg, a, `Trip\n\nLisbon in May. Packing list below.\n`, { folder: travel });
await note(pg, a, "Packing\n\n- [ ] Passport\n- [ ] Charger\n", { folder: travel, parent: trip });
await lockedNote(pg, a, await notesPassword(pg, a), "Diary", { folder: work });
const ctx = await toolContext(pg, a, true, "seed");
await runFileTool("create", { type: "app", path: "Work/Habits.md" }, ctx).catch(() => {});

const sql = sqlFor(pg);
Deno.serve({ port, hostname: "127.0.0.1", onListen: () => console.log(`local Amber MCP server on http://127.0.0.1:${port}/mcp (${args.classic ? "classic" : "files"} tools)`) }, async (req) => {
  const url = new URL(req.url);
  if (url.pathname === "/__app" && req.method === "POST") {
    const op = await req.json();
    if (op.op === "edit") await edit(pg, a, op.id, op.text);
    else if (op.op === "create") {
      const id = await note(pg, a, op.text, { folder: ({ Work: work, Travel: travel } as Record<string, string>)[op.folder] ?? null });
      return Response.json({ id });
    } else return new Response("unknown op", { status: 400 });
    return Response.json({ ok: true });
  }
  if (url.pathname === "/__ready") return new Response("ok");
  return await handleRequest(req, sql);
});
