// Files as folder items, in the database (20261007165000_folder_files.sql): whose folder a file may
// go in, older apps' writes keeping it there, a deleted folder taking its files to Recently
// Deleted, and the 30-day purge.
//   cd supabase/functions/mcp && deno test -A folder_files.pglite.test.ts
import { assert, assertEquals, assertRejects } from "jsr:@std/assert@1";
import { schemaDB } from "./pglite.ts";
import { account, app, file, folder } from "./sealed.ts";

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
