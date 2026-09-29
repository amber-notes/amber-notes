// Version history on the server (20260929200000_version_history.sql): who made each version,
// thinning old history, the ceiling, and restoring. Runs against the LOCAL stack, inside a
// transaction that is always rolled back, so the local database is left as it was:
//   scripts/mcp-e2e.sh history.e2e.test.ts
// If the migration isn't applied locally yet, the test applies it inside that transaction.
import { assert, assertEquals } from "jsr:@std/assert@1";
import postgres from "npm:postgres@3.4.5";

const dbURL = Deno.env.get("PANE_DB_URL");
const me = Deno.env.get("PANE_USER_JWT");
const enabled = Boolean(dbURL && me && /127\.0\.0\.1/.test(dbURL ?? ""));

const sub = (jwt: string) => JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub as string;
const migration = new URL("../../migrations/20260929200000_version_history.sql", import.meta.url);

class Rollback extends Error {}

type Tx = postgres.TransactionSql;

/** Runs `body` in a transaction that never commits. */
async function scratch(body: (tx: Tx, user: string) => Promise<void>) {
  const sql = postgres(dbURL!, { max: 1, prepare: false, onnotice: () => {} });
  try {
    await sql.begin(async (tx) => {
      const [{ applied }] = await tx`select to_regprocedure('public.restore_note_version(uuid, bigint)') is not null as applied`;
      if (!applied) await tx.unsafe(await Deno.readTextFile(migration));
      const user = sub(me!);
      await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: user, role: "authenticated" })}, true)`;
      // No rate limit in the way of a test that writes a lot at once.
      await tx`delete from public.pane_rate where user_id = ${user}`;
      await body(tx, user);
      throw new Rollback();
    });
  } catch (e) {
    if (!(e instanceof Rollback)) throw e;
  } finally {
    await sql.end();
  }
}

async function newNote(tx: Tx, body: string): Promise<string> {
  const id = crypto.randomUUID();
  await tx`insert into public.notes (id, user_id, body) values (${id}, ${sub(me!)}, ${body})`;
  return id;
}

/** Writes as the app on a device (the x-pane-device header), or as an AI (pane.client). */
async function edit(tx: Tx, id: string, body: string, as: { device?: string; ai?: string; source?: string }) {
  await tx`select set_config('pane.source', ${as.ai ? "mcp" : as.source ?? ""}, true),
                  set_config('pane.client', ${as.ai ?? ""}, true),
                  set_config('request.headers', ${as.device ? JSON.stringify({ "x-pane-device": as.device }) : ""}, true)`;
  await tx`update public.notes set body = ${body}, updated_at = now() where id = ${id}`;
  await tx`select set_config('pane.source', '', true), set_config('pane.client', '', true), set_config('request.headers', '', true)`;
}

Deno.test({ name: "history: each version records who wrote it, from the device header or the AI's name", ignore: !enabled }, async () => {
  await scratch(async (tx) => {
    const id = await newNote(tx, "Groceries\n\n- [ ] Oat milk");
    await edit(tx, id, "Groceries\n\n- [ ] Oat milk\n- [ ] Lemons", { device: "iPhone" });
    await edit(tx, id, "Groceries\n\n- [ ] Oat milk\n- [ ] Lemons\n- [ ] Saffron", { ai: "ChatGPT" });
    const [note] = await tx`select body_source, body_client, body_at from public.notes where id = ${id}`;
    assertEquals([note.body_source, note.body_client], ["mcp", "ChatGPT"]);
    assert(note.body_at);
    const revs = await tx`select version, source, client, body_source, body_client from public.note_revisions where note_id = ${id} order by version`;
    assertEquals(revs.length, 2);
    // The first text was written by the app with no header (an older app); the iPhone replaced it.
    assertEquals([revs[0].body_source, revs[0].body_client, revs[0].source, revs[0].client], ["app", null, "app", "iPhone"]);
    // The iPhone's text, replaced by ChatGPT.
    assertEquals([revs[1].body_source, revs[1].body_client, revs[1].source, revs[1].client], ["app", "iPhone", "mcp", "ChatGPT"]);
  });
});

Deno.test({ name: "history: a write that doesn't change the text can't forge who wrote it", ignore: !enabled }, async () => {
  await scratch(async (tx) => {
    const id = await newNote(tx, "Standup");
    await edit(tx, id, "Standup notes", { device: "Mac" });
    await tx`update public.notes set is_pinned = true, body_source = 'mcp', body_client = 'Forged' where id = ${id}`;
    const [note] = await tx`select body_source, body_client from public.notes where id = ${id}`;
    assertEquals([note.body_source, note.body_client], ["app", "Mac"]);
  });
});

Deno.test({ name: "history: thinning keeps a day, then hourly for a week, daily for 90 days, and AI edits for 90 days", ignore: !enabled }, async () => {
  await scratch(async (tx, user) => {
    const id = await newNote(tx, "Thin me");
    const now = new Date("2026-09-29T12:00:00Z");
    const ago = (h: number) => new Date(now.getTime() - h * 3600_000);
    // [label, hours ago, source]
    const rows: [string, number, string][] = [
      ["recent-a", 1, "app"], ["recent-b", 1.5, "app"], ["recent-c", 23, "app"],
      // Two in one hour two days ago: only the later stays.
      ["hour-old", 48.9, "app"], ["hour-new", 48.2, "app"],
      // Two on one day 20 days ago: only the later stays; an AI edit that day stays too.
      ["day-old", 20 * 24 + 5, "app"], ["day-ai", 20 * 24 + 4, "mcp"], ["day-new", 20 * 24 + 1, "app"],
      // Older than 90 days: gone, AI or not.
      ["ancient", 100 * 24, "app"], ["ancient-ai", 95 * 24, "mcp"],
    ];
    // Inserted with the trim trigger off, so the thinning below sees them all.
    await tx`alter table public.note_revisions disable trigger note_revisions_trim`;
    for (const [label, h, source] of rows) {
      await tx`insert into public.note_revisions (note_id, user_id, body, version, source, created_at)
               values (${id}, ${user}, ${label}, ${Math.round(1000 - h)}, ${source}, ${ago(h)})`;
    }
    await tx`alter table public.note_revisions enable trigger note_revisions_trim`;
    const [{ gone }] = await tx`select public.pane_thin_revisions(${id}, ${now}) as gone`;
    const left = (await tx`select body from public.note_revisions where note_id = ${id} order by created_at desc`).map((r) => r.body);
    assertEquals(left, ["recent-a", "recent-b", "recent-c", "hour-new", "day-new", "day-ai"]);
    assertEquals(gone, 4);
    // Thinning again changes nothing.
    assertEquals((await tx`select public.pane_thin_revisions(${id}, ${now}) as gone`)[0].gone, 0);
  });
});

Deno.test({ name: "history: the ceiling keeps the newest 500 revisions and at most 10 MB", ignore: !enabled }, async () => {
  await scratch(async (tx, user) => {
    const id = await newNote(tx, "Busy");
    await tx`alter table public.note_revisions disable trigger note_revisions_trim`;
    await tx`insert into public.note_revisions (note_id, user_id, body, version, source, created_at)
             select ${id}, ${user}, 'v' || g, g, 'mcp', now() - (g || ' seconds')::interval from generate_series(1, 520) g`;
    await tx`alter table public.note_revisions enable trigger note_revisions_trim`;
    await tx`select public.pane_thin_revisions(${id})`;
    const [{ n, oldest }] = await tx`select count(*)::int as n, max(version) as oldest from public.note_revisions where note_id = ${id}`;
    assertEquals(n, 500);
    assertEquals(Number(oldest), 500, "the 20 oldest went");

    // Bytes: three 4 MB versions don't fit in 10 MB; the newest two do.
    const other = await newNote(tx, "Big");
    const big = "x".repeat(4 * 1024 * 1024);
    await tx`alter table public.note_revisions disable trigger note_revisions_trim`;
    for (const v of [1, 2, 3]) {
      await tx`insert into public.note_revisions (note_id, user_id, body, version, created_at)
               values (${other}, ${user}, ${big}, ${v}, now() - (${10 - v} || ' minutes')::interval)`;
    }
    await tx`alter table public.note_revisions enable trigger note_revisions_trim`;
    await tx`select public.pane_thin_revisions(${other})`;
    const versions = (await tx`select version from public.note_revisions where note_id = ${other} order by version`).map((r) => Number(r.version));
    assertEquals(versions, [2, 3]);
  });
});

Deno.test({ name: "history: restoring writes the old text as a new version and keeps the one it replaces", ignore: !enabled }, async () => {
  await scratch(async (tx) => {
    const id = await newNote(tx, "Lisbon\n\n- Tram 28");
    await edit(tx, id, "Lisbon\n\n- Tram 28\n- Sintra", { device: "Mac" });
    // Typing again within the minute: throttled, no revision for the text in between.
    await edit(tx, id, "Lisbon\n\n- Tram 28\n- Sintra\n- Belém", { device: "Mac" });
    const before = (await tx`select count(*)::int as n from public.note_revisions where note_id = ${id}`)[0].n;
    assertEquals(before, 1);
    // As the signed-in person, through the function the app calls.
    await tx`set local role authenticated`;
    await tx`select set_config('request.headers', ${JSON.stringify({ "x-pane-device": "iPhone" })}, true)`;
    const [restored] = await tx`select * from public.restore_note_version(${id}, 1)`;
    assertEquals(restored.body, "Lisbon\n\n- Tram 28");
    assertEquals([restored.body_source, restored.body_client], ["restore", "iPhone"]);
    // The text it replaced is kept, even though the app wrote a revision seconds ago.
    const revs = await tx`select body, source from public.note_revisions where note_id = ${id} order by id`;
    assertEquals(revs.map((r) => r.source), ["app", "restore"]);
    assertEquals(revs[1].body, "Lisbon\n\n- Tram 28\n- Sintra\n- Belém");
    await tx`reset role`;
  });
});

Deno.test({ name: "history: a version that isn't kept can't be restored, and nobody restores someone else's note", ignore: !enabled }, async () => {
  await scratch(async (tx) => {
    const id = await newNote(tx, "Mine");
    await edit(tx, id, "Mine, edited", { device: "Mac" });
    await tx`set local role authenticated`;
    let message = "";
    await tx.savepoint(async (sp) => { await sp`select * from public.restore_note_version(${id}, 99)`; }).catch((e) => { message = e.message; });
    assertEquals(message, "That version is no longer kept.");
    // Someone else: row-level security hides the revision.
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub: crypto.randomUUID(), role: "authenticated" })}, true)`;
    message = "";
    await tx.savepoint(async (sp) => { await sp`select * from public.restore_note_version(${id}, 1)`; }).catch((e) => { message = e.message; });
    assertEquals(message, "That version is no longer kept.");
    await tx`reset role`;
  });
});

Deno.test({ name: "history: purging a note still forgets its history", ignore: !enabled }, async () => {
  await scratch(async (tx) => {
    const id = await newNote(tx, "Secret");
    await edit(tx, id, "Secret, edited", { device: "Mac" });
    await tx`update public.notes set body = '', deleted_at = now() where id = ${id}`;
    assertEquals((await tx`select count(*)::int as n from public.note_revisions where note_id = ${id}`)[0].n, 0);
  });
});
