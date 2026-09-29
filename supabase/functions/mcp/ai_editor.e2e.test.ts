// Which AI last changed a note (notes.ai_editor, ai_edited_at): set by an AI's edit, kept by
// everything else. Runs against the LOCAL stack: scripts/mcp-e2e.sh ai_editor.e2e.test.ts
import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1";

const api = Deno.env.get("PANE_API");
const anon = Deno.env.get("PANE_ANON");
const me = Deno.env.get("PANE_USER_JWT");
const mcp = Deno.env.get("PANE_MCP_URL");
const token = Deno.env.get("PANE_TOKEN"); // named "Claude Code (test)" by scripts/dev-user.ts
const enabled = Boolean(api && anon && me && mcp && token && /127\.0\.0\.1/.test(api ?? ""));

async function rest(method: string, path: string, body?: unknown) {
  const res = await fetch(`${api}/rest/v1/${path}`, {
    method,
    headers: { authorization: `Bearer ${me}`, apikey: anon!, "content-type": "application/json", prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

async function tool(name: string, args: Record<string, unknown>) {
  const res = await fetch(mcp!, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const r = (await res.json()).result;
  assert(r && !r.isError, JSON.stringify(r));
  return r.structuredContent;
}

type Row = { body: string; ai_editor: string | null; ai_edited_at: string | null };
const row = async (id: string) => (await rest("GET", `notes?id=eq.${id}&select=body,ai_editor,ai_edited_at`)).json[0] as Row;

Deno.test({ name: "ai editor: an AI's edit names it; the app's edits keep it and can't forge it", ignore: !enabled }, async () => {
  const id = crypto.randomUUID();
  assertEquals((await rest("POST", "notes", { id, body: "Groceries\n\n- [ ] Oat milk" })).status, 201);
  assertEquals((await row(id)).ai_editor, null, "a note made in the app has no AI editor");

  await tool("append_to_note", { id, text: "- [ ] Saffron" });
  const ai = await row(id);
  assertEquals(ai.ai_editor, "Claude Code (test)");
  assert(ai.ai_edited_at);

  // Pinning changes no text: not an edit to show.
  await tool("pin_note", { id, pinned: true });
  assertEquals((await row(id)).ai_edited_at, ai.ai_edited_at);

  // You edit it in the app, then try to write the columns yourself.
  await rest("PATCH", `notes?id=eq.${id}`, { body: ai.body + "\n- [ ] Lemons" });
  await rest("PATCH", `notes?id=eq.${id}`, { ai_editor: "Forged", ai_edited_at: "2000-01-01T00:00:00Z" });
  const app = await row(id);
  assert(app.body.endsWith("Lemons"));
  assertEquals(app.ai_editor, "Claude Code (test)");
  assertEquals(app.ai_edited_at, ai.ai_edited_at);

  // Another AI edit moves the time on.
  await tool("append_to_note", { id, text: "- [ ] Chorizo" });
  assertNotEquals((await row(id)).ai_edited_at, ai.ai_edited_at);
});

Deno.test({ name: "ai editor: a note an AI creates, and a version it restores, name it too", ignore: !enabled }, async () => {
  const created = await tool("create_note", { body: `Made by an AI ${crypto.randomUUID().slice(0, 8)}` });
  const id = created.created.id as string;
  assertEquals((await row(id)).ai_editor, "Claude Code (test)");

  const inserted = await rest("POST", "notes", { id: crypto.randomUUID(), body: "Mine", ai_editor: "Forged", ai_edited_at: "2000-01-01T00:00:00Z" });
  assertEquals(inserted.json[0].ai_editor, null, "the app can't make a note look like an AI's");

  const other = crypto.randomUUID();
  await rest("POST", "notes", { id: other, body: "Plan\n\nOne" });
  await rest("PATCH", `notes?id=eq.${other}`, { body: "Plan\n\nTwo" });
  const history = await tool("note_history", { id: other });
  await tool("restore_revision", { id: other, revision_id: history.revisions[0].revision_id });
  const restored = await row(other);
  assertEquals(restored.body, "Plan\n\nOne");
  assertEquals(restored.ai_editor, "Claude Code (test)");
});
