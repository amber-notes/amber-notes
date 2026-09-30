// What Claude's and ChatGPT's directory reviews check on every tool: deno test annotations.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { tools } from "./tools.ts";

Deno.test("every tool has a title and all three hints as explicit booleans", () => {
  for (const t of tools) {
    assert(t.title.trim(), `${t.name} has no title`);
    for (const hint of ["readOnlyHint", "destructiveHint", "openWorldHint"] as const) {
      assertEquals(typeof t.annotations[hint], "boolean", `${t.name}.${hint}`);
    }
    if (t.annotations.readOnlyHint) assertEquals(t.annotations.destructiveHint, false, `${t.name} reads but is marked destructive`);
  }
});

Deno.test("tools that overwrite or remove content are destructive", () => {
  const destructive = tools.filter((t) => t.annotations.destructiveHint).map((t) => t.name).sort();
  assertEquals(destructive, [
    "delete_folder", "delete_note", "delete_table_row", "edit_note", "log_table_row", "replace_note_body", "restore_revision",
  ]);
});

Deno.test("names are unique, short and snake_case", () => {
  assertEquals(new Set(tools.map((t) => t.name)).size, tools.length);
  for (const t of tools) assert(/^[a-z][a-z_]{0,63}$/.test(t.name), t.name);
});

Deno.test("each tool names the OAuth scope it needs", () => {
  for (const t of tools) {
    assertEquals(t.securitySchemes, [{ type: "oauth2", scopes: [t.annotations.readOnlyHint ? "notes:read" : "notes:write"] }], t.name);
  }
});
