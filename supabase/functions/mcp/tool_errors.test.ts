import { assertEquals } from "jsr:@std/assert@1";
import { applyEdits } from "./notes.ts";
import { toolErrorKind } from "./tool_errors.ts";

function editError(body: string, edits: { old_text: string; new_text: string }[]): string {
  try {
    applyEdits(body, edits);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error("expected the edit to fail");
}

Deno.test("edit_note's own failures each get their kind", () => {
  assertEquals(toolErrorKind(editError("a b", [{ old_text: "c", new_text: "d" }])), "old_text_not_found");
  assertEquals(toolErrorKind(editError("a a", [{ old_text: "a", new_text: "d" }])), "old_text_repeated");
  assertEquals(toolErrorKind(editError("a", [{ old_text: "", new_text: "d" }])), "bad_edits");
  assertEquals(toolErrorKind("The note changed since version 4. Read it again and retry."), "version_conflict");
});

Deno.test("finding the note, keys and limits", () => {
  assertEquals(toolErrorKind(`2 notes are titled "Plan": a, b. Use an id.`), "ambiguous_title");
  assertEquals(toolErrorKind(`No note titled "Plan". Try search_notes.`), "note_not_found");
  assertEquals(toolErrorKind("No note with id 3f2b."), "note_not_found");
  assertEquals(toolErrorKind("This note can't be opened with this connection's key. Connect again."), "key_mismatch");
  assertEquals(toolErrorKind(`"Diary": This note is locked. Its text is encrypted.`), "locked");
  assertEquals(toolErrorKind("This access token is read-only."), "read_only");
  assertEquals(toolErrorKind("Your AI has searched a lot in the last minute. Try again shortly."), "rate_limited");
  assertEquals(toolErrorKind("Something new"), "other");
});
