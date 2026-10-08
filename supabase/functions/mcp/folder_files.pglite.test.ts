// Files as folder items, in the database (20261008100000_folder_files.sql): whose folder a file may
// go in, older apps' writes keeping it there, a deleted folder taking its files to Recently
// Deleted, and the 30-day purge.
//   cd supabase/functions/mcp && deno test -A folder_files.pglite.test.ts
import { assert, assertEquals, assertRejects, assertStringIncludes } from "jsr:@std/assert@1";
import type { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import { schemaDB } from "./pglite.ts";
import { aesKey, sealFile } from "../_shared/e2ee.ts";
import { type Account, account, app, file, folder, note, opened, stubStorage, toolContext } from "./sealed.ts";
import { runTool, ToolError } from "./tools.ts";
import { FILE_TOOLS, runFileTool } from "./files_tools.ts";
const FILE_TOOLS_META = () => FILE_TOOLS.find((t) => t.name === "write")!._meta;

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

// MARK: The AI's view (files_tools.ts, paths.ts, folder_files.ts)

const BASE = "https://proj.supabase.co";
function storageStub() {
  Deno.env.set("SUPABASE_URL", BASE);
  Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
  const objects = new Map<string, Uint8Array>();
  return { objects, unstub: stubStorage(BASE, objects) };
}
const enc = (s: string) => new TextEncoder().encode(s);
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));

Deno.test("files in a folder are plain files to the AI: paths only, list, fetch, search, move, rename, delete, restore", async () => {
  const { objects, unstub } = storageStub();
  try {
    const pg = await schemaDB();
    const a = await account(pg);
    const toRead = await folder(pg, a, "To read");
    await note(pg, a, "Reading plan\n\nOne paper a week.", { folder: toRead });
    const put = async (name: string, type: string, bytes: Uint8Array) => { const f = await file(pg, a, name, type, bytes, { folder: toRead }); objects.set(f.path, f.sealed); return f; };
    await put("Attention.pdf", "com.adobe.pdf", PDF);
    await put("Budget.csv", "public.comma-separated-values-text", enc("month,amount\nOct,40\n"));
    const twin = await put("Attention.pdf", "com.adobe.pdf", PDF);
    // A file a note embeds stays out of the folder's own files.
    await file(pg, a, "Photo.jpg", "public.jpeg", PDF);

    const listing = await tool(pg, a, "list", { path: "To read/" });
    const paths = listing.entries.map((e: { path: string }) => e.path).sort();
    assertEquals(paths, ["To read/Attention (2).pdf", "To read/Attention.pdf", "To read/Budget.csv", "To read/Reading plan.md"]);
    const csvEntry = listing.entries.find((e: { path: string }) => e.path === "To read/Budget.csv");
    assertEquals([csvEntry.type, csvEntry.kind, csvEntry.bytes], ["file", "text/csv", 20]);
    assert(!JSON.stringify(listing).includes(twin.id), "no ids in what the AI sees");

    // Text files read with line numbers; pane-file:<id> from older clients still works.
    const csv = await tool(pg, a, "fetch", { id: "to read/budget.csv" });
    assertStringIncludes(csv.text, "month,amount");
    assertEquals(csv.metadata.path, "To read/Budget.csv");
    assertEquals((await tool(pg, a, "fetch", { id: `pane-file:${twin.id}` })).metadata.path, "To read/Attention (2).pdf");
    // raw: the bytes themselves, base64.
    const raw = await tool(pg, a, "fetch", { id: "To read/Attention.pdf", raw: true });
    assertEquals(raw.content[1].resource.mimeType, "application/pdf");
    assertEquals(atob(raw.content[1].resource.blob), new TextDecoder().decode(PDF));

    assertEquals((await tool(pg, a, "search", { pattern: "budget", type: "file" })).files, ["To read/Budget.csv"]);

    // Move (folder made if needed), rename in place; the ending stays, names stay sealed.
    assertEquals((await tool(pg, a, "move", { path: "To read/Attention (2).pdf", to: "Archive/" })).moved, "Archive/Attention.pdf");
    assertEquals((await tool(pg, a, "move", { path: "Archive/Attention.pdf", to: "Archive/Attention, older copy.pdf" })).moved, "Archive/Attention, older copy.pdf");
    assertStringIncludes(await fails(tool(pg, a, "move", { path: "To read/Budget.csv", to: "To read/Budget.xlsx" })), "Keep the file's ending");
    const [row] = await app(pg, a.id, `select meta_ct from public.attachments where id = $1`, [twin.id]);
    assert(!row.meta_ct.includes("older"));

    // Delete to Recently Deleted, listed there, restored into its folder; a gone folder's file lands in Notes.
    assertEquals((await tool(pg, a, "delete", { path: "To read/Attention.pdf" })).now_at, "Recently Deleted/Attention.pdf");
    assertStringIncludes(await fails(tool(pg, a, "fetch", { id: "To read/Attention.pdf" })), "Nothing at");
    assertEquals((await tool(pg, a, "restore", { path: "Recently Deleted/Attention.pdf" })).restored, "To read/Attention.pdf");
    await tool(pg, a, "delete", { path: "Archive/" });
    assertEquals((await tool(pg, a, "restore", { path: "Recently Deleted/Attention, older copy.pdf" })).restored, "Notes/Attention, older copy.pdf");
    assertStringIncludes(await fails(tool(pg, a, "pin", { path: "To read/Budget.csv", pinned: true })), "pin takes a note");
  } finally { unstub(); }
});

