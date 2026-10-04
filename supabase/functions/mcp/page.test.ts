// What set_note_page accepts as a page (page.ts).
//   cd supabase/functions/mcp && deno test -A page.test.ts
import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { MAX_PAGE_BYTES, pageProblems } from "./page.ts";

const page = (inner: string) => `<!doctype html><html><head><style>body{margin:0}</style></head><body>${inner}<script>render(amber.note)</script></body></html>`;

Deno.test("a self-contained page that reads amber.note passes", () => {
  assertEquals(pageProblems(page(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg><img src="data:image/png;base64,AAAA">`)), []);
});

Deno.test("external addresses, protocol-relative ones and imports are refused", () => {
  assertStringIncludes(pageProblems(page(`<img src="https://example.com/x.png">`)).join(), "External addresses");
  assertStringIncludes(pageProblems(page(`<script src="//cdn.example/x.js"></script>`)).join(), "Protocol-relative");
  assertStringIncludes(pageProblems(page(`<style>@import "x.css";</style>`)).join(), "@import");
  assertStringIncludes(pageProblems(page(`<div style="background:url(//e.example/a.png)"></div>`)).join(), "Protocol-relative");
  assertStringIncludes(pageProblems(page(`<a href="wss://e.example">x</a>`)).join(), "wss://e.example");
});

Deno.test("tags that load or frame other documents are refused", () => {
  assertStringIncludes(pageProblems(page(`<link rel="stylesheet" href="a.css"><iframe></iframe>`)).join(), "<link>, <iframe>");
  assertStringIncludes(pageProblems(page(`<base href="/">`)).join(), "<base>");
  assertStringIncludes(pageProblems(`<meta http-equiv="refresh" content="0;url=x"><div></div><script>amber.note</script>`).join(), "meta refresh");
});

Deno.test("network calls in the script are refused, by name", () => {
  const p = pageProblems(page(`<script>fetch("/x"); new WebSocket("x"); navigator.sendBeacon("x"); window.open("x")</script>`)).join();
  assertStringIncludes(p, "fetch, WebSocket, sendBeacon, window.open");
  // Words in the page's text are fine.
  assertEquals(pageProblems(page(`<p>Fetch the paper. A worker bee.</p>`)), []);
});

Deno.test("a page must read the note, and stay under the size cap", () => {
  assertStringIncludes(pageProblems(`<div>Mon ✓ Tue ✓</div>`).join(), "window.amber.note");
  assertStringIncludes(pageProblems(page("x".repeat(MAX_PAGE_BYTES))).join(), "the limit is 256 KB");
  assertStringIncludes(pageProblems("just text, amber.note").join(), "doesn't look like an HTML page");
});
