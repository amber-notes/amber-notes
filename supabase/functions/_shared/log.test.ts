import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { scrub } from "./log.ts";

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
