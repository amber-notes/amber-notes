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

import { MAX_PAGE_DATA_BYTES, pageDataProblems, pageDataView } from "./page.ts";

Deno.test("page data is an object of values and collections of records with unique ids, under 4 MB", () => {
  assertEquals(pageDataProblems({ values: { a: [1, { b: null }] }, collections: { runs: [{ id: "1", km: 5 }, { id: "2" }] } }), []);
  assertStringIncludes(pageDataProblems([]).join(), "one JSON object");
  assertStringIncludes(pageDataProblems({ rows: [] }).join(), "Unknown top-level key \"rows\"");
  assertStringIncludes(pageDataProblems({ collections: { runs: [{ km: 5 }] } }).join(), "needs a string \"id\"");
  assertStringIncludes(pageDataProblems({ collections: { runs: [{ id: "1" }, { id: "1" }] } }).join(), "two records with id \"1\"");
  assertStringIncludes(pageDataProblems({ values: { big: "x".repeat(MAX_PAGE_DATA_BYTES) } }).join(), "the limit is 4 MB");
  assertEquals(pageDataView(null).data, { values: {}, collections: {} });
  const big = JSON.stringify({ values: { a: "x".repeat(70_000) }, collections: { runs: [{ id: "1" }] } });
  assertEquals(pageDataView(big).data_outline, { values: ["a"], collections: { runs: 1 } });
});

Deno.test("declared hosts may appear for amber.fetch; the page's own fetch still may not", () => {
  const needs = `<meta name="amber-needs" content='{"hosts":["api.open-meteo.com"],"keys":[{"name":"OW","hosts":["api.openweathermap.org"]}]}'>`;
  const p = (s: string) => pageProblems(needs + page(`<script>${s}</script>`));
  assertEquals(p(`amber.fetch("https://api.open-meteo.com/v1/forecast?latitude=1")`), []);
  assertEquals(p(`amber.fetch("https://api.openweathermap.org/data/2.5/weather", { key: "OW" })`), []);
  assertStringIncludes(p(`amber.fetch("https://evil.example/x")`).join(), "evil.example");
  assertStringIncludes(p(`fetch("https://api.open-meteo.com/v1")`).join(), "itself (fetch)");
});

import { BUNDLED_LIBS, libProblems } from "./page.ts";

Deno.test("libraries: bundled names and hashed npm packages pass; anything else is refused", () => {
  const meta = (c: string) => `<meta name="amber-libs" content="${c}">` + page(`<script src="amber-lib:///chart"></script>`);
  assertEquals(pageProblems(meta("chart, d3, npm:lodash@4.17.21/lodash.min.js#sha384-AAAA")), []);
  assertStringIncludes(libProblems(meta("chartjs")).join(), "No bundled library \"chartjs\"");
  assertStringIncludes(libProblems(meta("npm:lodash@^4.17.21")).join(), "needs a pinned version and a hash");
  assertStringIncludes(libProblems(meta("npm:lodash@4.17.21")).join(), "needs a pinned version and a hash");
  assertStringIncludes(libProblems(meta("npm:lodash@latest#sha384-AAAA")).join(), "needs a pinned version");
});

Deno.test("the bundled list here matches what the app ships", () => {
  const manifest = JSON.parse(Deno.readTextFileSync(new URL("../../../Pane/Resources/AppLibraries/libraries.json", import.meta.url)));
  assertEquals(Object.fromEntries(manifest.libraries.map((l: { name: string; global: string }) => [l.name, l.global])), BUNDLED_LIBS);
});

import { hostDeclared } from "./page.ts";

Deno.test("hosts: a *.domain pattern covers its servers, never a bare TLD or the domain itself", () => {
  const d = new Set(["*.archive.org", "*.org", "covers.openlibrary.org"]);
  assertEquals(hostDeclared(d, "ia800505.us.archive.org"), true);
  assertEquals(hostDeclared(d, "archive.org"), false);
  assertEquals(hostDeclared(d, "evilarchive.org"), false);
  assertEquals(hostDeclared(d, "example.org"), false);
  assertEquals(hostDeclared(d, "covers.openlibrary.org"), true);
});

import { AMBER_BASE_CSS, AMBER_TOKENS } from "./amber-base.ts";

Deno.test("the AI's copy of amber-base.css is the file the app ships", () => {
  assertEquals(AMBER_BASE_CSS, Deno.readTextFileSync(new URL("../../../Pane/Resources/AppLibraries/amber-base.css", import.meta.url)));
  assertEquals(AMBER_BASE_CSS.includes("!important"), false);
  for (const t of ["--amber-field", "--amber-root-font", "--amber-accent"]) assertEquals(AMBER_TOKENS.includes(t), true);
});
