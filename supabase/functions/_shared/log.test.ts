// deno test log.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { errorKind, line, log, logError, scrub } from "./log.ts";

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

Deno.test("logError is the place and the error's kind, never its message", () => {
  const seen: unknown[][] = [];
  const real = console.log;
  console.log = (...a: unknown[]) => seen.push(a);
  try {
    logError("account export", Object.assign(new Error("no account for sara@example.com"), { code: "P0002" }));
  } finally {
    console.log = real;
  }
  assertEquals(JSON.parse(String(seen[0][0])), { event: "error", where: "account export", kind: "Error", code: "P0002" });
});

Deno.test("scrub keeps the kind of error and drops who and what", () => {
  const cases: [unknown, string[], string[]][] = [
    [new Error('invalid input syntax for type uuid: "not-a-uuid"'), ["invalid input syntax for type uuid"], ["not-a-uuid"]],
    [Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" }), ["23505", "duplicate key"], []],
    [new Error("Key (user_id)=(0b4f1c2e-1111-2222-3333-444455556666) is not present"), ["Key (user_id)"], ["0b4f1c2e"]],
    [new Error("no account for sara@example.com from 203.0.113.9"), ["no account for"], ["sara@example.com", "203.0.113.9"]],
    [new Error("rejected Bearer eyJhbGciOiJIUzI1NiJ9.abc.def and 2001:db8::1"), ["rejected"], ["eyJhbGci", "2001:db8"]],
    [new Error("token 3q2-7Yd_kLmN0pQrStUvWxYz1234567890 expired"), ["token", "expired"], ["3q2-7Yd"]],
    ["storage delete failed: 500", ["storage delete failed: 500"], []],
  ];
  for (const [e, keep, drop] of cases) {
    const out = scrub(e);
    for (const k of keep) assertStringIncludes(out, k);
    for (const d of drop) assertEquals(out.includes(d), false, `${out} still has ${d}`);
  }
});

Deno.test("scrub caps the length", () => {
  assertEquals(scrub(new Error("x ".repeat(500))).length <= 200, true);
});
