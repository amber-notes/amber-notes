import { assertEquals } from "@std/assert";
import { conflictPath, isSyncable, localPathFor, retitle, withTitle } from "./paths.ts";

Deno.test("only markdown outside hidden and app folders is synced", () => {
  assertEquals(["Work/Acme.md", "Acme.MD", "a/b/c.md"].map(isSyncable), [true, true, true]);
  assertEquals([".amber/state.json", ".obsidian/x.md", "Work/.trash/a.md", "Work/Habits.app/README.md", "notes.txt", ".hidden.md"].map(isSyncable), [false, false, false, false, false, false]);
});

Deno.test("a note keeps its remote path on disk unless another note has it", () => {
  const taken = new Set(["work/acme.md"]);
  assertEquals(localPathFor("Work/Other.md", "1234567890", (p) => taken.has(p)), "Work/Other.md");
  assertEquals(localPathFor("Work/ACME.md", "1234567890", (p) => taken.has(p)), "Work/ACME (12345678).md");
});

Deno.test("conflict copies are named like Dropbox and Obsidian Sync, numbered when needed", () => {
  const have = new Set<string>();
  assertEquals(conflictPath("Work/Acme.md", "2026-10-06", (p) => have.has(p)), "Work/Acme (conflict 2026-10-06).md");
  have.add("work/acme (conflict 2026-10-06).md");
  assertEquals(conflictPath("Work/Acme.md", "2026-10-06", (p) => have.has(p)), "Work/Acme (conflict 2026-10-06 2).md");
});

Deno.test("the first line is the title", () => {
  assertEquals(retitle("# Acme\n\nbody", "Acme (conflict 2026-10-06)"), "# Acme (conflict 2026-10-06)\n\nbody");
  assertEquals(retitle("\nAcme\nbody", "B"), "\nB\nbody");
  assertEquals(withTitle("Ideas", "Ideas\n\n- one"), "Ideas\n\n- one");
  assertEquals(withTitle("Ideas", "# Ideas\n- one"), "# Ideas\n- one");
  assertEquals(withTitle("Ideas", "- one\n- two"), "Ideas\n\n- one\n- two");
  assertEquals(withTitle("Ideas", "See [[Recipes]]"), "Ideas\n\nSee [[Recipes]]");
});
