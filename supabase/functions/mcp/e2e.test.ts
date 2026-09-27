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

async function call(name: string, args: Record<string, unknown> = {}) {
  const { body } = await rpc("tools/call", { name, arguments: args });
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
  assertEquals(init.body.result.serverInfo.name, "pane");
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
  assertStringIncludes(after.data.markdown, "- [x] Passport\n- [ ] Charger\n- [ ] Sunscreen\n\n## Plan");
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
