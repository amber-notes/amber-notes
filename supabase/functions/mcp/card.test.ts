// deno test card.test.ts
import { assertEquals } from "jsr:@std/assert@1";
import { serverCard, serverCardResponse } from "./card.ts";
import { servedTools } from "./tools.ts";

Deno.test("the server card lists every tool the server serves, as it serves it", () => {
  const card = serverCard();
  assertEquals(card.serverInfo.name, "amber-notes");
  assertEquals(card.authentication, { required: true, schemes: ["oauth2"] });
  const tools = servedTools();
  assertEquals(card.tools.map((t) => t.name), tools.map((t) => t.name));
  for (const [i, t] of card.tools.entries()) {
    assertEquals(t.description, tools[i].description);
    assertEquals(t.inputSchema, tools[i].inputSchema);
    assertEquals(t.annotations, tools[i].annotations);
  }
});

Deno.test("the card is public JSON", async () => {
  const res = serverCardResponse();
  assertEquals(res.headers.get("content-type"), "application/json");
  assertEquals(res.headers.get("access-control-allow-origin"), "*");
  assertEquals((await res.json()).tools.length, servedTools().length);
});
