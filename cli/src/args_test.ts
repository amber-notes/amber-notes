import { assertEquals } from "@std/assert";
import { parse } from "./args.ts";

Deno.test("note text that looks like a flag stays an argument", () => {
  assertEquals(parse(["edit", "Groceries.md", "- [ ] Milk", "- [x] Milk", "--json"]), { _: ["edit", "Groceries.md", "- [ ] Milk", "- [x] Milk"], json: true });
  assertEquals(parse(["edit", "a.md", "-1", "-2"])._, ["edit", "a.md", "-1", "-2"]);
  assertEquals(parse(["create", "Work", "--", "--json is text here"])._, ["create", "Work", "--json is text here"]);
});

Deno.test("options take a value, inline or next", () => {
  assertEquals(parse(["read", "a.md", "--offset", "40", "--server=http://x"]), { _: ["read", "a.md"], offset: "40", server: "http://x" });
  assertEquals(parse(["grep", "x", "-C", "2"]), { _: ["grep", "x"], C: "2" });
  assertEquals(parse(["-h"]), { _: [], help: true });
});