Deno.test("text files change like notes: read first, exact edits, every version kept and restorable", async () => {
  const { objects, unstub } = storageStub();
  try {
    const pg = await schemaDB();
    const a = await account(pg);
    const toRead = await folder(pg, a, "To read");
    const f = await file(pg, a, "Budget.csv", "public.comma-separated-values-text", enc("month,amount\nOct,40\n"), { folder: toRead });
    objects.set(f.path, f.sealed);
    assertStringIncludes(await fails(tool(pg, a, "edit", { path: "To read/Budget.csv", old_string: "40", new_string: "45" })), "Read To read/Budget.csv with fetch");
    await tool(pg, a, "fetch", { id: "To read/Budget.csv" });
    assertEquals((await tool(pg, a, "edit", { path: "To read/Budget.csv", old_string: "Oct,40", new_string: "Oct,45\nNov,12" })).edited, "To read/Budget.csv");
    assertStringIncludes((await tool(pg, a, "fetch", { id: "To read/Budget.csv" })).text, "Nov,12");
    // The stored object is sealed; the old bytes are a version.
    assert(!new TextDecoder().decode(objects.get(f.path)!).includes("Nov"));
    const [r] = await app(pg, a.id, `select content_version from public.attachments where id = $1`, [f.id]);
    assertEquals(r.content_version, 1, "devices fetch the new bytes");
    const h = await tool(pg, a, "history", { path: "To read/Budget.csv" });
    assertEquals(h.versions.length, 1);
    assertEquals([h.versions[0].made_by, h.versions[0].name], ["Claude", "Budget.csv"]);
    await tool(pg, a, "restore", { path: "To read/Budget.csv", version: h.versions[0].version });
    assertEquals((await tool(pg, a, "fetch", { id: "To read/Budget.csv" })).text.includes("Nov"), false);
    assertEquals((await tool(pg, a, "history", { path: "To read/Budget.csv" })).versions.length, 2, "what restore replaced is kept too");
    // A file that changed since it was read is refused.
    await app(pg, a.id, `update public.attachments set content_version = content_version + 1 where id = $1`, [f.id]);
    assertStringIncludes(await fails(tool(pg, a, "edit", { path: "To read/Budget.csv", old_string: "Oct", new_string: "Okt" })), "changed since you read it");
    // A PDF isn't edited as text.
    const p = await file(pg, a, "Paper.pdf", "com.adobe.pdf", PDF, { folder: toRead });
    objects.set(p.path, p.sealed);
    await tool(pg, a, "fetch", { id: "To read/Paper.pdf", raw: true });
    assertStringIncludes(await fails(tool(pg, a, "edit", { path: "To read/Paper.pdf", old_string: "a", new_string: "b" })), "isn't text");
  } finally { unstub(); }
});

