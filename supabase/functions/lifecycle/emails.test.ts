// deno test -A supabase/functions/lifecycle/emails.test.ts
import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { askChatGPT, KINDS, render } from "./emails.ts";
import PROMPTS from "./prompts.json" with { type: "json" };

const UNSUB = "https://ambernotes.app/unsubscribe?u=0b6f6a5e-1d2c-4a8e-9f3b-2c1d0e9f8a7b&t=abc";
const ctx = { site: "https://ambernotes.app", assets: "https://ambernotes.app/email", unsubscribe: UNSUB, sortable: false, connectTried: false };
const all = KINDS.flatMap((kind) => [ctx, { ...ctx, sortable: true, connectTried: true, variant: 1 as const }].map((c) => render(kind, c)));

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
      const href = m[1].replace(/&#39;/g, "'").replace(/&amp;/g, "&");
      if (href.includes("/unsubscribe") || href.endsWith("/privacy") || /\/templates\/[a-z-]+$/.test(href)) continue;
      assertStringIncludes(e.text, href, `${e.kind}: ${href} missing from the text`);
    }
    assert(!/undefined|null|\[object/.test(e.html + e.text), e.kind);
  }
});

Deno.test("one short paragraph before the first picture or button", () => {
  for (const e of all) {
    const head = e.html.split(/<!--\[if mso\]><v:roundrect|class="shot"|class="composer"/)[0];
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
    // Shapes are table cells: no inline-block spans standing in for boxes.
    assert(!/<span[^>]*display:inline-block;width/.test(e.html), e.kind);
  }
});

Deno.test("the subject and preview are short enough for a phone's inbox", () => {
  for (const e of all) {
    assert(e.subject.length <= 45, e.subject);
    assert(e.preview.length <= 110, e.preview);
  }
});

Deno.test("no illustrations and no drawn window: every picture is a capture of the app", () => {
  const captures = ["import.jpg", "connect.jpg", "receipt.png", "undo.jpg", "app-habits.jpg", "app-budget.jpg", "iphone.jpg", "mac.jpg", "share.jpg",
    "t-grocery-list.jpg", "t-trip-plan.jpg", "t-weekly-review.jpg", "mark.png", "emil.jpg"];
  for (const e of all) {
    for (const m of e.html.matchAll(/src="https:\/\/ambernotes\.app\/email\/([^"]+)"/g)) assert(captures.includes(m[1]), `${e.kind}: ${m[1]}`);
    assert(!/#ff5f57|From Emil/.test(e.html), `${e.kind}: window chrome`);
    assertEquals((e.html.match(/class="shot"/g) ?? []).length <= 3, true, e.kind);
  }
});

Deno.test("never a person's own numbers", () => {
  for (const e of all) assert(!/\b\d{2,}\s+notes\b/.test(e.subject + e.preview + e.text), e.kind);
});

Deno.test("the connect email: a grocery list with its capture, or sorting into folders without numbers", () => {
  const groceries = render("connect", ctx), sorting = render("connect", { ...ctx, sortable: true });
  assertStringIncludes(groceries.html, "/email/connect.jpg");
  assertStringIncludes(sorting.text, "Sort your notes into folders");
  for (const e of [groceries, sorting]) for (const s of ["Bring your notes", "connect-chatgpt-to-your-notes"]) assertStringIncludes(e.text, s);
});

Deno.test("a waiting connection gets the line about the last step", () => {
  const line = "typing the number the page shows";
  assertEquals(render("connect", ctx).text.includes(line), false);
  assertStringIncludes(render("connect", { ...ctx, connectTried: true }).text, line);
});

Deno.test("Try this first: each prompt opens ChatGPT filled in, and Claude through the copy page", () => {
  const e = render("try", ctx);
  for (const p of PROMPTS) {
    assertStringIncludes(e.html, `href="${askChatGPT(p.text).replace(/&/g, "&amp;").replace(/'/g, "&#39;")}"`);
    assertStringIncludes(e.html, `href="https://ambernotes.app/copy/${p.id}"`);
  }
  assert(!/border-left/.test(e.html), "no accent bar");
});

Deno.test("two subject lines per email, both short", () => {
  for (const kind of KINDS) {
    const a = render(kind, ctx), b = render(kind, { ...ctx, variant: 1 });
    assert(a.subject !== b.subject && a.preview !== b.preview, kind);
  }
});

Deno.test("templates link to Use template on the site", () => {
  const e = render("templates", ctx);
  for (const slug of ["grocery-list", "trip-plan", "weekly-review"]) assertStringIncludes(e.html, `href="https://ambernotes.app/open/template/${slug}"`);
});

Deno.test("replies go to Emil", () => {
  assertStringIncludes(render("stuck", ctx).html, "mailto:emil@ambernotes.app");
});
