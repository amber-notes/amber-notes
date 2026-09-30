// Locked notes through the running MCP server, the way an AI client meets them: search leaves them
// out, reading says "This note is locked", every edit is refused. Runs against the LOCAL stack:
//   scripts/mcp-e2e.sh locked.e2e.test.ts
// locked.pglite.test.ts covers the same ground (and the database rules) without a stack.
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const api = Deno.env.get("PANE_API");
const anon = Deno.env.get("PANE_ANON");
const me = Deno.env.get("PANE_USER_JWT");
const mcp = Deno.env.get("PANE_MCP_URL");
const token = Deno.env.get("PANE_TOKEN");
const enabled = Boolean(api && anon && me && mcp && token && /127\.0\.0\.1/.test(api ?? ""));

async function rest(method: string, path: string, body?: unknown) {
  const res = await fetch(`${api}/rest/v1/${path}`, {
    method,
    // As the app: an account that locks notes only takes writes from lock-aware builds.
    headers: { authorization: `Bearer ${me}`, apikey: anon!, "content-type": "application/json", prefer: "return=representation", "x-amber-client": "lock-aware/1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

async function call(name: string, args: Record<string, unknown>) {
  const res = await fetch(mcp!, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const r = (await res.json()).result;
  return { error: r.isError === true, text: r.content[0].text as string, data: r.structuredContent };
}

/** The test account's notes password setup, and its key id. Removed again at the end (see below). */
async function keyID(): Promise<string> {
  const got = await rest("GET", "note_locks?select=key_id");
  if (got.json?.length) return got.json[0].key_id;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", salt));
  const key_id = [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const made = await rest("POST", "note_locks", { salt: btoa(String.fromCharCode(...salt)), iterations: 600000, key_id, verifier: "v", hint: "e2e" });
  assertEquals(made.status, 201, JSON.stringify(made.json));
  return made.json[0].key_id;
}

const sealed = (key: string) => `amb2.${key}.${btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(48))))}`;

Deno.test({ name: "locked: search leaves the note out, reading says it's locked, edits are refused", ignore: !enabled }, async () => {
  const key = await keyID();
  const stamp = crypto.randomUUID().slice(0, 8);
  const id = crypto.randomUUID();
  const made = await rest("POST", "notes", { id, body: `Vault ${stamp}`, locked_body: sealed(key) });
  assertEquals(made.status, 201, JSON.stringify(made.json));

  const found = await call("search_notes", { query: `Vault ${stamp}` });
  assert(!found.error, found.text);
  assert(!found.data.results.some((r: { id: string }) => r.id === id), "search must skip a locked note");

  const listed = await call("list_notes", { limit: 200 });
  const row = listed.data.notes.find((n: { id: string }) => n.id === id);
  assertEquals([row?.title, row?.locked, row?.preview], [`Vault ${stamp}`, true, undefined]);

  for (const name of ["read_note", "fetch"]) {
    const r = await call(name, { id });
    assert(r.error, `${name} must refuse`);
    assertStringIncludes(r.text, "This note is locked");
  }
  for (const [name, args] of [
    ["edit_note", { id, edits: [{ old_text: "Vault", new_text: "Open" }] }],
    ["append_to_note", { id, text: "more" }],
    ["replace_note_body", { id, body: "Replaced" }],
  ] as const) {
    const r = await call(name, args);
    assert(r.error, `${name} must refuse`);
    assertStringIncludes(r.text, "This note is locked");
  }
  const after = await rest("GET", `notes?id=eq.${id}&select=body,locked_body`);
  assertEquals(after.json[0].body, `Vault ${stamp}`);
  await rest("PATCH", `notes?id=eq.${id}`, { trashed_at: new Date().toISOString() });
});

Deno.test({ name: "locked: locking a shared note stops its link", ignore: !enabled }, async () => {
  const key = await keyID();
  const id = crypto.randomUUID();
  assertEquals((await rest("POST", "notes", { id, body: "Plans\n\nSecret" })).status, 201);
  const slug = (await rest("POST", "rpc/share_note", { p_note: id })).json as string;
  assert((await rest("POST", "rpc/shared_note", { p_slug: slug })).json, "shared before locking");
  const locked = await rest("PATCH", `notes?id=eq.${id}`, { body: "Plans", locked_body: sealed(key) });
  assertEquals(locked.status, 200, JSON.stringify(locked.json));
  assertEquals((await rest("POST", "rpc/shared_note", { p_slug: slug })).json, null);
  const again = await rest("POST", "rpc/share_note", { p_note: id });
  assertStringIncludes(JSON.stringify(again.json), "can't be shared");
  const history = await rest("GET", `note_revisions?note_id=eq.${id}&select=body`);
  assertEquals(history.json, [], "locking leaves no readable version");
  await rest("PATCH", `notes?id=eq.${id}`, { trashed_at: new Date().toISOString() });
});

// The other MCP tests share this account and write like an older app would: leave it without a
// notes password. (Only the database owner can delete a setup.)
Deno.test({ name: "locked: remove the test account's notes password", ignore: !enabled || !Deno.env.get("PANE_DB_URL") }, async () => {
  const { default: postgres } = await import("npm:postgres@3.4.5");
  const sql = postgres(Deno.env.get("PANE_DB_URL")!, { max: 1, prepare: false });
  const sub = JSON.parse(atob(me!.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub as string;
  try {
    await sql`delete from public.note_locks where user_id = ${sub}`;
  } finally {
    await sql.end();
  }
});