Deno.test("an edit made in the app keeps the version it replaces, as the AI's do (SyncEngine.keepServerVersion)", async () => {
  const { objects, unstub } = storageStub();
  try {
    const pg = await schemaDB();
    const a = await account(pg);
    const other = await account(pg);
    const site = await folder(pg, a, "Site");
    const f = await file(pg, a, "index.html", "public.html", enc("<h1>Hi</h1>"), { folder: site });
    objects.set(f.path, f.sealed);
    // What the app does, as the signed-in person: copy the bytes to <path>.v<n>, a version row with
    // the meta it had, then the new bytes and a content version past the server's.
    const [old] = await app(pg, a.id, `select meta_ct, size, updated_at from public.attachments where id = $1`, [f.id]);
    objects.set(`${f.path}.v1`, objects.get(f.path)!);
    await app(pg, a.id, `insert into public.attachment_versions (attachment_id, meta_ct, size, storage_path, client, made_at) values ($1, $2, $3, $4, 'Amber Notes', $5)`,
      [f.id, old.meta_ct, old.size, `${f.path}.v1`, old.updated_at]);
    const html = enc("<h1>Hello</h1>");
    objects.set(f.path, await sealFile(html, await aesKey(a.dk.slice()), a.keyId, f.id));
    await app(pg, a.id, `update public.attachments set meta_ct = $2, size = $3, content_version = 1 where id = $1`,
      [f.id, await a.vault.sealFileMeta(f.id, { name: "index.html", type: "public.html", size: html.length }), html.length]);
    assertStringIncludes((await tool(pg, a, "fetch", { id: "Site/index.html" })).text, "Hello");
    // Someone else can't add versions to it.
    await assertRejects(() => app(pg, other.id, `insert into public.attachment_versions (attachment_id, meta_ct, size, storage_path, client, made_at) values ($1, $2, $3, $4, 'Amber Notes', now())`,
      [f.id, old.meta_ct, old.size, `${f.path}.v2`]));
    const h = await tool(pg, a, "history", { path: "Site/index.html" });
    assertEquals(h.versions.length, 1);
    assertEquals([h.versions[0].made_by, h.versions[0].name], ["Amber Notes", "index.html"]);
    await tool(pg, a, "restore", { path: "Site/index.html", version: h.versions[0].version });
    assertEquals((await tool(pg, a, "fetch", { id: "Site/index.html" })).text.includes("<h1>Hi</h1>"), true, "the edit is undone from history");
  } finally { unstub(); }
});

Deno.test("write makes and replaces any file from base64, up to 10 MB, in a folder or a note's folder", async () => {
  const { objects, unstub } = storageStub();
  try {
    const pg = await schemaDB();
    const a = await account(pg);
    const toRead = await folder(pg, a, "To read");
    const made = await tool(pg, a, "write", { path: "To read/Summary.pdf", content_base64: b64(PDF), mime_type: "application/pdf" });
    assertEquals(made.created, "To read/Summary.pdf");
    const [row] = await app(pg, a.id, `select id, meta_ct, folder_id, storage_path from public.attachments where folder_id = $1`, [toRead]);
    assertEquals((await a.vault.openFileMeta(row.id, row.meta_ct)).type, "com.adobe.pdf");
    assert(objects.has(row.storage_path));
    // Text with content.
    assertEquals((await tool(pg, a, "write", { path: "To read/Notes.txt", content: "first line\n" })).created, "To read/Notes.txt");
    assertStringIncludes((await tool(pg, a, "fetch", { id: "To read/Notes.txt" })).text, "first line");
    // Replacing needs a read, keeps the old version.
    const replaced = await tool(pg, a, "write", { path: "To read/Summary.pdf", content_base64: b64(enc("%PDF-1.4 new")), mime_type: "application/pdf" });
    assertEquals(replaced.written, "To read/Summary.pdf");
    assertEquals((await tool(pg, a, "history", { path: "To read/Summary.pdf" })).versions.length, 1);
    // Into a note's folder: the note embeds it.
    const acme = await note(pg, a, "Acme\n\nThe client.", { folder: toRead });
    assertEquals((await tool(pg, a, "write", { path: "To read/Acme/contract.txt", content: "terms" })).created, "To read/Acme/contract.txt");
    assertStringIncludes((await opened(pg, a, acme)).body!, "](pane-file:");
    // Only kinds the app shows.
    assertStringIncludes(await fails(tool(pg, a, "write", { path: "To read/song.mp3", content_base64: b64(PDF), mime_type: "audio/mpeg" })), "can't show .mp3 files");
    // Over 10 MB: refused, nothing stored.
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    const before = objects.size;
    assertStringIncludes(await fails(tool(pg, a, "write", { path: "To read/Big.pdf", content_base64: b64Chunked(big), mime_type: "application/pdf" })), "up to 10 MB");
    assertEquals(objects.size, before);
  } finally { unstub(); }
});

function b64Chunked(u: Uint8Array) {
  let s = "";
  for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768));
  return btoa(s);
}

