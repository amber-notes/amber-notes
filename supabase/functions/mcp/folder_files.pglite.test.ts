// Files as folder items, in the database (20261007165000_folder_files.sql): whose folder a file may
// go in, older apps' writes keeping it there, a deleted folder taking its files to Recently
// Deleted, and the 30-day purge.
//   cd supabase/functions/mcp && deno test -A folder_files.pglite.test.ts
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { schemaDB } from "./pglite.ts";
import { type Account, account, app, file, folder, note, stubStorage, toolContext } from "./sealed.ts";
import { runTool, ToolError } from "./tools.ts";
import { runFileTool } from "./files_tools.ts";

// deno-lint-ignore no-explicit-any
const tool = async (pg: PGlite, a: Account, name: string, args: Record<string, unknown> = {}) => await runFileTool(name, args, await toolContext(pg, a, true)) as any;
// deno-lint-ignore no-explicit-any
const classic = async (pg: PGlite, a: Account, name: string, args: Record<string, unknown> = {}) => await runTool(name, args, await toolContext(pg, a, true)) as any;
const fails = async (p: Promise<unknown>) => { try { await p; } catch (e) { assert(e instanceof ToolError, String(e)); return (e as Error).message; } throw new Error("expected a ToolError"); };

const PDF = new TextEncoder().encode("%PDF-1.4 a paper");

Deno.test("a file sits in one of its owner's folders, never someone else's", async () => {
  const pg = await schemaDB();
  const a = await account(pg), b = await account(pg);
  const toRead = await folder(pg, a, "To read");
  const theirs = await folder(pg, b, "Theirs");
  const f = await file(pg, a, "Paper.pdf", "com.adobe.pdf", PDF, { folder: toRead });
  assertEquals((await app(pg, a.id, `select folder_id from public.attachments where id = $1`, [f.id]))[0].folder_id, toRead);
  await assertRejects(() => file(pg, a, "Sneaky.pdf", "com.adobe.pdf", PDF, { folder: theirs }), Error, "doesn't exist");
  await assertRejects(() => app(pg, a.id, `update public.attachments set folder_id = $2 where id = $1`, [f.id, theirs]), Error, "doesn't exist");
  // A file a note embeds has no folder, as before.
  const embedded = await file(pg, a, "Photo.jpg", "public.jpeg", PDF);
  assertEquals((await app(pg, a.id, `select folder_id from public.attachments where id = $1`, [embedded.id]))[0].folder_id, null);
});

Deno.test("an older app's write (no folder_id, no trashed_at) keeps both", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const toRead = await folder(pg, a, "To read");
  const f = await file(pg, a, "Paper.pdf", "com.adobe.pdf", PDF, { folder: toRead });
  await app(pg, a.id, `update public.attachments set trashed_at = now() where id = $1`, [f.id]);
  const [row] = await app(pg, a.id, `select meta_ct, size, storage_path, created_at from public.attachments where id = $1`, [f.id]);
  // What AttachmentDTO sends today: an upsert of exactly these columns.
  await app(pg, a.id, `insert into public.attachments (id, meta_ct, size, storage_path, created_at, updated_at, deleted_at)
    values ($1, $2, $3, $4, $5, now(), null)
    on conflict (id) do update set meta_ct = excluded.meta_ct, size = excluded.size, storage_path = excluded.storage_path,
      created_at = excluded.created_at, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at`,
    [f.id, row.meta_ct, row.size, row.storage_path, row.created_at]);
  const [after] = await app(pg, a.id, `select folder_id, trashed_at from public.attachments where id = $1`, [f.id]);
  assertEquals(after.folder_id, toRead);
  assert(after.trashed_at, "still in Recently Deleted");
});

Deno.test("deleting a folder (any app, any version) sends its files to Recently Deleted, and they sync", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const toRead = await folder(pg, a, "To read");
  const other = await folder(pg, a, "Other");
  const f1 = await file(pg, a, "One.pdf", "com.adobe.pdf", PDF, { folder: toRead });
  const f2 = await file(pg, a, "Two.pdf", "com.adobe.pdf", PDF, { folder: other });
  const [{ server_updated_at: before }] = await app(pg, a.id, `select server_updated_at from public.attachments where id = $1`, [f1.id]);
  await app(pg, a.id, `update public.folders set deleted_at = now(), updated_at = now() where id = $1`, [toRead]);
  const rows = await app(pg, a.id, `select id, trashed_at, deleted_at, server_updated_at from public.attachments order by id`);
  const one = rows.find((r: { id: string }) => r.id === f1.id), two = rows.find((r: { id: string }) => r.id === f2.id);
  assert(one.trashed_at && !one.deleted_at, "in Recently Deleted, not gone");
  assert(one.server_updated_at > before, "devices pull the change");
  assertEquals(two.trashed_at, null);
});

