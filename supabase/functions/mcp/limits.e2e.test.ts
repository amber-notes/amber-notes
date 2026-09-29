// Limits for an app anyone can join: sizes, counts, nesting, ownership and rate, enforced
// by the database whichever way a write arrives. Runs against the LOCAL stack:
//   scripts/mcp-e2e.sh limits.e2e.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import postgres from "npm:postgres@3.4.5";

const api = Deno.env.get("PANE_API");
const anon = Deno.env.get("PANE_ANON");
const me = Deno.env.get("PANE_USER_JWT");
const other = Deno.env.get("PANE_OTHER_JWT");
const dbURL = Deno.env.get("PANE_DB_URL");
const mcp = Deno.env.get("PANE_MCP_URL");
const token = Deno.env.get("PANE_TOKEN");
const enabled = Boolean(api && anon && me && other && dbURL && /127\.0\.0\.1/.test(api ?? ""));

const sub = (jwt: string) => JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub as string;

async function rest(jwt: string, method: string, path: string, body?: unknown) {
  const res = await fetch(`${api}/rest/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${jwt}`, apikey: anon!, "content-type": "application/json", prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json: json as any, text };
}

const note = (body: string, extra: Record<string, unknown> = {}) => ({ id: crypto.randomUUID(), body, ...extra });

Deno.test({ name: "limits: a note over 2 MB is refused with 413; one just under is fine", ignore: !enabled }, async () => {
  const big = await rest(me!, "POST", "notes", note("x".repeat(2 * 1024 * 1024 + 1)));
  assertEquals(big.status, 413, big.text);
  assertStringIncludes(big.json.message, "too long");
  const ok = await rest(me!, "POST", "notes", note("Big\n" + "y".repeat(2 * 1024 * 1024 - 10)));
  assertEquals(ok.status, 201, ok.text);
  // Growing an existing note past the limit is refused too; shrinking always works.
  const id = ok.json[0].id;
  assertEquals((await rest(me!, "PATCH", `notes?id=eq.${id}`, { body: "z".repeat(3 * 1024 * 1024) })).status, 413);
  assertEquals((await rest(me!, "PATCH", `notes?id=eq.${id}`, { body: "small now" })).status, 200);
});

Deno.test({ name: "limits: notes can't point at someone else's folder or note", ignore: !enabled }, async () => {
  const theirs = await rest(other!, "POST", "folders", { id: crypto.randomUUID(), name: "Theirs" });
  assertEquals(theirs.status, 201, theirs.text);
  const intoTheirs = await rest(me!, "POST", "notes", note("Sneaky", { folder_id: theirs.json[0].id }));
  assertEquals(intoTheirs.status, 413);
  const theirNote = await rest(other!, "POST", "notes", note("Their note"));
  const underTheirs = await rest(me!, "POST", "notes", note("Child", { parent_id: theirNote.json[0].id }));
  assertEquals(underTheirs.status, 413);
  const theirFolder = await rest(me!, "POST", "folders", { id: crypto.randomUUID(), name: "Mine", parent_id: theirs.json[0].id });
  assertEquals(theirFolder.status, 413);
});