Deno.test("Office files and PDFs read as their text; what can't be read says so", async () => {
  const { objects, unstub } = storageStub();
  try {
    const { zipSync, strToU8 } = await import("npm:fflate@0.8.3");
    const pg = await schemaDB();
    const a = await account(pg);
    const docs = await folder(pg, a, "Docs");
    const docx = zipSync({ "word/document.xml": strToU8("<w:document><w:body><w:p><w:r><w:t>Quarterly plan &amp; goals</w:t></w:r></w:p><w:p><w:r><w:t>Ship less</w:t></w:r></w:p></w:body></w:document>") });
    const xlsx = zipSync({ "xl/sharedStrings.xml": strToU8("<sst><si><t>Name</t></si><si><t>Ada</t></si></sst>"), "xl/worksheets/sheet1.xml": strToU8(`<worksheet><sheetData><row><c t="s"><v>0</v></c><c><v>1</v></c></row><row><c t="s"><v>1</v></c><c><v>42</v></c></row></sheetData></worksheet>`) });
    const pptx = zipSync({ "ppt/slides/slide1.xml": strToU8("<p:sld><a:p><a:r><a:t>Welcome</a:t></a:r></a:p></p:sld>"), "ppt/slides/slide2.xml": strToU8("<p:sld><a:p><a:r><a:t>Roadmap</a:t></a:r></a:p></p:sld>") });
    for (const [name, type, bytes] of [["Plan.docx", "org.openxmlformats.wordprocessingml.document", docx], ["People.xlsx", "org.openxmlformats.spreadsheetml.sheet", xlsx], ["Deck.pptx", "org.openxmlformats.presentationml.presentation", pptx], ["Doc.pages", "com.apple.iwork.pages.sffpages", enc("x")], ["Scan.pdf", "com.adobe.pdf", PDF]] as [string, string, Uint8Array][]) {
      const f = await file(pg, a, name, type, bytes, { folder: docs });
      objects.set(f.path, f.sealed);
    }
    assertStringIncludes((await tool(pg, a, "fetch", { id: "Docs/Plan.docx" })).text, "Quarterly plan & goals");
    assertStringIncludes((await tool(pg, a, "fetch", { id: "Docs/People.xlsx" })).text, "Ada\t42");
    assertStringIncludes((await tool(pg, a, "fetch", { id: "Docs/Deck.pptx" })).text, "Slide 2");
    assertStringIncludes((await tool(pg, a, "fetch", { id: "Docs/Doc.pages" })).text, "raw: true");
    // Not a real PDF: the extractor's failure is said, never thrown.
    assertStringIncludes((await tool(pg, a, "fetch", { id: "Docs/Scan.pdf" })).text, "raw: true");
  } finally { unstub(); }
});

