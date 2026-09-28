// End-to-end: drives the running MCP server the way an AI client does.
// Run: PANE_MCP_URL=… PANE_TOKEN=… deno test -A supabase/functions/mcp/e2e.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

const url = Deno.env.get("PANE_MCP_URL");
const token = Deno.env.get("PANE_TOKEN");
const enabled = Boolean(url && token);
let nextId = 1;

async function rpc(method: string, params?: unknown, auth: string | null = token!, path = "") {
  const res = await fetch(url! + path, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(auth ? { authorization: `Bearer ${auth}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method, params }),
  });
  return { status: res.status, body: await res.json() };
}

async function call(name: string, args: Record<string, unknown> = {}, auth: string = token!) {
  const { body } = await rpc("tools/call", { name, arguments: args }, auth);
  if (body.error) return { error: true, rpcError: body.error, text: body.error.message as string, data: undefined as any };
  const r = body.result;
  return { error: r.isError === true, text: r.content[0].text as string, data: r.structuredContent };
}

Deno.test({ name: "rejects missing and bad tokens", ignore: !enabled }, async () => {
  assertEquals((await rpc("tools/list", {}, null)).status, 401);
  assertEquals((await rpc("tools/list", {}, "pane_" + "0".repeat(64))).status, 401);
});

Deno.test({ name: "accepts the token as the last path segment", ignore: !enabled }, async () => {
  const { status, body } = await rpc("tools/list", {}, null, "/" + token);
  assertEquals(status, 200);
  assert(body.result.tools.length > 10);
});

Deno.test({ name: "initialize and list tools", ignore: !enabled }, async () => {
  const init = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "e2e", version: "1" } });
  assertEquals(init.body.result.protocolVersion, "2025-06-18");
  assertEquals(init.body.result.serverInfo.name, "amber-notes");
  const { body } = await rpc("tools/list");
  const names = body.result.tools.map((t: { name: string }) => t.name);
  for (const n of ["search_notes", "read_note", "create_note", "edit_note", "append_to_note", "set_checklist_item", "note_history", "search", "fetch"]) {
    assert(names.includes(n), `missing tool ${n}`);
  }
});

Deno.test({ name: "a full editing session", ignore: !enabled }, async () => {
  const stamp = crypto.randomUUID().slice(0, 8);
  const created = await call("create_note", {
    body: `Trip ${stamp}\n\n## Packing\n- [ ] Passport\n- [ ] Charger\n\n## Plan\nFly out Friday.`,
    folder: `Travel ${stamp}/Summer`,
  });
  assert(!created.error, created.text);
  const id = created.data.created.id;
  assertEquals(created.data.created.folder, `Travel ${stamp}/Summer`);

  const found = await call("search_notes", { query: `Passport ${stamp}` });
  assert(found.data.results.some((r: { id: string }) => r.id === id), "search should find the note");

  const read = await call("read_note", { id, line_numbers: true });
  assertEquals(read.data.title, `Trip ${stamp}`);
  assertEquals(read.data.outline.checklist.open, 2);
  assertStringIncludes(read.data.markdown, "3│ ## Packing");

  const edited = await call("edit_note", { id, edits: [{ old_text: "Fly out Friday.", new_text: "Fly out **Saturday** morning." }], expected_version: read.data.version });
  assert(!edited.error, edited.text);

  const stale = await call("edit_note", { id, edits: [{ old_text: "Saturday", new_text: "Sunday" }], expected_version: read.data.version });
  assert(stale.error, "stale version must be refused");
  assertStringIncludes(stale.text, "changed since");

  const missing = await call("edit_note", { id, edits: [{ old_text: "not in the note", new_text: "x" }] });
  assert(missing.error);
  assertStringIncludes(missing.text, "not found");

  assert(!(await call("append_to_note", { id, text: "- [ ] Sunscreen", under_heading: "Packing" })).error);
  assert(!(await call("set_checklist_item", { id, item: "passport", checked: true })).error);

  const after = await call("read_note", { id });
  // Ticked items sink below the open ones, like in the app.
  assertStringIncludes(after.data.markdown, "- [ ] Charger\n- [ ] Sunscreen\n- [x] Passport\n\n## Plan");
  assertStringIncludes(after.data.markdown, "Fly out **Saturday** morning.");

  const history = await call("note_history", { id });
  assert(history.data.revisions.length >= 3, "each edit should leave a revision");
  assertEquals(history.data.revisions[0].replaced_by, "Claude Code (test)");
  const original = history.data.revisions.at(-1);
  assert(!(await call("restore_revision", { id, revision_id: original.revision_id })).error);
  assertStringIncludes((await call("read_note", { id })).data.markdown, "Fly out Friday.");

  assert(!(await call("delete_note", { id })).error);
  assert((await call("read_note", { title: `Trip ${stamp}` })).error, "deleted notes aren't found by title");
  assert(!(await call("restore_note", { id })).error);
  assertEquals((await call("read_note", { id })).data.in_recently_deleted, false);

  const fetched = await call("fetch", { id });
  assertEquals(fetched.data.title, `Trip ${stamp}`);

  const folders = await call("delete_folder", { folder: `Travel ${stamp}` });
  assertEquals(folders.data.deleted_folders, 2);
  assertEquals(folders.data.notes_moved_to_recently_deleted, 1);
});

