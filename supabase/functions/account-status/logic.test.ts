import { assertEquals, assert } from "jsr:@std/assert@1";
import { atLeast, hashKey, normalizeEmail, RateLimiter, statusFrom } from "./logic.ts";

Deno.test("emails are trimmed, lower-cased and checked", () => {
  assertEquals(normalizeEmail("  Emil@Example.COM "), "emil@example.com");
  assertEquals(normalizeEmail("no-at-sign"), null);
  assertEquals(normalizeEmail("a@b"), null);
  assertEquals(normalizeEmail(42), null);
  assertEquals(normalizeEmail("x".repeat(250) + "@a.se"), null);
});

Deno.test("the reply is two booleans and nothing else", () => {
  assertEquals(statusFrom(undefined), { exists: false, password: false });
  assertEquals(statusFrom({ exists: true, has_password: true }), { exists: true, password: true });
  assertEquals(statusFrom({ exists: true, has_password: false }), { exists: true, password: false });
  assertEquals(Object.keys(statusFrom({ exists: true, has_password: true })).sort(), ["exists", "password"]);
});

Deno.test("the limiter allows the limit, then refuses until the window resets", () => {
  const l = new RateLimiter(2, 1000);
  assert(l.allow("k", 0)); assert(l.allow("k", 1)); assert(!l.allow("k", 2));
  assert(l.allow("other", 2));
  assert(l.allow("k", 1001));
});

Deno.test("limiter keys are salted hashes, never the raw value", async () => {
  const a = await hashKey("salt", "1.2.3.4");
  assertEquals(a.length, 64);
  assert(!a.includes("1.2.3.4"));
  assert(a !== await hashKey("other-salt", "1.2.3.4"));
});

Deno.test("every reply takes at least the floor", async () => {
  const t0 = performance.now();
  await atLeast(60, async () => 1);
  assert(performance.now() - t0 >= 55);
});