Deno.test("Recently Deleted keeps a file 30 days, then it's deleted for good", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const toRead = await folder(pg, a, "To read");
  const old = await file(pg, a, "Old.pdf", "com.adobe.pdf", PDF, { folder: toRead });
  const fresh = await file(pg, a, "Fresh.pdf", "com.adobe.pdf", PDF, { folder: toRead });
  await app(pg, a.id, `update public.attachments set trashed_at = now() - interval '31 days' where id = $1`, [old.id]);
  await app(pg, a.id, `update public.attachments set trashed_at = now() - interval '2 days' where id = $1`, [fresh.id]);
  await pg.query(`select public.pane_forget_files_daily()`);
  const rows = await app(pg, a.id, `select id, deleted_at from public.attachments`);
  assert(rows.find((r: { id: string }) => r.id === old.id).deleted_at);
  assertEquals(rows.find((r: { id: string }) => r.id === fresh.id).deleted_at, null);
  // Only the server's schedule runs it.
  await assertRejects(() => app(pg, a.id, `select public.pane_forget_files_daily()`), Error, "permission denied");
});

// MARK: The AI's view (files_tools.ts and folder_files.ts)

Deno.test("files in a folder are plain files to the AI: list, fetch, search, move, rename, delete, restore", async () => {
  const base = "https://proj.supabase.co";
  Deno.env.set("SUPABASE_URL", base);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  const pg = await schemaDB();
  const a = await account(pg);
  const toRead = await folder(pg, a, "To read");
  await note(pg, a, "Reading plan\n\nOne paper a week.", { folder: toRead });
  const paper = await file(pg, a, "Attention.pdf", "com.adobe.pdf", PDF, { folder: toRead });
  const csv = await file(pg, a, "Budget.csv", "public.comma-separated-values-text", new TextEncoder().encode("month,amount\nOct,40"), { folder: toRead });
  const twin = await file(pg, a, "Attention.pdf", "com.adobe.pdf", PDF, { folder: toRead });
  // A file a note embeds stays out of folder listings.
  await file(pg, a, "Photo.jpg", "public.jpeg", PDF);
  const unstub = stubStorage(base, new Map([[paper.path, paper.sealed], [csv.path, csv.sealed], [twin.path, twin.sealed]]));
  try {
    const overview = await tool(pg, a, "list");
    assertEquals(overview.folders.find((f: { path: string }) => f.path === "To read/"), { path: "To read/", notes: 1, files: 3 });

    const listing = await tool(pg, a, "list", { path: "To read/" });
    assertEquals(listing.notes.map((n: { path: string }) => n.path), ["To read/Reading plan.md"]);
    assertEquals(listing.files.map((f: { path: string }) => f.path).sort(), ["To read/Attention (2).pdf", "To read/Attention.pdf", "To read/Budget.csv"]);
    assertEquals(listing.files.find((f: { id: string }) => f.id === paper.id), { path: "To read/Attention.pdf", id: paper.id, type: "application/pdf", bytes: PDF.length, updated: listing.files.find((f: { id: string }) => f.id === paper.id).updated });

    // Read by path, by id, or as pane-file:<id>.
    const read = await tool(pg, a, "fetch", { id: "To read/Budget.csv" });
    assertEquals(read.content[1], { type: "text", text: "month,amount\nOct,40" });
    assertEquals(read.structured.folder, "To read");
    assertEquals((await tool(pg, a, "fetch", { id: "to read/attention (2).pdf" })).structured.id, twin.id);
    assertEquals((await tool(pg, a, "fetch", { id: paper.id })).content[1].resource.mimeType, "application/pdf");
    assertEquals((await tool(pg, a, "fetch", { id: `pane-file:${csv.id}` })).structured.filename, "Budget.csv");

    // Search finds files by name next to notes.
    assertEquals((await tool(pg, a, "search", { query: "budget" })).files.map((f: { path: string }) => f.path), ["To read/Budget.csv"]);

    // Move to another folder (made if needed), then rename in place; the ending stays.
    assertEquals((await tool(pg, a, "move", { id: "To read/Attention (2).pdf", to: "Archive/" })).moved, "Archive/Attention.pdf");
    assertEquals((await tool(pg, a, "move", { id: "Archive/Attention.pdf", to: "Archive/Attention, older copy.pdf" })).moved, "Archive/Attention, older copy.pdf");
    assertStringIncludes(await fails(tool(pg, a, "move", { id: "To read/Budget.csv", to: "To read/Budget.xlsx" })), "Keep the file's ending");
    assertStringIncludes(await fails(tool(pg, a, "move", { id: "To read/Budget.csv", to: "To read/attention.pdf" })), "Keep the file's ending");
    await file(pg, a, "Budget.csv", "public.comma-separated-values-text", PDF, { folder: await folder(pg, a, "Taken") });
    assertStringIncludes(await fails(tool(pg, a, "move", { id: "To read/Budget.csv", to: "Taken/" })), "already exists");
    // The new name is sealed, never stored readable.
    const [row] = await app(pg, a.id, `select meta_ct from public.attachments where id = $1`, [twin.id]);
    assert(!row.meta_ct.includes("older copy"));
    assertEquals((await a.vault.openFileMeta(twin.id, row.meta_ct)).name, "Attention, older copy.pdf");

    // Delete: to Recently Deleted, listed there, restored into its folder.
    assertEquals((await tool(pg, a, "delete", { id: "To read/Attention.pdf" })).moved_to, "Recently Deleted");
    assertEquals((await tool(pg, a, "list", { path: "To read/" })).files.map((f: { path: string }) => f.path), ["To read/Budget.csv"]);
    const trash = await tool(pg, a, "list", { path: "Recently Deleted/" });
    assertEquals(trash.files.map((f: { path: string }) => f.path), ["To read/Attention.pdf"]);
    assertStringIncludes(await fails(tool(pg, a, "fetch", { id: "To read/Attention.pdf" })), "Recently Deleted");
    assertEquals((await tool(pg, a, "restore", { id: `pane-file:${paper.id}` })).restored, "To read/Attention.pdf");

    // A restored file whose folder is gone lands in Notes.
    await tool(pg, a, "delete", { id: "Archive/" });
    assertEquals((await tool(pg, a, "list", { path: "Recently Deleted/" })).files.map((f: { id: string }) => f.id), [twin.id]);
    assertEquals((await tool(pg, a, "restore", { id: twin.id })).restored, "Notes/Attention, older copy.pdf");

    // What files don't do.
    assertStringIncludes(await fails(tool(pg, a, "edit", { id: "To read/Budget.csv", edits: [{ old_text: "Oct", new_text: "Nov" }] })), "can't be changed here");
    assertStringIncludes(await fails(tool(pg, a, "write", { id: "To read/Budget.csv", content: "x" })), "can't be written here yet");
    assertStringIncludes(await fails(tool(pg, a, "pin", { id: "To read/Budget.csv", pinned: true })), "Only notes");
    assertStringIncludes(await fails(tool(pg, a, "history", { id: "To read/Budget.csv" })), "no earlier versions");
  } finally {
    unstub();
  }
});