const other = Deno.env.get("PANE_OTHER_TOKEN");
Deno.test({ name: "another user's token sees nothing, and a read-only token can't write", ignore: !enabled || !other }, async () => {
  const mine = await call("create_note", { body: "Private thought " + crypto.randomUUID() });
  const id = mine.data.created.id;
  try {
    const res = await fetch(url!, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${other}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "read_note", arguments: { id } } }),
    }).then((r) => r.json());
    assert(res.result.isError, "other user must not read the note");
    const list = await fetch(url!, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${other}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    }).then((r) => r.json());
    const names = list.result.tools.map((t: { name: string }) => t.name);
    assert(!names.includes("create_note"), "read-only token shouldn't see write tools");
    const write = await fetch(url!, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${other}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "delete_note", arguments: { id } } }),
    }).then((r) => r.json());
    assert(write.result.isError);
    assertStringIncludes(write.result.content[0].text, "read-only");
  } finally {
    await call("delete_note", { id });
  }
});

const api = Deno.env.get("PANE_API");
const anon = Deno.env.get("PANE_ANON");
const userJwt = Deno.env.get("PANE_USER_JWT");
Deno.test({ name: "files: list and fetch through a short-lived link", ignore: !enabled || !api || !userJwt }, async () => {
  const sub = JSON.parse(atob(userJwt!.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub;
  const id = crypto.randomUUID();
  const path = `${sub}/${id}/report.csv`;
  const up = await fetch(`${api}/storage/v1/object/files/${path}`, {
    method: "POST", headers: { authorization: `Bearer ${userJwt}`, apikey: anon!, "content-type": "text/csv" }, body: "a,b\n1,2\n",
  });
  assertEquals(up.status, 200, await up.text());
  const row = await fetch(`${api}/rest/v1/attachments`, {
    method: "POST", headers: { authorization: `Bearer ${userJwt}`, apikey: anon!, "content-type": "application/json" },
    body: JSON.stringify({ id, filename: "report.csv", content_type: "public.comma-separated-values-text", size: 8, storage_path: path }),
  });
  assertEquals(row.status, 201, await row.text());
  // Someone else's path is refused by RLS.
  const bad = await fetch(`${api}/rest/v1/attachments`, {
    method: "POST", headers: { authorization: `Bearer ${userJwt}`, apikey: anon!, "content-type": "application/json" },
    body: JSON.stringify({ id: crypto.randomUUID(), filename: "x", storage_path: `00000000-0000-0000-0000-000000000000/x/x` }),
  });
  assert(bad.status >= 400, "storage_path outside your folder must be refused");
  await bad.body?.cancel();

  const listed = await call("list_files", { query: "report" });
  assert(listed.data.files.some((f: { id: string }) => f.id === id));
  const got = await call("get_file", { id: `pane-file:${id}` });
  assert(!got.error, got.text);
  const bytes = await fetch(got.data.download_url).then((r) => r.text());
  assertEquals(bytes, "a,b\n1,2\n");
});

Deno.test({ name: "typed tables: read, log, validate, update by date", ignore: !enabled }, async () => {
  const body = "Mood log\n\n<!-- pane-table: Date=date; Energy=scale 1-10; Diet=choice Yes|No; Notes=text -->\n| Date | Energy | Diet | Notes |\n| --- | --- | --- | --- |\n| 2026-09-25 | 6 | No |  |\n";
  const id = (await call("create_note", { body })).data.created.id;
  const read = await call("read_table", { id });
  assertEquals(read.data.columns[1].type, "scale 1-10");
  const bad = await call("log_table_row", { id, values: { Energy: 11 } });
  assert(bad.error);
  assertStringIncludes(bad.text, "from 1 to 10");
  const added = await call("log_table_row", { id, values: { Date: "2026-09-26", Energy: 8, diet: "yes", Notes: "Walk | sun" } });
  assert(!added.error, added.text);
  const again = await call("log_table_row", { id, values: { Date: "2026-09-26", Energy: 9 } });
  assert(again.data.updated_row, "same date updates the row");
  const after = await call("read_table", { id });
  assertEquals(after.data.rows.length, 2);
  assertEquals(after.data.rows[1], { Date: "2026-09-26", Energy: "9", Diet: "Yes", Notes: "Walk | sun" });
  assert(!(await call("delete_table_row", { id, date: "2026-09-25" })).error);
  assertEquals((await call("read_table", { id })).data.total_rows, 1);
  await call("delete_note", { id });
});

Deno.test({ name: "sub-notes: create, link, read both ways", ignore: !enabled }, async () => {
  const parent = (await call("create_note", { body: "Trip\n\n## Details\nSee below." })).data.created.id;
  const made = await call("create_sub_note", { id: parent, body: "Hotel\n\nConfirmation LX-1", under_heading: "Details" });
  assert(!made.error, made.text);
  const childId = made.data.created.id;
  const p = await call("read_note", { id: parent });
  assertStringIncludes(p.data.markdown, `[Hotel](pane-note:${childId})`);
  assertEquals(p.data.sub_notes[0].id, childId);
  const c = await call("read_note", { id: childId });
  assertEquals(c.data.parent.id, parent);
  await call("delete_note", { id: parent });
  await call("delete_note", { id: childId });
});

// MARK: Protocol

async function post(body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url!, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

Deno.test({ name: "protocol: notifications get no reply, bad messages get JSON-RPC errors", ignore: !enabled }, async () => {
  assertEquals((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  assertEquals((await post({ jsonrpc: "2.0", method: "ping" })).status, 202, "a notification is never answered");
  assertEquals((await post([])).status, 400);
  assertEquals((await post("{oops")).json.error.code, -32700);
  assertEquals((await post({ jsonrpc: "2.0", id: 1 })).json.error.code, -32600);
  assertEquals((await post("42")).json.error.code, -32600);
  assertEquals((await post({ jsonrpc: "1.0", id: 2, method: "ping" })).json.error.code, -32600);
  assertEquals((await post({ jsonrpc: "2.0", id: 3, method: "nope" })).json.error.code, -32601);
  assertEquals((await post({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } })).json.error.code, -32602);
  assertEquals((await post({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "read_note", arguments: [1] } })).json.error.code, -32602);
  const batch = await post([{ jsonrpc: "2.0", id: "a", method: "ping" }, { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: "b", method: "ping" }]);
  assertEquals(batch.json.map((r: { id: string }) => r.id), ["a", "b"]);
});

Deno.test({ name: "protocol: version negotiation and the version header", ignore: !enabled }, async () => {
  for (const v of ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"]) {
    assertEquals((await post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: v, capabilities: {}, clientInfo: { name: "t", version: "1" } } })).json.result.protocolVersion, v);
  }
  const future = await post({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2099-01-01" } });
  assertEquals(future.json.result.protocolVersion, "2025-11-25", "unknown versions get the newest we speak");
  assertEquals((await post({ jsonrpc: "2.0", id: 3, method: "ping" }, { "mcp-protocol-version": "2025-06-18" })).status, 200);
  assertEquals((await post({ jsonrpc: "2.0", id: 4, method: "ping" }, { "mcp-protocol-version": "1999-01-01" })).status, 400);
});

Deno.test({ name: "protocol: every tool is well described", ignore: !enabled }, async () => {
  const { body } = await rpc("tools/list");
  for (const t of body.result.tools) {
    assert(t.title && t.description.length > 20, `${t.name} needs a title and a real description`);
    assertEquals(t.inputSchema.type, "object", t.name);
    for (const r of t.inputSchema.required ?? []) assert(r in t.inputSchema.properties, `${t.name}: required ${r} isn't a property`);
    assert(typeof t.annotations.readOnlyHint === "boolean", t.name);
  }
});

// MARK: Notes

Deno.test({ name: "titles match what the app shows", ignore: !enabled }, async () => {
  const s = crypto.randomUUID().slice(0, 6);
  for (const [body, title] of [[`- [ ] Buy_milk ${s}\nx`, `Buy_milk ${s}`], [`<u>Plan ${s}</u>\nx`, `Plan ${s}`], [`[Site ${s}](https://x.y)`, `Site ${s}`]]) {
    const c = await call("create_note", { body, folder: `Titles ${s}` });
    assertEquals(c.data.created.title, title);
    assertEquals((await call("read_note", { title })).data.id, c.data.created.id, "found by the title the app shows");
  }
  await call("delete_folder", { folder: `Titles ${s}` });
});

Deno.test({ name: "search and title lookup treat % and _ as text", ignore: !enabled }, async () => {
  const s = crypto.randomUUID().slice(0, 6);
  const c = await call("create_note", { body: `Budget 100% ${s}\nnothing else` });
  const pct = await call("search_notes", { query: `100% ${s}` });
  assert(pct.data.results.some((r: { id: string }) => r.id === c.data.created.id));
  const wild = await call("search_notes", { query: "%" });
  assert(wild.data.results.every((r: { snippet: string; title: string }) => (r.title + r.snippet).includes("%")), "% is not a wildcard");
  const near = await call("read_note", { title: "_" });
  assert(near.error);
  await call("delete_note", { id: c.data.created.id });
});

Deno.test({ name: "pinned shows in lists, search and fetch", ignore: !enabled }, async () => {
  const s = crypto.randomUUID().slice(0, 6);
  const id = (await call("create_note", { body: `Pinned ${s}\nbody`, pinned: true })).data.created.id;
  assertEquals((await call("search_notes", { query: `Pinned ${s}` })).data.results.find((r: { id: string }) => r.id === id).pinned, true);
  assertEquals((await call("fetch", { id })).data.metadata.pinned, true);
  assert((await call("list_notes", { pinned_only: true })).data.notes.some((n: { id: string }) => n.id === id));
  assert(!(await call("pin_note", { id, pinned: false })).error);
  assertEquals((await call("fetch", { id })).data.metadata.pinned, false);
  await call("delete_note", { id });
});

Deno.test({ name: "sub-notes stay out of lists, and go and come back with their parent", ignore: !enabled }, async () => {
  const s = crypto.randomUUID().slice(0, 6);
  const folder = `Subs ${s}`;
  const parent = (await call("create_note", { body: `Parent ${s}\n\n## Links`, folder })).data.created.id;
  const child = (await call("create_sub_note", { id: parent, body: `Child ${s}\nx` })).data.created.id;
  const grandchild = (await call("create_sub_note", { id: child, body: `Grandchild ${s}\ny` })).data.created.id;
  const listed = await call("list_notes", { folder });
  assertEquals(listed.data.notes.map((n: { id: string }) => n.id), [parent], "sub-notes live inside their parent, not in the list");
  const all = await call("list_notes", { folder, include_sub_notes: true });
  assertEquals(all.data.notes.length, 3);
  assertEquals(all.data.notes.find((n: { id: string }) => n.id === child).sub_note_of, parent);
  const folders = await call("list_folders");
  assertEquals(folders.data.folders.find((f: { path: string }) => f.path === folder).notes, 1);

  const del = await call("delete_note", { id: parent });
  assertEquals(del.data.sub_notes_moved, 2);
  const gone = await call("read_note", { id: grandchild });
  assert(gone.data.in_recently_deleted);
  const edit = await call("edit_note", { id: child, edits: [{ old_text: "x", new_text: "z" }] });
  assert(edit.error);
  assertStringIncludes(edit.text, "Recently Deleted");
  const back = await call("restore_note", { id: parent });
  assertEquals(back.data.sub_notes_restored, 2);
  assertEquals((await call("read_note", { id: grandchild })).data.in_recently_deleted, false);

  // Unlinked sub-notes show up in the list again, like in the app.
  await call("edit_note", { id: parent, edits: [{ old_text: `[Child ${s}](pane-note:${child})`, new_text: "" }] });
  assert((await call("list_notes", { folder })).data.notes.some((n: { id: string }) => n.id === child));
  await call("delete_folder", { folder });
});

Deno.test({ name: "sizes: limits are in bytes and explained", ignore: !enabled }, async () => {
  const big = await call("create_note", { body: "Big\n" + "é".repeat(2_600_000) }); // 5.2 MB in UTF-8
  assert(big.error);
  assertStringIncludes(big.text, "limit is 5 MB");
  const long = await call("create_folder", { path: "L".repeat(201) });
  assert(long.error);
  assertStringIncludes(long.text, "200 characters");
  const ok = await call("create_note", { body: "Large\n" + "x".repeat(1_000_000) });
  assert(!ok.error, ok.text);
  await call("delete_note", { id: ok.data.created.id });
});

Deno.test({ name: "creating the same new folder at once makes one folder", ignore: !enabled }, async () => {
  const folder = `Race ${crypto.randomUUID().slice(0, 6)}`;
  const made = await Promise.all(Array.from({ length: 6 }, (_, i) => call("create_note", { body: `Race note ${i}`, folder })));
  assert(made.every((m) => !m.error), made.map((m) => m.text).join("\n"));
  const folders = (await call("list_folders")).data.folders.filter((f: { path: string }) => f.path === folder);
  assertEquals(folders.length, 1);
  assertEquals(folders[0].notes, 6);
  await call("delete_folder", { folder });
});

Deno.test({ name: "ids: a malformed id says what an id is", ignore: !enabled }, async () => {
  const r = await call("read_note", { id: "abc" });
  assert(r.error);
  assertStringIncludes(r.text, "isn't a note id");
});

Deno.test({ name: "typed tables: Yes/No takes booleans, tables without dates append, code-block tables are ignored", ignore: !enabled }, async () => {
  const body = "Habits\n\n<!-- pane-table: Habit=text; Done=choice Yes|No -->\n| Habit | Done |\n| --- | --- |\n| Run | No |\n\n```\n<!-- pane-table: X=text -->\n| X |\n| --- |\n```\n";
  const id = (await call("create_note", { body })).data.created.id;
  const logged = await call("log_table_row", { id, values: { Habit: "Read", Done: true } });
  assert(!logged.error, logged.text);
  const t = await call("read_table", { id });
  assertEquals(t.data.rows, [{ Habit: "Run", Done: "No" }, { Habit: "Read", Done: "Yes" }]);
  const second = await call("read_table", { id, table: 1 });
  assert(second.error, "the table in the code block doesn't count");
  assertStringIncludes(second.text, "has 1 table (0-0)");
  await call("delete_note", { id });
});

// MARK: Security

const readonly = Deno.env.get("PANE_READONLY_TOKEN");
const otherWriter = Deno.env.get("PANE_OTHER_WRITE_TOKEN");
Deno.test({ name: "isolation: another user's writer token can't touch my notes with any tool", ignore: !enabled || !otherWriter }, async () => {
  const s = crypto.randomUUID().slice(0, 6);
  const mine = (await call("create_note", { body: `Secret ${s}\n- [ ] item\n\n<!-- pane-table: A=text -->\n| A |\n| --- |\n| 1 |`, folder: `Mine ${s}` })).data.created.id;
  const ref = { id: mine };
  const attempts: [string, Record<string, unknown>][] = [
    ["read_note", ref], ["fetch", ref], ["edit_note", { ...ref, edits: [{ old_text: "Secret", new_text: "Mine now" }] }],
    ["append_to_note", { ...ref, text: "x" }], ["replace_note_body", { ...ref, body: "gone" }], ["set_checklist_item", { ...ref, item: "item", checked: true }],
    ["move_note", { ...ref, folder: "Stolen" }], ["pin_note", { ...ref, pinned: true }], ["delete_note", ref], ["restore_note", ref],
    ["note_history", ref], ["restore_revision", { ...ref, revision_id: 1 }], ["create_sub_note", { ...ref, body: "x" }],
    ["read_table", ref], ["log_table_row", { ...ref, values: { A: "2" } }], ["delete_table_row", { ...ref, index: 0 }],
    ["rename_folder", { folder: `Mine ${s}`, new_name: "x" }], ["delete_folder", { folder: `Mine ${s}` }],
  ];
  for (const [name, args] of attempts) {
    const r = await call(name, args, otherWriter!);
    assert(r.error, `${name} must fail for another user`);
  }
  for (const q of [`Secret ${s}`, s]) {
    assertEquals((await call("search_notes", { query: q }, otherWriter!)).data.results.length, 0);
    assertEquals((await call("search", { query: q }, otherWriter!)).data.results.length, 0);
  }
  const overview = await call("get_overview", {}, otherWriter!);
  assert(!overview.data.folders.some((f: { path: string }) => f.path === `Mine ${s}`));
  const after = await call("read_note", ref);
  assertEquals(after.data.version, 1, "untouched");
  assertEquals(after.data.pinned, false);
  await call("delete_folder", { folder: `Mine ${s}` });
});

Deno.test({ name: "read-only tokens: write tools are hidden and refused", ignore: !enabled || !readonly }, async () => {
  const list = await rpc("tools/list", {}, readonly!);
  const names = list.body.result.tools.map((t: { name: string }) => t.name);
  assert(names.includes("read_note") && !names.some((n: string) => ["create_note", "edit_note", "delete_note", "log_table_row"].includes(n)));
  const r = await call("create_note", { body: "nope" }, readonly!);
  assert(r.error);
  assertStringIncludes(r.text, "read-only");
});

Deno.test({ name: "injection: hostile strings are just text", ignore: !enabled }, async () => {
  const evil = `x'); drop table public.notes; -- ${crypto.randomUUID().slice(0, 4)}`;
  const c = await call("create_note", { body: `${evil}\n$1 \${x} %s \\`, folder: `${evil.slice(0, 20)}` });
  assert(!c.error, c.text);
  assertEquals((await call("read_note", { title: evil })).data.markdown, `${evil}\n$1 \${x} %s \\`);
  for (const q of [evil, "') or 1=1 --", "\"unclosed", "!!!", "a & b | c"]) assert(!(await call("search_notes", { query: q })).error, q);
  await call("delete_note", { id: c.data.created.id });
});

// MARK: Security outside MCP (what the app talks to)

const otherJwt = Deno.env.get("PANE_OTHER_JWT");
function restAs(jwt: string | null) {
  const h = (extra: Record<string, string> = {}) => ({ apikey: anon!, ...(jwt ? { authorization: `Bearer ${jwt}` } : {}), "content-type": "application/json", ...extra });
  return {
    get: (path: string) => fetch(`${api}/rest/v1/${path}`, { headers: h() }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })),
    send: (method: string, path: string, body: unknown) => fetch(`${api}/rest/v1/${path}`, { method, headers: h({ prefer: "return=representation" }), body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) })),
  };
}

