// deno test log.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { errorKind, line, log } from "./log.ts";

Deno.test("only allowlisted fields with primitive values come out", () => {
  const out = JSON.parse(line("tool", {
    tool: "search_notes", status: "error", ms: 12.345, count: 3,
    body: "secret note text", title: "Bank", query: "PIN", message: "boom", path: "/mcp/pane_abc",
    code: { nested: "object" }, kind: ["array"], path_kind: null,
  }));
  assertEquals(out, { event: "tool", tool: "search_notes", status: "error", ms: 12.3, count: 3 });
});

Deno.test("long strings are cut and control characters can't start another line", () => {
  const out = line("x".repeat(500), { tool: "a\nb" + "y".repeat(500) });
  assert(!out.includes("\n"));
  const parsed = JSON.parse(out);
  assert(parsed.event.length <= 64);
  assert(parsed.tool.length <= 64);
  assert(parsed.tool.startsWith("a?b"));
});

Deno.test("an exception is its class and SQL code, never its message", () => {
  const e = Object.assign(new TypeError("note text: my diary"), { code: "42501" });
  assertEquals(errorKind(e), { kind: "TypeError", code: "42501" });
  assertEquals(errorKind(Object.assign(new Error("x"), { code: "my diary" })), { kind: "Error" });
  assertEquals(errorKind("a string"), { kind: "string" });
});

Deno.test("log writes one JSON line to the console", () => {
  const seen: unknown[][] = [];
  const real = console.log;
  console.log = (...a: unknown[]) => seen.push(a);
  try {
    log("path_refused", { path_kind: "token", path: "/mcp/pane_" + "a".repeat(64) });
  } finally {
    console.log = real;
  }
  assertEquals(seen.length, 1);
  assertEquals(JSON.parse(String(seen[0][0])), { event: "path_refused", path_kind: "token" });
});
