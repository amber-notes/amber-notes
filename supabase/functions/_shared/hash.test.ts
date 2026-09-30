import { assertEquals, assertMatch, assertNotEquals } from "jsr:@std/assert@1";
import { dailyHash } from "./hash.ts";

Deno.test("an address hashes the same within a day, differently across days and keys", async () => {
  const day = new Date("2026-09-30T08:00:00Z"), later = new Date("2026-09-30T23:59:00Z"), next = new Date("2026-10-01T00:01:00Z");
  const a = await dailyHash("k", "203.0.113.9", day);
  assertMatch(a, /^[0-9a-f]{64}$/);
  assertEquals(await dailyHash("k", "203.0.113.9", later), a);
  assertNotEquals(await dailyHash("k", "203.0.113.9", next), a);
  assertNotEquals(await dailyHash("other", "203.0.113.9", day), a);
  assertNotEquals(await dailyHash("k", "203.0.113.10", day), a);
});
