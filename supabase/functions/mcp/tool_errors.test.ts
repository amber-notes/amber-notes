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

Deno.test("the file tools' failures get kinds too", () => {
  assertEquals(toolErrorKind(`old_string isn't in Work/Plan.md. Fetch it again and copy the exact text.`), "old_text_not_found");
  assertEquals(toolErrorKind(`old_string is in Work/Plan.md 3 times. Add more of the surrounding text so it matches once.`), "old_text_repeated");
  assertEquals(toolErrorKind("old_string and new_string are the same: nothing to change."), "bad_edits");
  assertEquals(toolErrorKind("Work/Plan.md changed since you read it. Fetch it again, then make the change."), "version_conflict");
  assertEquals(toolErrorKind("Read Work/Plan.md with fetch before changing it."), "not_read_first");
  assertEquals(toolErrorKind(`Nothing at "Work/Plna.md". Use list or search to find it.`), "path_not_found");
  assertEquals(toolErrorKind(`"Work/Plan.md" already exists. Read it, then change it with edit or write.`), "already_exists");
  assertEquals(toolErrorKind("To read/Paper.pdf isn't text: edit changes text files."), "not_text");
  assertEquals(toolErrorKind(`"Work/Plan.md" is in Recently Deleted. Bring it back with restore first.`), "in_trash");
});