Deno.test("a file a note embeds is changed through the note, not on its own", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const photo = await file(pg, a, "Photo.jpg", "public.jpeg", PDF);
  await note(pg, a, `Trip\n\n![Photo.jpg](pane-file:${photo.id})`);
  assertStringIncludes(await fails(tool(pg, a, "delete", { id: `pane-file:${photo.id}` })), "editing the note");
  assertStringIncludes(await fails(tool(pg, a, "move", { id: `pane-file:${photo.id}`, to: "Archive/" })), "editing the note");
});

Deno.test("list_files (production tools) names a file's folder and leaves out Recently Deleted", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const toRead = await folder(pg, a, "To read");
  const kept = await file(pg, a, "Paper.pdf", "com.adobe.pdf", PDF, { folder: toRead });
  const gone = await file(pg, a, "Gone.pdf", "com.adobe.pdf", PDF, { folder: toRead });
  const photo = await file(pg, a, "Photo.jpg", "public.jpeg", PDF);
  await app(pg, a.id, `update public.attachments set trashed_at = now() where id = $1`, [gone.id]);
  const { files } = await classic(pg, a, "list_files");
  assertEquals(files.map((f: { id: string }) => f.id).sort(), [kept.id, photo.id].sort());
  assertEquals(files.find((f: { id: string }) => f.id === kept.id).folder, "To read");
  assertEquals(files.find((f: { id: string }) => f.id === photo.id).folder, undefined);
});
