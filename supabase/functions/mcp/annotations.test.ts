// What Claude's and ChatGPT's directory reviews check on every tool: deno test annotations.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { tools } from "./tools.ts";

Deno.test("every tool has a title, also in annotations, and all three hints as explicit booleans", () => {
  for (const t of tools) {
    assert(t.title.trim(), `${t.name} has no title`);
    assertEquals(t.annotations.title, t.title, `${t.name}.annotations.title`);
    for (const hint of ["readOnlyHint", "destructiveHint", "openWorldHint"] as const) {
      assertEquals(typeof t.annotations[hint], "boolean", `${t.name}.${hint}`);
    }
    if (t.annotations.readOnlyHint) assertEquals(t.annotations.destructiveHint, false, `${t.name} reads but is marked destructive`);
  }
});

Deno.test("tools that change or remove anything already there are destructive", () => {
  const destructive = tools.filter((t) => t.annotations.destructiveHint).map((t) => t.name).sort();
  assertEquals(destructive, [
    "create_app", "delete_app_file", "delete_folder", "delete_note", "delete_table_row", "delete_table_rows", "edit_app_file", "edit_note", "edit_note_page", "edit_table_columns", "log_table_row",
    "move_app_file", "move_note", "pin_note", "rename_folder", "replace_note_body", "restore_revision", "set_checklist_item", "set_note_page",
    "update_checklist_items", "update_page_data", "update_table_rows", "write_app_file",
  ]);
});

Deno.test("only tools that just add are non-destructive writes", () => {
  const additive = tools.filter((t) => !t.annotations.readOnlyHint && !t.annotations.destructiveHint).map((t) => t.name).sort();
  assertEquals(additive, ["add_checklist_items", "add_table_rows", "append_to_note", "create_folder", "create_note", "create_sub_note", "restore_note"]);
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