Deno.test({ name: "REST: another signed-in user can't read, change or adopt my rows", ignore: !enabled || !api || !userJwt || !otherJwt }, async () => {
  const s = crypto.randomUUID().slice(0, 6);
  const mine = (await call("create_note", { body: `REST secret ${s}` })).data.created.id;
  const them = restAs(otherJwt!);
  assertEquals((await them.get(`notes?id=eq.${mine}`)).json, []);
  assertEquals((await them.get(`note_revisions?note_id=eq.${mine}`)).json, []);
  assertEquals((await them.send("PATCH", `notes?id=eq.${mine}`, { body: "pwned" })).json, []);
  assertEquals((await them.send("DELETE", `notes?id=eq.${mine}`, {})).json, []);
  const aSub = JSON.parse(atob(userJwt!.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub;
  const forged = await them.send("POST", "notes", { id: crypto.randomUUID(), body: "forged", user_id: aSub });
  assert(forged.status >= 400, "can't create rows owned by someone else");
  const revision = await them.send("POST", "note_revisions", { note_id: mine, body: "x", version: 1 });
  assert(revision.status >= 400, "revisions are written by the database only");
  assertEquals((await them.get("mcp_tokens?select=id,user_id")).json.every((t: { user_id: string }) => t.user_id !== aSub), true);
  const resolve = await them.send("POST", "rpc/resolve_mcp_token", { token: token });
  assert(resolve.status >= 400, "clients can't resolve tokens");
  const allow = await them.get("signup_allowlist");
  assert(allow.status >= 400 || (Array.isArray(allow.json) && allow.json.length === 0), "the allowlist is private");
  assertEquals((await call("read_note", { id: mine })).data.version, 1);
  await call("delete_note", { id: mine });
});

Deno.test({ name: "REST: nothing is readable without signing in", ignore: !enabled || !api }, async () => {
  const nobody = restAs(null);
  for (const t of ["notes", "folders", "note_revisions", "attachments", "mcp_tokens", "signup_allowlist"]) {
    const r = await nobody.get(`${t}?limit=1`);
    assert(r.status >= 400 || (Array.isArray(r.json) && r.json.length === 0), `${t} leaked to anon: ${JSON.stringify(r.json)}`);
  }
  const mint = await nobody.send("POST", "rpc/create_mcp_token", { token_name: "x" });
  assert(mint.status >= 400, "anon can't mint tokens");
});

Deno.test({ name: "tokens: revoking cuts access at once; a revoked token can't be revived by someone else", ignore: !enabled || !api || !userJwt || !otherJwt }, async () => {
  const me = restAs(userJwt!);
  const t = await me.send("POST", "rpc/create_mcp_token", { token_name: "Revoke me", write_access: false });
  const fresh = t.json as string;
  assertEquals((await rpc("tools/list", {}, fresh)).status, 200);
  const row = (await me.get("mcp_tokens?name=eq.Revoke%20me&revoked_at=is.null&select=id")).json[0];
  assertEquals((await me.send("PATCH", `mcp_tokens?id=eq.${row.id}`, { revoked_at: new Date().toISOString() })).status, 200);
  assertEquals((await rpc("tools/list", {}, fresh)).status, 401);
  assertEquals((await restAs(otherJwt!).send("PATCH", `mcp_tokens?id=eq.${row.id}`, { revoked_at: null })).json, []);
  assertEquals((await rpc("tools/list", {}, fresh)).status, 401);
  // A token can't be upgraded to write access by editing its row.
  const upgrade = await me.send("PATCH", `mcp_tokens?id=eq.${row.id}`, { can_write: true });
  assert(upgrade.status >= 400, "can_write isn't editable");
  const rehash = await me.send("PATCH", `mcp_tokens?id=eq.${row.id}`, { token_hash: "0".repeat(64) });
  assert(rehash.status >= 400, "token_hash isn't editable");
  // Revoking is final, even for the owner.
  await me.send("PATCH", `mcp_tokens?id=eq.${row.id}`, { revoked_at: null });
  assertEquals((await rpc("tools/list", {}, fresh)).status, 401);
});

Deno.test({ name: "storage: another user can't read or overwrite my files", ignore: !enabled || !api || !userJwt || !otherJwt }, async () => {
  const sub = JSON.parse(atob(userJwt!.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).sub;
  const path = `${sub}/${crypto.randomUUID()}/secret.txt`;
  const up = await fetch(`${api}/storage/v1/object/files/${path}`, { method: "POST", headers: { authorization: `Bearer ${userJwt}`, apikey: anon!, "content-type": "text/plain" }, body: "mine" });
  assertEquals(up.status, 200, await up.text());
  const read = await fetch(`${api}/storage/v1/object/files/${path}`, { headers: { authorization: `Bearer ${otherJwt}`, apikey: anon! } });
  assert(read.status >= 400, "other user can't download");
  await read.body?.cancel();
  const write = await fetch(`${api}/storage/v1/object/files/${path}`, { method: "PUT", headers: { authorization: `Bearer ${otherJwt}`, apikey: anon!, "content-type": "text/plain", "x-upsert": "true" }, body: "theirs" });
  assert(write.status >= 400, "other user can't overwrite");
  await write.body?.cancel();
  const anonRead = await fetch(`${api}/storage/v1/object/public/files/${path}`);
  assert(anonRead.status >= 400, "the bucket isn't public");
  await anonRead.body?.cancel();
  const still = await fetch(`${api}/storage/v1/object/files/${path}`, { headers: { authorization: `Bearer ${userJwt}`, apikey: anon! } });
  assertEquals(await still.text(), "mine");
});

// The hook is config (supabase/config.toml), so a local stack started before it was added
// doesn't run it: set PANE_CHECK_SIGNUP=1 after `supabase stop && supabase start`.
Deno.test({ name: "sign-up: emails off the allowlist are refused", ignore: !enabled || !api || Deno.env.get("PANE_CHECK_SIGNUP") !== "1" }, async () => {
  const r = await fetch(`${api}/auth/v1/signup`, { method: "POST", headers: { apikey: anon!, "content-type": "application/json" }, body: JSON.stringify({ email: `stranger-${crypto.randomUUID().slice(0, 6)}@example.com`, password: "a-long-enough-password" }) });
  const body = await r.json();
  assertEquals(r.status, 403, JSON.stringify(body));
  assertStringIncludes(JSON.stringify(body), "private");
});

Deno.test({ name: "realtime: my changes reach my devices and nobody else's", ignore: !enabled || !api || !userJwt || !otherJwt, sanitizeOps: false, sanitizeResources: false }, async () => {
  const { createClient } = await import("npm:@supabase/supabase-js@2");
  const listen = async (jwt: string) => {
    const c = createClient(api!, anon!, { global: { headers: { authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } });
    c.realtime.setAuth(jwt);
    const seen: string[] = [];
    await new Promise<void>((ok, fail) => {
      c.channel("t-" + crypto.randomUUID()).on("postgres_changes", { event: "*", schema: "public", table: "notes" }, (p: { new: { id?: string } }) => { if (p.new?.id) seen.push(p.new.id); })
        .subscribe((status: string) => status === "SUBSCRIBED" ? ok() : status === "CHANNEL_ERROR" || status === "TIMED_OUT" ? fail(new Error(status)) : undefined);
    });
    return { c, seen };
  };
  const me = await listen(userJwt!);
  const them = await listen(otherJwt!);
  // "SUBSCRIBED" arrives a moment before the database side of the subscription is live.
  await new Promise((r) => setTimeout(r, 1500));
  const id = (await call("create_note", { body: `Realtime ${crypto.randomUUID().slice(0, 6)}` })).data.created.id;
  await call("append_to_note", { id, text: "more" });
  for (let i = 0; i < 50 && !me.seen.includes(id); i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 1000));
  try {
    assert(me.seen.includes(id), "my device hears about my change");
    assert(!them.seen.includes(id), "another user never does");
  } finally {
    await me.c.removeAllChannels();
    await them.c.removeAllChannels();
    await call("delete_note", { id });
  }
});

// MARK: Sync contract (what the app relies on)

Deno.test({ name: "sync: a push based on an old version changes nothing; pins don't make revisions", ignore: !enabled || !api || !userJwt }, async () => {
  const app = restAs(userJwt!);
  const id = (await call("create_note", { body: `Sync ${crypto.randomUUID().slice(0, 6)}\nv1` })).data.created.id;
  const [row] = (await app.get(`notes?id=eq.${id}&select=version,server_updated_at`)).json;
  assertEquals(row.version, 1);
  await call("append_to_note", { id, text: "from the AI" });
  // The app edited version 1 while the AI made version 2: its guarded push must match nothing.
  const stale = await app.send("PATCH", `notes?id=eq.${id}&version=eq.1`, { body: "app edit on v1" });
  assertEquals(stale.json, []);
  const fresh = await app.send("PATCH", `notes?id=eq.${id}&version=eq.2`, { body: "app edit on v2" });
  assertEquals(fresh.json[0].version, 3);
  assert(fresh.json[0].server_updated_at > row.server_updated_at, "the server clock moves on every write");
  const before = (await call("note_history", { id })).data.revisions.length;
  await call("pin_note", { id, pinned: true });
  assertEquals((await call("note_history", { id })).data.revisions.length, before, "pinning isn't a body change");
  assertEquals((await call("note_history", { id })).data.revisions[0].replaced_by, "app");
  await call("delete_note", { id });
});

Deno.test({ name: "sync: deleting forever leaves no text behind", ignore: !enabled || !api || !userJwt }, async () => {
  const app = restAs(userJwt!);
  const id = (await call("create_note", { body: "Forget me\nsecret one" })).data.created.id;
  await call("edit_note", { id, edits: [{ old_text: "secret one", new_text: "secret two" }] });
  assertEquals((await app.get(`note_revisions?note_id=eq.${id}&select=id`)).json.length, 1);
  // What the app does for Delete Forever.
  await app.send("PATCH", `notes?id=eq.${id}`, { body: "", deleted_at: new Date().toISOString() });
  assertEquals((await app.get(`note_revisions?note_id=eq.${id}&select=id`)).json, []);
  assert((await call("read_note", { id })).error, "purged notes are gone for AI tools too");
});

Deno.test({ name: "arguments: wrong types and ranges get plain explanations, not database errors", ignore: !enabled }, async () => {
  const id = (await call("create_note", { body: "Args\n## A\nx" })).data.created.id;
  for (const [name, args, says] of [
    ["restore_revision", { id, revision_id: "abc" }, "revision_id must be a whole number"],
    ["edit_note", { id, edits: [{ old_text: "x", new_text: "y" }], expected_version: "v2" }, "expected_version must be a whole number"],
    ["read_note", { id, start_line: 50 }, "past the end: the note has 3 lines"],
    ["read_note", { id, start_line: 3, end_line: 1 }, "end_line must be at or after"],
    ["read_note", { title: "y".repeat(5000) }, "…"],
  ] as [string, Record<string, unknown>, string][]) {
    const r = await call(name, args);
    assert(r.error, name);
    assertStringIncludes(r.text, says);
    assert(!/syntax|violates|relation|column/i.test(r.text), `database error leaked: ${r.text}`);
    assert(r.text.length < 400, "errors stay short");
  }
  assertEquals((await call("read_note", { id, start_line: 2, end_line: 99 })).data.markdown, "## A\nx");
  assertEquals((await call("edit_note", { id, edits: [{ old_text: "x", new_text: "y" }], expected_version: "1" })).error, false, "a numeric string is fine");
  await call("delete_note", { id });
});

Deno.test({ name: "tables: plain grid tables can be read and added to; trackers stay the default", ignore: !enabled }, async () => {
  const body = "Mixed\n\n| Shortcut | Does |\n| --- | --- |\n| ⌘B | Bold |\n\n<!-- pane-table: Date=date; Energy=scale 1-10 -->\n| Date | Energy |\n| --- | --- |\n| 2026-09-27 | 5 |\n";
  const id = (await call("create_note", { body })).data.created.id;
  assertEquals((await call("read_table", { id })).data.columns[1].type, "scale 1-10", "default is the tracker");
  const plain = await call("read_table", { id, table: 0 });
  assertEquals(plain.data.rows, [{ Shortcut: "⌘B", Does: "Bold" }]);
  assert(!(await call("log_table_row", { id, table: 0, values: { Shortcut: "⌘I", Does: "Italic" } })).error);
  const md = (await call("read_note", { id })).data.markdown;
  assertStringIncludes(md, "| ⌘I | Italic |");
  assert(!md.includes("pane-table: Shortcut"), "a plain table stays plain");
  const bad = await call("read_table", { id, table: 5 });
  assert(bad.error);
  assertStringIncludes(bad.text, "has 2 tables");
  await call("delete_note", { id });
});
