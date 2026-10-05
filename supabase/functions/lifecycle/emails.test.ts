// deno test -A supabase/functions/lifecycle/emails.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { KINDS, render } from "./emails.ts";

const UNSUB = "https://ambernotes.app/unsubscribe?u=0b6f6a5e-1d2c-4a8e-9f3b-2c1d0e9f8a7b&t=abc";
const ctx = { site: "https://ambernotes.app", assets: "https://ambernotes.app/email", unsubscribe: UNSUB, noteCount: 3, imported: false, connectTried: false };
const all = KINDS.flatMap((kind) => [ctx, { ...ctx, noteCount: 179, imported: true, connectTried: true }].map((c) => render(kind, c)));

Deno.test("every email stays far under Gmail's 102 KB clipping limit", () => {
  for (const e of all) assert(new TextEncoder().encode(e.html).length < 60_000, `${e.kind}: ${e.html.length}`);
});

Deno.test("no em or en dashes, in the HTML or the text", () => {
  for (const e of all) for (const s of [e.subject, e.preview, e.html, e.text]) assert(!/[–—]|&mdash;|&ndash;/.test(s), e.kind);
});

Deno.test("every email has a plain-text twin with the same links and a way to stop", () => {
  for (const e of all) {
    assertStringIncludes(e.text, `Stop these emails: ${UNSUB}`);
    assertStringIncludes(e.html, `href="${UNSUB.replace(/&/g, "&amp;")}"`);
    for (const m of e.html.matchAll(/href="(https:[^"]+)"/g)) {
      const href = m[1].replace(/&amp;/g, "&");
      if (href.includes("/unsubscribe") || href.endsWith("/privacy") || /\/templates\/[a-z-]+$/.test(href)) continue;
      assertStringIncludes(e.text, href, `${e.kind}: ${href} missing from the text`);
    }
    assert(!/undefined|null|\[object/.test(e.html + e.text), e.kind);
  }
});

Deno.test("one short paragraph before the first button", () => {
  for (const e of all) {
    const head = e.html.split("<!--[if mso]><v:roundrect")[0];
    const paragraphs = (head.match(/class="ink body"/g) ?? []).length;
    assert(paragraphs <= 1, `${e.kind}: ${paragraphs} paragraphs before the button`);
    const first = head.match(/class="ink body"[^>]*>([^<]*)/)?.[1] ?? "";
    assert(first.split(/\s+/).length <= 40, `${e.kind}: ${first}`);
  }
});

Deno.test("pictures: absolute addresses, sizes set, alt text on every one", () => {
  for (const e of all) {
    for (const img of e.html.matchAll(/<img [^>]*>/g)) {
      assert(/src="https:\/\/ambernotes\.app\/email\/[a-z0-9-]+\.(jpg|png)"/.test(img[0]), img[0]);
      assert(/ alt="[^"]*"/.test(img[0]) && / width="\d+"/.test(img[0]) && / height="\d+"/.test(img[0]), img[0]);
    }
  }
});

Deno.test("built for mail apps: tables, no flex/grid/background images/web fonts, no pure white or black", () => {
  for (const e of all) {
    assertStringIncludes(e.html, '<meta name="color-scheme" content="light dark">');
    assert(!/display:\s*(flex|grid)|background-image|url\(|@import|@font-face|<svg/.test(e.html), e.kind);
    assert(!/#(fff|ffffff|000|000000)\b/i.test(e.html), `${e.kind}: pure white or black`);
    // Three style blocks, so a client that drops one keeps the others.
    assertEquals((e.html.match(/<style>/g) ?? []).length, 3);
    // Shapes are table cells: no inline-block spans standing in for boxes or dots.
    assert(!/<span[^>]*display:inline-block;width/.test(e.html), e.kind);
  }
});

Deno.test("the subject and preview are short enough for a phone's inbox", () => {
  for (const e of all) {
    assert(e.subject.length <= 45, e.subject);
    assert(e.preview.length <= 110, e.preview);
  }
});

Deno.test("the connect email shows one use case: sorting for a big library, groceries otherwise", () => {
  const small = render("connect", ctx), big = render("connect", { ...ctx, noteCount: 179, imported: true });
  assertStringIncludes(small.subject, "grocery list");
  assertStringIncludes(big.text, "179 notes");
  for (const e of [small, big]) for (const s of ["Before:", "After:", "Bring your notes", "connect-chatgpt-to-your-notes"]) assertStringIncludes(e.text, s);
});

Deno.test("a waiting connection gets the line about the last step", () => {
  const line = "typing the number the page shows";
  assertEquals(render("connect", ctx).text.includes(line), false);
  assertStringIncludes(render("connect", { ...ctx, connectTried: true }).text, line);
});

Deno.test("templates link to Use template on the site, in both card styles", () => {
  for (const cards of ["paper", "amber"] as const) {
    const e = render("templates", { ...ctx, cards });
    for (const slug of ["grocery-list", "trip-plan", "weekly-review"]) assertStringIncludes(e.html, `href="https://ambernotes.app/open/template/${slug}"`);
  }
});

Deno.test("Try this first has three prompts to paste", () => {
  assertEquals(render("try", ctx).text.split("\n").filter((l) => l.startsWith("> ")).length, 3);
});

Deno.test("replies go to Emil", () => {
  assertStringIncludes(render("stuck", ctx).html, "mailto:emil@ambernotes.app");
});