Deno.test("a file a note embeds is changed through the note, not moved or deleted on its own", async () => {
  const { objects, unstub } = storageStub();
  try {
    const pg = await schemaDB();
    const a = await account(pg);
    const photo = await file(pg, a, "Photo.jpg", "public.jpeg", PDF);
    objects.set(photo.path, photo.sealed);
    await note(pg, a, `Trip\n\n![Photo.jpg](pane-file:${photo.id})`);
    assertStringIncludes(await fails(tool(pg, a, "delete", { path: "Trip/Photo.jpg" })), "edit the note");
    assertStringIncludes(await fails(tool(pg, a, "move", { path: "Trip/Photo.jpg", to: "Archive/" })), "moves with the note");
  } finally { unstub(); }
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

// MARK: Storage per person (20261008100100_storage_limit_and_file_versions.sql)

/** An account that already stores `bytes` (one big file), put in without the triggers. */
async function stored(pg: PGlite, a: Account, bytes: number) {
  const f = await file(pg, a, "Archive.zip", "public.zip-archive", PDF);
  await pg.query(`set session_replication_role = replica`);
  await pg.query(`update public.attachments set size = $2 where id = $1`, [f.id, bytes]);
  await pg.query(`set session_replication_role = default`);
  // The minute-old count knew nothing of it.
  await pg.query(`update public.pane_usage set storage_at = null`);
  return f;
}
const GB2 = 2048 * 1024 * 1024;

Deno.test("2 GB per person: growth is refused at the limit, shrinking and deleting still work", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const keep = await note(pg, a, "Keep\n\nA long note that can get shorter.");
  const big = await stored(pg, a, GB2 - 10);
  // Room for 10 bytes: a new note doesn't fit.
  await assertRejects(() => note(pg, a, "New\n\nThis won't fit."), Error, "Pinto Notes is full");
  // An older app's file row that grows is refused the same way.
  await assertRejects(() => app(pg, a.id, `update public.attachments set size = size + 100 where id = $1`, [big.id]), Error, "Pinto Notes is full");
  // Editing a note down, and deleting, still work: the account keeps what it has.
  await app(pg, a.id, `update public.notes set body_ct = $2, head_ct = $3 where id = $1`,
    [keep, await a.vault.sealBody(keep, "Keep"), await a.vault.sealHead(keep, { title: "Keep", preview: "" })]);
  await app(pg, a.id, `update public.attachments set trashed_at = now() where id = $1`, [big.id]);
  // Recently Deleted still counts until it's gone for good.
  await assertRejects(() => note(pg, a, "New\n\nStill full."), Error, "Pinto Notes is full");
  await pg.query(`set session_replication_role = replica`);
  await pg.query(`update public.attachments set deleted_at = now() where id = $1`, [big.id]);
  await pg.query(`set session_replication_role = default`);
  await note(pg, a, "New\n\nFits now.");
});

Deno.test("Settings' numbers: used of 2 GB, by kind, and the limits", async () => {
  const pg = await schemaDB();
  const a = await account(pg);
  const toRead = await folder(pg, a, "To read");
  await note(pg, a, "Plan\n\nOne paper a week.", { folder: toRead });
  const gone = await note(pg, a, "Old\n\nGone soon.");
  await app(pg, a.id, `update public.notes set trashed_at = now() where id = $1`, [gone]);
  await file(pg, a, "Paper.pdf", "com.adobe.pdf", PDF, { folder: toRead });
  const [{ u }] = await app(pg, a.id, `select public.storage_usage() as u`);
  assertEquals(u.limit, GB2);
  assertEquals([u.file_limit, u.ai_file_limit], [100 * 1048576, 10 * 1048576]);
  assertEquals(u.files, PDF.length);
  assert(u.notes > 0 && u.deleted > 0, "Recently Deleted is shown on its own");
  assertEquals(u.used, u.notes + u.files + u.apps + u.deleted + u.versions);
  // Nobody else's numbers, and no way in without signing in.
  await assertRejects(() => pg.query(`select public.pane_storage_parts($1)`, [a.id]).then(() => app(pg, a.id, `select public.pane_storage_parts($1)`, [a.id])), Error, "permission denied");
});

Deno.test("the AI hears how full the account is and what to delete", async () => {
  const { unstub } = storageStub();
  try {
    const pg = await schemaDB();
    const a = await account(pg);
    await folder(pg, a, "To read");
    await stored(pg, a, GB2 - 10);
    const why = await fails(tool(pg, a, "write", { path: "To read/Notes.txt", content: "more than ten bytes of text" }));
    assertStringIncludes(why, "Pinto Notes is full: 2.00 GB of 2.00 GB used (files 2.00 GB");
    assertStringIncludes(why, "Nothing was saved");
    assertStringIncludes(why, "emptying Recently Deleted or deleting large files");
    assertStringIncludes(await fails(tool(pg, a, "create", { path: "To read/Plan.md", content: "Plan\n\nMore." })), "Pinto Notes is full");
  } finally { unstub(); }
});

Deno.test("ChatGPT hands a file over by link (openai/fileParams): fetched once, https only, 10 MB", async () => {
  const { objects, unstub } = storageStub();
  const real = globalThis.fetch;
  const inner = globalThis.fetch;
  globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://files.oaiusercontent.com/")) return Promise.resolve(new Response(PDF));
    return inner(input, init);
  };
  try {
    const pg = await schemaDB();
    const a = await account(pg);
    await folder(pg, a, "To Read");
    assertEquals(FILE_TOOLS_META(), { "openai/fileParams": ["file"] });
    const made = await tool(pg, a, "write", { path: "To Read/Scan.pdf", file: { download_url: "https://files.oaiusercontent.com/file-abc", file_id: "file-abc", mime_type: "application/pdf", file_name: "scan.pdf" } });
    assertEquals(made.created, "To Read/Scan.pdf");
    assertEquals(made.bytes, PDF.length);
    assert(objects.size === 1);
    assertStringIncludes(await fails(tool(pg, a, "write", { path: "To Read/X.pdf", file: { download_url: "http://files.oaiusercontent.com/x", file_id: "x" } })), "public https link");
    assertStringIncludes(await fails(tool(pg, a, "write", { path: "To Read/X.pdf", file: { download_url: "https://169.254.169.254/latest", file_id: "x" } })), "public https link");
  } finally { globalThis.fetch = real; unstub(); }
});
