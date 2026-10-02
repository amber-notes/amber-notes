import { assertEquals } from "jsr:@std/assert@1";
import { clientAddress } from "./client.ts";

const from = (headers: Record<string, string>) => clientAddress(new Request("https://example.test/", { headers }));

Deno.test("the caller's address is Cloudflare's, never the x-forwarded-for entry the caller chose", () => {
  assertEquals(from({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": "203.0.113.9, 198.51.100.7" }), "198.51.100.7");
  // A caller sending a new made-up address each time stays one caller.
  for (const made of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) assertEquals(from({ "cf-connecting-ip": "198.51.100.7", "x-forwarded-for": `${made}, 198.51.100.7` }), "198.51.100.7");
  // Without Cloudflare: the entry the nearest proxy added, not the first.
  assertEquals(from({ "x-forwarded-for": "203.0.113.9, 198.51.100.7" }), "198.51.100.7");
  assertEquals(from({ "x-forwarded-for": "198.51.100.7" }), "198.51.100.7");
  assertEquals(from({}), "unknown");
  assertEquals(from({ "x-forwarded-for": " " }), "unknown");
});
