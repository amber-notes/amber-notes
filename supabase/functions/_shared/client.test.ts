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

Deno.test("a relay or the site's proxy can state the caller's address, only with the shared secret", () => {
  const env = (secret?: string) => ({ get: (k: string) => (k === "MCP_PROXY_SECRET" ? secret : undefined) });
  const r = (headers: Record<string, string>) => new Request("https://example.test/", { headers });
  const stated = { "cf-connecting-ip": "52.0.0.1", "x-mcp-client-ip": "198.51.100.7" };
  assertEquals(clientAddress(r({ ...stated, "x-mcp-proxy-secret": "s3cret" }), env("s3cret")), "198.51.100.7");
  assertEquals(clientAddress(r({ ...stated, "x-mcp-proxy-secret": "guess" }), env("s3cret")), "52.0.0.1");
  assertEquals(clientAddress(r(stated), env("s3cret")), "52.0.0.1");
  // No secret configured: nobody can state anything.
  assertEquals(clientAddress(r({ ...stated, "x-mcp-proxy-secret": "" }), env(undefined)), "52.0.0.1");
  assertEquals(clientAddress(r({ ...stated, "x-mcp-proxy-secret": "" }), env("")), "52.0.0.1");
});
