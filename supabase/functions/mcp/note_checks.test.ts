// The checks edit and write return after a note changes.
//   cd supabase/functions/mcp && deno test note_checks.test.ts
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { noteChecks } from "./note_checks.ts";

const T = "Mood\n\n<!-- pane-table: Date=date; Mood=scale 1-5; Walk=choice Yes|No -->\n| Date | Mood | Walk |\n| --- | --- | --- |\n| 2026-10-01 | 3 | Yes |\n\n- [ ] Call mum\n";

Deno.test("good changes say nothing; only new breakage is reported", () => {
  assertEquals(noteChecks(T, T.replace("| 2026-10-01 | 3 | Yes |", "| 2026-10-01 | 3 | Yes |\n| 2026-10-02 | 4 | No |").replace("- [ ] Call mum", "- [x] Call mum"), "2026-10-06"), []);
  const old = "Old\n| a |\nnot a table\n";
  assertEquals(noteChecks(old, old + "more\n", "2026-10-06"), []);
});

Deno.test("tracker values, ragged rows, broken tables and checklist lines are caught", () => {
  const all = (after: string) => noteChecks(T, after, "2026-10-06").join("\n");
  assertStringIncludes(all(T.replace("| 2026-10-01 | 3 | Yes |", "| 2026-10-01 | 9 | Yes |")), "from 1 to 5");
  assertStringIncludes(all(T.replace("| 2026-10-01 | 3 | Yes |", "| 2026-10-01 | 3 | Maybe |")), "one of Yes, No");
  assertStringIncludes(all(T.replace("| 2026-10-01 | 3 | Yes |", "| 2026-10-01 | 3 |")), "has 2 cells");
  assertStringIncludes(all(T.replace("| --- | --- | --- |\n", "")), "isn't in a table");
  assertStringIncludes(all(T.replace("- [ ] Call mum", "-[ ] Call mum")), "won't show as a checklist item");
});
