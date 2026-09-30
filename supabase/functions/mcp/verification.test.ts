// deno test verification.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { openaiChallenge } from "./verification.ts";

Deno.test("the challenge answers with the bare token", async () => {
  const res = openaiChallenge("  tok_abc123\n");
  assertEquals(res.status, 200);
  assertEquals(res.headers.get("content-type"), "text/plain; charset=utf-8");
  assertEquals(await res.text(), "tok_abc123");
});

Deno.test("without a token set there is nothing to verify", async () => {
  for (const t of [undefined, "", "  "]) {
    const res = openaiChallenge(t);
    assertEquals(res.status, 404);
    await res.body?.cancel();
  }
});
