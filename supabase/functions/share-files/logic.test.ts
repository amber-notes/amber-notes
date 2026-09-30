// Pure pieces of share-files: deno test supabase/functions/share-files/logic.test.ts
import { assert, assertEquals } from "jsr:@std/assert@1";
import { contentDisposition, filePath, RateLimiter, referencedFiles, servedType } from "./logic.ts";

const ID = "3f1c2b9a-1b7e-4c3a-9f0e-2a4b8c1d7e55";
const SLUG = "abcdefghijklmnopqrstuvwx";

Deno.test("the files a page embeds", () => {
  assertEquals(referencedFiles(`x\n![a.png](pane-file:${ID.toUpperCase()})\n[b](pane-file:${ID})\n[c](https://x)`), [ID]);
});

Deno.test("a file's address, relative to the Supabase URL", () => {
  assertEquals(filePath(SLUG, ID.toUpperCase()), `/functions/v1/share-files?slug=${SLUG}&file=${ID}`);
  const sub = "0b8f4a52-6a57-4b43-8d3c-5b2f8f1f9e10";
  assertEquals(filePath(SLUG, ID, sub), `/functions/v1/share-files?slug=${SLUG}&file=${ID}&sub=${sub}`);
});

Deno.test("shown in place only when a browser can't run it", () => {
  assertEquals(servedType("image/png", "a.png"), { type: "image/png", inline: true });
  assertEquals(servedType("public.jpeg", "a.jpg"), { type: "image/jpeg", inline: true });
  assertEquals(servedType("public.data", "trip.pdf"), { type: "application/pdf", inline: true });
  assertEquals(servedType("public.plain-text", "a.txt"), { type: "text/plain; charset=utf-8", inline: true });
  for (const [type, name] of [["text/html", "a.html"], ["image/svg+xml", "a.svg"], ["public.html", "a.html"], ["public.data", "x.js"], ["", "noext"]]) {
    assertEquals(servedType(type, name), { type: "application/octet-stream", inline: false }, `${type} ${name}`);
  }
});

Deno.test("a file name in the header can't break out of it", () => {
  assertEquals(contentDisposition("shown.png", true), `inline; filename="shown.png"; filename*=UTF-8''shown.png`);
  const d = contentDisposition('evil"; filename=x.html\r\nset-cookie: a=b.png', true);
  assert(!/[\r\n]/.test(d));
  assert(d.startsWith('inline; filename="evil__ filename=x.htmlset-cookie: a=b.png"; '), d);
  assertEquals(contentDisposition("Kvitto \u00e5\u00e4\u00f6.pdf", false), `attachment; filename="Kvitto aao.pdf"; filename*=UTF-8''Kvitto%20%C3%A5%C3%A4%C3%B6.pdf`);
  assertEquals(contentDisposition("", true), `inline; filename="file"; filename*=UTF-8''file`);
});

Deno.test("the per-address limit", () => {
  const rl = new RateLimiter(2, 1000);
  assert(rl.allow("ip", 0) && rl.allow("ip", 1));
  assert(!rl.allow("ip", 2));
  assert(rl.allow("ip", 1001));
});