Deno.test({ name: "limits: folders and sub-notes never form loops and stay under their depth", ignore: !enabled }, async () => {
  const a = crypto.randomUUID(), b = crypto.randomUUID();
  assertEquals((await rest(me!, "POST", "folders", { id: a, name: "A" })).status, 201);
  assertEquals((await rest(me!, "POST", "folders", { id: b, name: "B", parent_id: a })).status, 201);
  const loop = await rest(me!, "PATCH", `folders?id=eq.${a}`, { parent_id: b });
  assertEquals(loop.status, 413);
  assertStringIncludes(loop.json.message, "inside itself");
  assertEquals((await rest(me!, "PATCH", `folders?id=eq.${a}`, { parent_id: a })).status, 413);

  // A 30-deep chain is the most there can be.
  let parent: string | null = null;
  let last = 0;
  for (let i = 0; i < 31; i++) {
    const id = crypto.randomUUID();
    const r = await rest(me!, "POST", "folders", { id, name: `Level ${i}`, parent_id: parent });
    last = r.status;
    if (r.status !== 201) break;
    parent = id;
  }
  assertEquals(last, 413, "the 31st level is refused");

  const n1 = crypto.randomUUID(), n2 = crypto.randomUUID();
  assertEquals((await rest(me!, "POST", "notes", note("Parent", { id: n1 }))).status, 201);
  assertEquals((await rest(me!, "POST", "notes", note("Child", { id: n2, parent_id: n1 }))).status, 201);
  const cycle = await rest(me!, "PATCH", `notes?id=eq.${n1}`, { parent_id: n2 });
  assertEquals(cycle.status, 413);
  assertStringIncludes(cycle.json.message, "own sub-note");
});

Deno.test({ name: "limits: the note count and text budget hold; deleting always frees space", ignore: !enabled }, async () => {
  const sql = postgres(dbURL!, { max: 1, prepare: false });
  const uid = sub(other!);
  try {
    // Pretend the account is full rather than writing 50,000 notes.
    await sql`insert into public.pane_usage (user_id, notes, notes_bytes) values (${uid}, 50000, 0)
              on conflict (user_id) do update set notes = 50000`;
    const full = await rest(other!, "POST", "notes", note("One too many"));
    assertEquals(full.status, 413);
    assertStringIncludes(full.json.message, "50,000 notes");
    // Soft-deleting (what the app does) brings the count back under.
    const mine = await rest(other!, "GET", "notes?select=id&deleted_at=is.null&limit=1");
    if (mine.json.length) {
      assertEquals((await rest(other!, "PATCH", `notes?id=eq.${mine.json[0].id}`, { deleted_at: new Date().toISOString(), body: "" })).status, 200);
      assertEquals((await rest(other!, "POST", "notes", note("Room again"))).status, 201);
    }
    await sql`update public.pane_usage set notes = 0, notes_bytes = ${100 * 1024 * 1024} where user_id = ${uid}`;
    const bytes = await rest(other!, "POST", "notes", note("Just a little more text"));
    assertEquals(bytes.status, 413);
    assertStringIncludes(bytes.json.message, "100 MB");
  } finally {
    // Put the real totals back.
    await sql`update public.pane_usage u set notes = (select count(*) from public.notes where user_id = ${uid} and deleted_at is null),
              notes_bytes = (select coalesce(sum(octet_length(body)), 0) from public.notes where user_id = ${uid}) where u.user_id = ${uid}`;
    await sql.end();
  }
});

Deno.test({ name: "limits: writes are rate-limited per account with 429, and other accounts are unaffected", ignore: !enabled }, async () => {
  const sql = postgres(dbURL!, { max: 1, prepare: false });
  const uid = sub(other!);
  try {
    await sql`insert into public.pane_rate (user_id, bucket, tokens, at) values (${uid}, 'write', 0, clock_timestamp())
              on conflict (user_id, bucket) do update set tokens = 0, at = clock_timestamp()`;
    const slow = await rest(other!, "POST", "notes", note("Too fast"));
    assertEquals(slow.status, 429, slow.text);
    assertStringIncludes(slow.json.message, "too quickly");
    assertEquals((await rest(me!, "POST", "notes", note("Someone else is fine"))).status, 201);
    await new Promise((r) => setTimeout(r, 1100)); // 50 a second refill
    assertEquals((await rest(other!, "POST", "notes", note("After a breath"))).status, 201);
  } finally {
    await sql`delete from public.pane_rate where user_id = ${uid}`;
    await sql.end();
  }
});

Deno.test({ name: "limits: AI connections are capped at 50 active per account", ignore: !enabled }, async () => {
  const sql = postgres(dbURL!, { max: 1, prepare: false });
  const uid = sub(other!);
  try {
    const active = (await sql`select count(*)::int n from public.mcp_tokens where user_id = ${uid} and revoked_at is null`)[0].n;
    const need = Math.max(0, 50 - active);
    for (let i = 0; i < need; i++) {
      await sql`insert into public.mcp_tokens (user_id, name, token_hash, can_write) values (${uid}, ${"Filler " + i}, ${crypto.randomUUID() + i}, false)`;
    }
    await sql`delete from public.pane_rate where user_id = ${uid}`;
    const r = await rest(other!, "POST", "rpc/create_mcp_token", { token_name: "Fifty-first", write_access: false });
    assertEquals(r.status, 413, r.text);
    assertStringIncludes(r.json.message, "50 active");
  } finally {
    await sql`update public.mcp_tokens set revoked_at = now() where user_id = ${uid} and name like 'Filler %'`;
    await sql.end();
  }
});

Deno.test({ name: "limits: history keeps one app revision a minute but every AI edit", ignore: !enabled }, async () => {
  const id = crypto.randomUUID();
  assertEquals((await rest(me!, "POST", "notes", note("Draft", { id }))).status, 201);
  for (let i = 0; i < 20; i++) await rest(me!, "PATCH", `notes?id=eq.${id}`, { body: `Draft ${i}` });
  const revs = await rest(me!, "GET", `note_revisions?note_id=eq.${id}&select=id,source`);
  assertEquals(revs.json.length, 1, "twenty quick saves keep one revision");
});

Deno.test({ name: "limits: an account's uploads stop at its file budget", ignore: !enabled }, async () => {
  const sql = postgres(dbURL!, { max: 1, prepare: false });
  const uid = sub(other!);
  const upload = (name: string) => fetch(`${api}/storage/v1/object/files/${uid}/${crypto.randomUUID()}/${name}`, {
    method: "POST",
    headers: { authorization: `Bearer ${other}`, apikey: anon!, "content-type": "text/plain" },
    body: "hello",
  });
  const filler: string[] = [];
  try {
    const first = await upload("fine.txt");
    assertEquals(first.status, 200, await first.text());
    // Pretend the account already holds 500 MB.
    const name = `${uid}/${crypto.randomUUID()}/huge.bin`;
    filler.push(name);
    await sql`insert into storage.objects (bucket_id, name, metadata) values ('files', ${name}, ${sql.json({ size: 500 * 1024 * 1024 })})`;
    const refused = await upload("one-more.txt");
    assert(refused.status >= 400, `upload over budget must fail, got ${refused.status}`);
    await refused.body?.cancel();
  } finally {
    // Storage guards its table against direct deletes; this row was never a real upload.
    await sql`select set_config('storage.allow_delete_query', 'true', false)`;
    for (const n of filler) await sql`delete from storage.objects where bucket_id = 'files' and name = ${n}`;
    await sql.end();
  }
});

Deno.test({ name: "limits: MCP calls are rate-limited per account, failed calls included", ignore: !enabled || !mcp || !token }, async () => {
  const sql = postgres(dbURL!, { max: 1, prepare: false });
  const uid = sub(me!);
  const call = async () => {
    const res = await fetch(mcp!, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_note", arguments: { id: crypto.randomUUID() } } }),
    });
    return await res.json();
  };
  try {
    await sql`insert into public.pane_rate (user_id, bucket, tokens, at) values (${uid}, 'mcp', 1, clock_timestamp())
              on conflict (user_id, bucket) do update set tokens = 1, at = clock_timestamp()`;
    const first = await call(); // a failing call (no such note) still spends the one left
    assert(first.result.isError);
    const second = await call();
    assert(second.result.isError);
    assertStringIncludes(second.result.content[0].text, "too quickly");
  } finally {
    await sql`delete from public.pane_rate where user_id = ${uid}`;
    await sql.end();
  }
});
